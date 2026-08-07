import { supabase } from '../supabase/client.js';
import {
  fetchRoomById as defaultFetchRoomById,
  updateRoomState as defaultUpdateRoomState,
  subscribeRoom as defaultSubscribeRoom,
  ConflictError
} from '../supabase/sync.js';

export { ConflictError };

// La "base de vérité" que le relais lit/écrit réellement — Supabase par
// défaut, remplaçable via `initRelay(..., { backingStore })` pour les tests.
let backingStore = {
  fetchRoomById: defaultFetchRoomById,
  updateRoomState: defaultUpdateRoomState,
  subscribeRoom: defaultSubscribeRoom
};

/**
 * Couche de fiabilité transparente : chaque invité établit une liaison
 * WebRTC vers l'hôte ; les coups passent par cette liaison quand elle est
 * prête, sinon repli silencieux sur Supabase.
 *
 * Correctifs vs version précédente :
 * - file d'attente des candidats ICE (arrivés avant setRemoteDescription)
 * - plusieurs serveurs STUN
 * - reconnexion automatique si la liaison tombe (même hôte)
 * - health-check plus tolérant + nouvel essai
 * - offer/answer idempotents côté hôte
 */

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};
const REQUEST_TIMEOUT_MS = 12000;
const HEALTH_CHECK_TIMEOUT_MS = 6000;
/** Délai avant de retenter une liaison invité après échec / coupure. */
const RECONNECT_DELAY_MS = 2500;
/** Intervalle max entre deux tentatives de (re)connexion invité. */
const RECONNECT_MAX_MS = 20000;

function wireDataChannel(dc, { onMessage, onOpen, onClose }) {
  dc.binaryType = 'arraybuffer';
  dc.addEventListener('message', (e) => {
    const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
    onMessage(data);
  });
  dc.addEventListener('open', () => onOpen?.());
  dc.addEventListener('close', () => onClose?.());
  dc.addEventListener('error', () => onClose?.());
}

/**
 * Ajoute un candidat ICE en file si la description distante n'est pas encore
 * posée — évite de perdre les candidats qui arrivent avant l'answer/offer.
 */
async function addIceCandidateSafe(pc, candidate, pendingIce) {
  if (!candidate) return;
  if (!pc.remoteDescription) {
    pendingIce.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) {
    // Candidat obsolète après renegociation — ignorable.
  }
}

async function flushPendingIce(pc, pendingIce) {
  const batch = pendingIce.splice(0, pendingIce.length);
  for (const c of batch) {
    try {
      await pc.addIceCandidate(c);
    } catch (e) {
      /* ignore */
    }
  }
}

function createSupabaseSignalTransport(roomId) {
  return new Promise((resolve, reject) => {
    const channel = supabase.channel(`webrtc-signal:${roomId}`);
    let handler = null;
    let settled = false;
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => handler?.(payload));
    channel.subscribe((status) => {
      if (settled) return;
      if (status === 'SUBSCRIBED') {
        settled = true;
        resolve({
          send: (msg) => {
            try {
              return channel.send({ type: 'broadcast', event: 'signal', payload: msg });
            } catch (e) {
              return Promise.resolve();
            }
          },
          onMessage: (cb) => {
            handler = cb;
          },
          close: () => {
            try {
              supabase.removeChannel(channel);
            } catch (e) {
              /* ignore */
            }
          }
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settled = true;
        reject(new Error('Canal de signalisation indisponible.'));
      }
    });
  });
}

/* ============================== État du module ============================== */

let signal = null;
let myPlayerId = null;
let myRoomId = null;
let currentHostId = null;
let activeOnChange = null;
let hostRelayUnsub = null;
let guestReconnectTimer = null;
let guestConnectGeneration = 0; // invalide les tentatives obsolètes

const hostConnections = new Map(); // playerId -> { pc, dc, ready, pendingIce }
let guestLink = null; // { hostId, pc, dc, ready, pending, reqCounter, pendingIce } | null

function clearGuestReconnectTimer() {
  if (guestReconnectTimer) {
    clearTimeout(guestReconnectTimer);
    guestReconnectTimer = null;
  }
}

function teardownRelay() {
  clearGuestReconnectTimer();
  guestConnectGeneration += 1;
  signal?.close();
  signal = null;
  hostRelayUnsub?.();
  hostRelayUnsub = null;
  for (const conn of hostConnections.values()) {
    try {
      conn.pc.close();
    } catch (e) {
      /* ignore */
    }
  }
  hostConnections.clear();
  if (guestLink) {
    try {
      guestLink.pc.close();
    } catch (e) {
      /* ignore */
    }
  }
  guestLink = null;
}

/* ============================== Rôle hôte ============================== */

async function armHostRelay() {
  hostRelayUnsub?.();
  hostRelayUnsub = backingStore.subscribeRoom(myRoomId, (row) => {
    const msg = JSON.stringify({ type: 'room', row });
    for (const conn of hostConnections.values()) {
      if (conn.dc?.readyState === 'open') {
        try {
          conn.dc.send(msg);
        } catch (e) {
          /* ignore */
        }
      }
    }
  });
}

async function handleIncomingOffer(guestId, sdp) {
  hostConnections.get(guestId)?.pc.close();

  const pendingIce = [];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const conn = { pc, dc: null, ready: false, pendingIce };
  hostConnections.set(guestId, conn);

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate) {
      signal?.send({ type: 'ice', from: myPlayerId, to: guestId, candidate: e.candidate.toJSON() });
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed'].includes(pc.connectionState)) {
      if (hostConnections.get(guestId) === conn) hostConnections.delete(guestId);
    }
    // 'disconnected' est souvent transitoire — on laisse une chance de récupérer
  });
  pc.addEventListener('datachannel', (event) => {
    conn.dc = event.channel;
    wireDataChannel(conn.dc, {
      onMessage: (raw) => handleHostChannelMessage(guestId, raw),
      onOpen: async () => {
        conn.ready = true;
        emitRelayStatus();
        try {
          const row = await backingStore.fetchRoomById(myRoomId);
          if (conn.dc?.readyState === 'open') {
            conn.dc.send(JSON.stringify({ type: 'room', row }));
          }
        } catch (e) {
          /* ignore */
        }
      },
      onClose: () => {
        if (hostConnections.get(guestId) === conn) {
          hostConnections.delete(guestId);
          emitRelayStatus();
        }
      }
    });
  });

  await pc.setRemoteDescription(sdp);
  await flushPendingIce(pc, pendingIce);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  signal?.send({ type: 'answer', from: myPlayerId, to: guestId, sdp: pc.localDescription.toJSON() });
}

async function handleHostChannelMessage(guestId, raw) {
  try {
    const conn = hostConnections.get(guestId);
    if (!conn?.dc) return;
    const msg = JSON.parse(raw);

    if (msg.type === 'fetch') {
      const row = await backingStore.fetchRoomById(myRoomId);
      if (conn.dc.readyState === 'open') {
        conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'room', row } }));
      }
      return;
    }
    if (msg.type === 'update') {
      let row;
      try {
        row = await backingStore.updateRoomState(
          myRoomId,
          msg.expectedVersion,
          msg.newState,
          msg.extraColumns || {}
        );
      } catch (e) {
        if (conn.dc.readyState === 'open') {
          conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'conflict' } }));
        }
        return;
      }
      if (conn.dc.readyState === 'open') {
        conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'room', row } }));
      }
    }
    if (msg.type === 'ping') {
      if (conn.dc.readyState === 'open') {
        conn.dc.send(JSON.stringify({ type: 'response', id: msg.id, result: { type: 'pong' } }));
      }
    }
  } catch (e) {
    console.error('[webrtc/relay] Erreur message invité :', e);
  }
}

/* ============================== Rôle invité ============================== */

function scheduleGuestReconnect(delay = RECONNECT_DELAY_MS) {
  clearGuestReconnectTimer();
  if (!signal || !currentHostId || myPlayerId === currentHostId) return;
  const wait = Math.min(delay, RECONNECT_MAX_MS);
  guestReconnectTimer = setTimeout(() => {
    guestReconnectTimer = null;
    if (!signal || myPlayerId === currentHostId) return;
    if (guestLinkReady()) return;
    armGuestConnection().catch(() => scheduleGuestReconnect(Math.min(wait * 1.5, RECONNECT_MAX_MS)));
  }, wait);
}

async function armGuestConnection() {
  if (!currentHostId || myPlayerId === currentHostId) return;
  if (!signal) return;

  // Invalide toute tentative précédente encore en cours
  guestConnectGeneration += 1;
  const generation = guestConnectGeneration;

  if (guestLink) {
    try {
      guestLink.pc.close();
    } catch (e) {
      /* ignore */
    }
    guestLink = null;
  }

  const pendingIce = [];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  const dc = pc.createDataChannel('game', { ordered: true });
  const link = {
    hostId: currentHostId,
    pc,
    dc,
    ready: false,
    pending: new Map(),
    reqCounter: 0,
    pendingIce
  };
  guestLink = link;

  pc.addEventListener('icecandidate', (e) => {
    if (e.candidate && generation === guestConnectGeneration) {
      signal?.send({ type: 'ice', from: myPlayerId, to: currentHostId, candidate: e.candidate.toJSON() });
    }
  });
  pc.addEventListener('connectionstatechange', () => {
    if (generation !== guestConnectGeneration) return;
    if (['failed', 'closed'].includes(pc.connectionState)) {
      if (guestLink === link) {
        guestLink = null;
        // Rejeter les requêtes en attente pour qu'elles ne restent pas bloquées
        for (const [, pending] of link.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Liaison directe coupée.'));
        }
        link.pending.clear();
        scheduleGuestReconnect();
      }
    }
  });

  wireDataChannel(dc, {
    onMessage: (raw) => handleGuestChannelMessage(link, raw),
    onOpen: () => {
      if (generation !== guestConnectGeneration || guestLink !== link) return;
      // Health-check : un vrai aller-retour de messages (pas seulement "open")
      sendRequestOn(link, { type: 'ping' }, HEALTH_CHECK_TIMEOUT_MS)
        .then(() => {
          if (guestLink === link && generation === guestConnectGeneration) {
            link.ready = true;
            emitRelayStatus();
            // Snapshot initial
            return sendRequestOn(link, { type: 'fetch' }, REQUEST_TIMEOUT_MS).then((row) => {
              if (row && activeOnChange) activeOnChange(row);
            });
          }
        })
        .catch(() => {
          // Canal "open" mais pas de réponse utile → abandonner et retenter
          if (guestLink === link) {
            try {
              link.pc.close();
            } catch (e) {
              /* ignore */
            }
            guestLink = null;
            scheduleGuestReconnect(RECONNECT_DELAY_MS);
          }
        });
    },
    onClose: () => {
      if (guestLink === link) {
        guestLink = null;
        for (const [, pending] of link.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Liaison directe fermée.'));
        }
        link.pending.clear();
        scheduleGuestReconnect();
      }
    }
  });

  try {
    const offer = await pc.createOffer();
    if (generation !== guestConnectGeneration) return;
    await pc.setLocalDescription(offer);
    signal?.send({ type: 'offer', from: myPlayerId, to: currentHostId, sdp: pc.localDescription.toJSON() });
  } catch (e) {
    if (guestLink === link) guestLink = null;
    scheduleGuestReconnect();
  }
}

function handleGuestChannelMessage(link, raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'room' && msg.row && activeOnChange) {
      activeOnChange(msg.row);
      return;
    }
    if (msg.type === 'response' && msg.id != null) {
      const pending = link.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      link.pending.delete(msg.id);
      if (msg.result?.type === 'conflict') pending.reject(new ConflictError());
      else if (msg.result?.type === 'room') pending.resolve(msg.result.row);
      else if (msg.result?.type === 'pong') pending.resolve(true);
      else pending.resolve(msg.result);
    }
  } catch (e) {
    console.error('[webrtc/relay] Erreur message hôte :', e);
  }
}

function sendRequestOn(link, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!link?.dc || link.dc.readyState !== 'open') {
      reject(new Error('Liaison directe indisponible.'));
      return;
    }
    const id = ++link.reqCounter;
    const timer = setTimeout(() => {
      link.pending.delete(id);
      reject(new Error('Délai dépassé sur la liaison directe.'));
    }, timeoutMs);
    link.pending.set(id, { resolve, reject, timer });
    try {
      link.dc.send(JSON.stringify({ ...payload, id }));
    } catch (e) {
      clearTimeout(timer);
      link.pending.delete(id);
      reject(e);
    }
  });
}

function guestLinkReady() {
  return Boolean(guestLink && guestLink.ready && guestLink.dc?.readyState === 'open');
}

/* ============================== Signalisation ============================== */

async function handleSignal(msg) {
  if (!msg || msg.to !== myPlayerId) return;

  if (msg.type === 'offer' && myPlayerId === currentHostId) {
    try {
      await handleIncomingOffer(msg.from, msg.sdp);
    } catch (e) {
      console.error('[webrtc/relay] Offer échouée :', e);
    }
    return;
  }

  if (msg.type === 'answer' && guestLink && msg.from === currentHostId) {
    try {
      if (!guestLink.pc.currentRemoteDescription) {
        await guestLink.pc.setRemoteDescription(msg.sdp);
        await flushPendingIce(guestLink.pc, guestLink.pendingIce);
      }
    } catch (e) {
      console.error('[webrtc/relay] Answer échouée :', e);
    }
    return;
  }

  if (msg.type === 'ice' && msg.candidate) {
    if (myPlayerId === currentHostId) {
      const conn = hostConnections.get(msg.from);
      if (conn) await addIceCandidateSafe(conn.pc, msg.candidate, conn.pendingIce);
    } else if (guestLink && msg.from === currentHostId) {
      await addIceCandidateSafe(guestLink.pc, msg.candidate, guestLink.pendingIce);
    }
  }
}

/* ============================== API publique ============================== */

export async function initRelay(
  room,
  player,
  { signalTransportFactory = createSupabaseSignalTransport, backingStore: injectedBackingStore } = {}
) {
  if (injectedBackingStore) backingStore = injectedBackingStore;

  const nextHostId = room.state.hostId ?? null;
  const sameSession =
    signal && myRoomId === room.id && myPlayerId === player.id && currentHostId === nextHostId;

  // Déjà initialisé pour cette table / hôte : s'assurer juste que l'invité
  // a une liaison (ou en retente une) sans tout détruire.
  if (sameSession) {
    if (myPlayerId !== currentHostId && !guestLinkReady() && !guestReconnectTimer) {
      scheduleGuestReconnect(500);
    }
    return;
  }

  teardownRelay();
  myPlayerId = player.id;
  myRoomId = room.id;
  currentHostId = nextHostId;

  if (!currentHostId) return; // pas d'hôte → pas de relais

  try {
    signal = await signalTransportFactory(room.id);
  } catch (e) {
    return; // signalisation indisponible → tout reste sur Supabase
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
  myPlayerId = null;
  myRoomId = null;
  currentHostId = null;
}

/* ==================== Primitives (contrat supabase/sync.js) ==================== */

export async function fetchRoomById(id) {
  if (guestLinkReady()) {
    const link = guestLink;
    try {
      return await sendRequestOn(link, { type: 'fetch' });
    } catch (e) {
      if (guestLink === link) {
        guestLink = null;
        scheduleGuestReconnect();
      }
    }
  }
  return backingStore.fetchRoomById(id);
}

export async function updateRoomState(roomId, expectedVersion, newState, extraColumns = {}) {
  if (guestLinkReady()) {
    const link = guestLink;
    try {
      return await sendRequestOn(link, {
        type: 'update',
        expectedVersion,
        newState,
        extraColumns
      });
    } catch (e) {
      if (e instanceof ConflictError) throw e;
      // Timeout / coupure : bascule sur Supabase pour CE coup, et programme
      // une reconnexion. On ne jette plus l'erreur — le coup part quand même.
      if (guestLink === link) {
        guestLink = null;
        scheduleGuestReconnect();
      }
      return backingStore.updateRoomState(roomId, expectedVersion, newState, extraColumns);
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

function hostHasReadyGuest() {
  for (const conn of hostConnections.values()) {
    if (conn.ready && conn.dc?.readyState === 'open') return true;
  }
  return false;
}

function emitRelayStatus() {
  try {
    window.dispatchEvent(new CustomEvent('cartes-relay-status', { detail: { active: isRelayActive() } }));
  } catch (e) {
    /* ignore (SSR / tests) */
  }
}

/**
 * True si CET appareil a une liaison directe opérationnelle :
 * - invité : canal ouvert vers l'hôte
 * - hôte : au moins un invité connecté en direct
 */
export function isRelayActive() {
  if (myPlayerId && myPlayerId === currentHostId) return hostHasReadyGuest();
  return guestLinkReady();
}
