import { supabase } from '../supabase/client.js';
import {
  fetchRoomById as defaultFetchRoomById,
  updateRoomState as defaultUpdateRoomState,
  subscribeRoom as defaultSubscribeRoom,
  ConflictError
} from '../supabase/sync.js';

export { ConflictError };

// La "base de vérité" que le relais lit/écrit réellement — Supabase par
// défaut, remplaçable via `initRelay(..., { backingStore })` pour les tests
// (voir `_test_relay.html`), qui n'ont pas accès à un vrai projet Supabase
// dans cet environnement de développement.
let backingStore = {
  fetchRoomById: defaultFetchRoomById,
  updateRoomState: defaultUpdateRoomState,
  subscribeRoom: defaultSubscribeRoom
};

/**
 * Couche de fiabilité transparente : la connexion internet existe mais
 * devient parfois instable en pleine partie (passage Wi-Fi ↔ 4G), ce qui
 * rend Supabase lent à ces moments-là et donne l'impression qu'un coup ne
 * part pas. Une fois tout le monde dans le lobby (donc pendant que la
 * connexion va encore bien), chaque invité établit une liaison directe
 * (WebRTC) vers l'appareil du `hostId` courant ; ses coups (`updateRoomState`)
 * passent alors par cette liaison plutôt que par Supabase. Aucun mode
 * visible côté utilisateur : si la liaison n'est pas encore prête, ou se
 * coupe, on retombe silencieusement sur Supabase — jamais pire qu'aujourd'hui.
 *
 * La signalisation (échange de l'offre/réponse WebRTC et des candidats ICE)
 * passe par un canal Supabase Realtime *broadcast* (éphémère, ne touche pas
 * la table `game_rooms`) — c'est le seul rôle que joue encore Supabase une
 * fois la liaison directe active. `createSupabaseSignalTransport` peut être
 * remplacé (paramètre de `initRelay`) par un autre transport, ex. pour les
 * tests (voir `_test_relay.html`, deux onglets reliés par `BroadcastChannel`
 * plutôt que par un vrai projet Supabase).
 */

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
// Généreux : le trajet complet passe par l'hôte qui écrit lui-même dans
// Supabase, potentiellement lent si SA connexion est aussi dégradée — un
// délai trop court transformerait une simple lenteur en échec artificiel.
const REQUEST_TIMEOUT_MS = 12000;
// Health-check à l'ouverture du canal, plus court : sert juste à vérifier
// que la liaison relaie vraiment des messages (et pas seulement "ouverte"
// au sens WebRTC — un NAT capricieux peut donner cette fausse impression)
// avant de l'activer pour de vrai.
const HEALTH_CHECK_TIMEOUT_MS = 4000;

function wireDataChannel(dc, { onMessage, onOpen, onClose }) {
  dc.addEventListener('message', (e) => onMessage(e.data));
  dc.addEventListener('open', () => onOpen?.());
  dc.addEventListener('close', () => onClose?.());
  dc.addEventListener('error', () => onClose?.());
}

function createSupabaseSignalTransport(roomId) {
  return new Promise((resolve, reject) => {
    const channel = supabase.channel(`webrtc-signal:${roomId}`);
    let handler = null;
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => handler?.(payload));
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        resolve({
          send: (msg) => channel.send({ type: 'broadcast', event: 'signal', payload: msg }),
          onMessage: (cb) => {
            handler = cb;
          },
          close: () => supabase.removeChannel(channel)
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error('Canal de signalisation indisponible.'));
      }
    });
  });
}

/* ============================== État du module ============================== */
// Un seul appareil = une seule table à la fois, sur le même principe que
// `currentRoomId`/`unsubscribe` dans main.js.

let signal = null;
let myPlayerId = null;
let myRoomId = null;
let currentHostId = null;
let activeOnChange = null; // callback enregistré via `subscribeRoom`, réutilisé pour pousser les mises à jour reçues par la liaison directe
let hostRelayUnsub = null; // abonnement Supabase interne côté hôte, pour relayer aux invités

const hostConnections = new Map(); // playerId (invité) -> { pc, dc, ready }
let guestLink = null; // { hostId, pc, dc, ready, pending: Map, reqCounter } | null

function teardownRelay() {
  signal?.close();
  signal = null;
  hostRelayUnsub?.();
  hostRelayUnsub = null;
  for (const conn of hostConnections.values()) conn.pc.close();
  hostConnections.clear();
  guestLink?.pc.close();
  guestLink = null;
}

/* ============================== Rôle hôte ============================== */

async function armHostRelay() {
  hostRelayUnsub = backingStore.subscribeRoom(myRoomId, (row) => {
    const msg = JSON.stringify({ type: 'room', row });
    for (const conn of hostConnections.values()) {
      if (conn.dc?.readyState === 'open') conn.dc.send(msg);
    }
  });
}

async function handleIncomingOffer(guestId, sdp) {
  hostConnections.get(guestId)?.pc.close();

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const conn = { pc, dc: null, ready: false };
  hostConnections.set(guestId, conn);

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) signal?.send({ type: 'ice', from: myPlayerId, to: guestId, candidate: e.candidate.toJSON() });
  });
  pc.addEventListener('connectionstatechange', () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      if (hostConnections.get(guestId) === conn) hostConnections.delete(guestId);
    }
  });
  pc.addEventListener('datachannel', (event) => {
    conn.dc = event.channel;
    wireDataChannel(conn.dc, {
      onMessage: (raw) => handleHostChannelMessage(guestId, raw),
      onOpen: async () => {
        conn.ready = true;
        const row = await backingStore.fetchRoomById(myRoomId);
        conn.dc.send(JSON.stringify({ type: 'room', row }));
      },
      onClose: () => {
        if (hostConnections.get(guestId) === conn) hostConnections.delete(guestId);
      }
    });
  });

  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal?.send({ type: 'answer', from: myPlayerId, to: guestId, sdp: pc.localDescription.toJSON() });
}

// Enveloppe défensive : si `conn.dc.send` lui-même échoue (canal coupé entre
// la réception du message et l'envoi de la réponse), on ne laisse pas
// l'exception disparaître silencieusement sans que l'invité comprenne
// pourquoi sa requête reste sans réponse jusqu'au timeout.
async function handleHostChannelMessage(guestId, raw) {
  try {
    const conn = hostConnections.get(guestId);
    if (!conn) return;
    const msg = JSON.parse(raw);

    if (msg.type === 'fetch') {
      const row = await backingStore.fetchRoomById(myRoomId);
      conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'room', row } }));
      return;
    }
    if (msg.type === 'update') {
      let row;
      try {
        row = await backingStore.updateRoomState(myRoomId, msg.expectedVersion, msg.newState, msg.extraColumns || {});
      } catch (e) {
        conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'conflict' } }));
        return;
      }
      conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'room', row } }));
      // Le push vers les AUTRES invités connectés se fait via l'abonnement
      // Supabase interne d'`armHostRelay` (déclenché par cette même
      // écriture) — pas la peine de le refaire ici pour celui-ci.
    }
  } catch (e) {
    console.error('[webrtc/relay] Erreur en traitant un message invité :', e);
  }
}

/* ============================== Rôle invité ============================== */

async function armGuestConnection() {
  if (!currentHostId) return;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dc = pc.createDataChannel('game');
  const link = { hostId: currentHostId, pc, dc, ready: false, pending: new Map(), reqCounter: 0 };
  guestLink = link;

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) signal?.send({ type: 'ice', from: myPlayerId, to: currentHostId, candidate: e.candidate.toJSON() });
  });
  pc.addEventListener('connectionstatechange', () => {
    if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
      if (guestLink === link) guestLink = null;
    }
  });
  wireDataChannel(dc, {
    onMessage: (raw) => handleGuestChannelMessage(link, raw),
    onOpen: () => {
      // Le canal est "ouvert" au sens WebRTC, mais ça ne garantit pas qu'il
      // relaie vraiment des messages (NAT capricieux) : on vérifie par un
      // aller-retour réel avant d'y router de vrais coups.
      sendRequestOn(link, { type: 'fetch' }, HEALTH_CHECK_TIMEOUT_MS)
        .then(() => {
          if (guestLink === link) link.ready = true;
        })
        .catch(() => {
          // Ne répond pas vraiment : reste non prête, tout continue de
          // passer par Supabase comme avant cette fonctionnalité.
        });
    },
    onClose: () => {
      if (guestLink === link) guestLink = null;
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signal?.send({ type: 'offer', from: myPlayerId, to: currentHostId, sdp: pc.localDescription.toJSON() });
}

function handleGuestChannelMessage(link, raw) {
  const msg = JSON.parse(raw);

  if (msg.type === 'room') {
    activeOnChange?.(msg.row);
    return;
  }
  if (msg.type === 'response') {
    const pending = link.pending.get(msg.id);
    if (!pending) return;
    link.pending.delete(msg.id);
    if (msg.result.type === 'conflict') pending.reject(new ConflictError());
    else pending.resolve(msg.result.row);
  }
}

function sendRequestOn(link, msg, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const id = ++link.reqCounter;
    const timer = setTimeout(() => {
      link.pending.delete(id);
      reject(new Error('La connexion directe ne répond pas — réessaie.'));
    }, timeoutMs);
    link.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      }
    });
    link.dc.send(JSON.stringify({ ...msg, id }));
  });
}

function guestLinkReady() {
  return Boolean(guestLink && guestLink.ready && guestLink.dc.readyState === 'open');
}

/* ============================== Signalisation ============================== */

function handleSignal(msg) {
  if (!msg || msg.to !== myPlayerId) return;

  if (msg.type === 'offer' && myPlayerId === currentHostId) {
    handleIncomingOffer(msg.from, msg.sdp);
    return;
  }
  if (msg.type === 'answer' && guestLink && msg.from === currentHostId) {
    guestLink.pc.setRemoteDescription(msg.sdp);
    return;
  }
  if (msg.type === 'ice' && msg.candidate) {
    const pc = myPlayerId === currentHostId ? hostConnections.get(msg.from)?.pc : guestLink?.pc;
    pc?.addIceCandidate(msg.candidate).catch(() => {});
  }
}

/**
 * À appeler une fois la table rejointe (`main.js`), et à nouveau chaque fois
 * que `room.state.hostId` change. `signalTransportFactory`/`backingStore` ne
 * sont à fournir que pour les tests (voir `_test_relay.html`) — par défaut,
 * tout passe par le vrai Supabase.
 */
export async function initRelay(room, player, { signalTransportFactory = createSupabaseSignalTransport, backingStore: injectedBackingStore } = {}) {
  teardownRelay();

  backingStore = injectedBackingStore || {
    fetchRoomById: defaultFetchRoomById,
    updateRoomState: defaultUpdateRoomState,
    subscribeRoom: defaultSubscribeRoom
  };

  myPlayerId = player.id;
  myRoomId = room.id;
  currentHostId = room.state.hostId;
  if (!currentHostId) return;

  try {
    signal = await signalTransportFactory(room.id);
  } catch (e) {
    // Signalisation indisponible (ex : Supabase injoignable à cet instant) —
    // on reste simplement sur Supabase pour tout, comme aujourd'hui.
    return;
  }
  signal.onMessage(handleSignal);

  if (myPlayerId === currentHostId) {
    await armHostRelay();
  } else {
    await armGuestConnection();
  }
}

export function stopRelay() {
  teardownRelay();
}

/* ==================== Primitives (même contrat que supabase/sync.js) ==================== */

export async function fetchRoomById(id) {
  if (guestLinkReady()) {
    const link = guestLink;
    try {
      return await sendRequestOn(link, { type: 'fetch' });
    } catch (e) {
      // Lecture : repli silencieux sans risque de double-effet. Une liaison
      // qui ne répond pas ne relaiera sans doute pas mieux le prochain coup :
      // on la désactive pour de bon, plutôt que de retenter en vain à
      // chaque action (voir `updateRoomState` pour le même raisonnement).
      if (guestLink === link) guestLink = null;
    }
  }
  return backingStore.fetchRoomById(id);
}

export async function updateRoomState(roomId, expectedVersion, newState, extraColumns = {}) {
  if (guestLinkReady()) {
    const link = guestLink;
    try {
      return await sendRequestOn(link, { type: 'update', expectedVersion, newState, extraColumns });
    } catch (e) {
      if (e instanceof ConflictError) throw e; // réponse propre et rapide : la liaison va bien, rien à faire

      // Pas de réponse dans les temps (liaison ouverte au sens WebRTC mais
      // qui ne relaie plus rien, ex: NAT capricieux) : on la désactive pour
      // de bon, pour que le PROCHAIN essai de l'utilisateur passe directement
      // par Supabase au lieu de retenter (et retimeout) la même liaison
      // cassée. Ce coup-ci reste en échec — pas de nouvel essai automatique
      // ici, pour ne pas risquer de le jouer deux fois si l'hôte l'avait en
      // fait déjà traité.
      if (guestLink === link) guestLink = null;
      throw e;
    }
  }
  return backingStore.updateRoomState(roomId, expectedVersion, newState, extraColumns);
}

export function subscribeRoom(roomId, onChange) {
  activeOnChange = onChange;
  const unsub = backingStore.subscribeRoom(roomId, onChange);
  return () => {
    if (activeOnChange === onChange) activeOnChange = null;
    unsub();
  };
}

/** Pour l'indicateur "connexion directe" dans l'UI. */
export function isRelayActive() {
  return guestLinkReady();
}
