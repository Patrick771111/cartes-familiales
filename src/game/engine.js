// `createRoom`/`listRooms` restent toujours du Supabase direct (création
// d'un salon et écran "salons", avant même qu'une liaison directe ait pu
// s'établir). Le reste passe par `webrtc/relay.js`, qui accélère les coups
// via une liaison directe entre appareils une fois établie, avec repli
// automatique et transparent sur Supabase sinon (voir ce fichier pour le
// détail).
import { createRoom, listRooms, deleteRoom } from '../supabase/sync.js';
import { fetchRoomById, updateRoomState, subscribeRoom, ConflictError, initRelay, isRelayActive } from '../webrtc/relay.js';
import { initGame as initPouilleux, applyDraw } from './pouilleux.js';
import { initGame as initTrouduc, applyPlay as applyTrouducPlay, applyPass as applyTrouducPass, applyExchangeChoice } from './trouduc.js';
import { initGame as initAmericain, applyPlay as applyAmericainPlay, applyDraw as applyAmericainDraw } from './americain.js';
import { initGame as initBlackjack, applyHit as applyBlackjackHit, applyStand as applyBlackjackStand, clampBet as clampBlackjackBet } from './blackjack.js';
import { initGame as initFlip7, applyHit as applyFlip7Hit, applyStay as applyFlip7Stay } from './flip7.js';
import {
  initGame as initSkyjo,
  applyDrawFromDeck as applySkyjoDrawDeck,
  applyDrawFromDiscard as applySkyjoDrawDiscard,
  applyPlaceCard as applySkyjoPlaceCard,
  applyDiscardAndReveal as applySkyjoDiscardAndReveal
} from './skyjo.js';
import {
  initGame as initSuiteInfernale,
  applyDraw as applySuiteInfernaleDraw,
  applyPlaySequenceCard as applySuiteInfernalePlaySequenceCard,
  applyPlayRejouer as applySuiteInfernalePlayRejouer,
  applyPlayAttack as applySuiteInfernalePlayAttack,
  applyRespondToAttack as applySuiteInfernaleRespondToAttack,
  applyDiscard as applySuiteInfernaleDiscard
} from './suiteinfernale.js';
import {
  initGame as initCinqRois,
  applyDrawFromStock as applyCinqRoisDrawStock,
  applyDrawFromDiscard as applyCinqRoisDrawDiscard,
  applyDiscard as applyCinqRoisDiscard,
  startNextRound as startCinqRoisNextRound
} from './cinqrois.js';
import {
  initGame as initLuckyNumbers,
  applyDrawFromStock as applyLuckyNumbersDrawStock,
  applyTakeFromDiscard as applyLuckyNumbersTakeFromDiscard,
  applyPlaceDrawn as applyLuckyNumbersPlaceDrawn,
  applyDiscardDrawn as applyLuckyNumbersDiscardDrawn
} from './luckynumbers.js';

const GAME_INITIALIZERS = {
  pouilleux: initPouilleux,
  trouduc: initTrouduc,
  americain: initAmericain,
  blackjack: initBlackjack,
  flip7: initFlip7,
  skyjo: initSkyjo,
  suiteinfernale: initSuiteInfernale,
  cinqrois: initCinqRois,
  luckynumbers: initLuckyNumbers
};

export const AVAILABLE_GAMES = [
  { id: 'pouilleux', label: 'Le Pouilleux', hint: '2 à 6 joueurs', minPlayers: 2 },
  { id: 'trouduc', label: 'Le Trou du Cul', hint: 'exactement 4 joueurs', minPlayers: 4 },
  { id: 'americain', label: 'Le 8 américain', hint: '2 à 6 joueurs', minPlayers: 2 },
  { id: 'blackjack', label: 'Blackjack', hint: '1 à 6 joueurs, banque tenue par un bot', minPlayers: 1 },
  { id: 'flip7', label: 'Flip 7', hint: '2 à 6 joueurs, score cumulé', minPlayers: 2 },
  { id: 'skyjo', label: 'Skyjo', hint: '2 à 6 joueurs, moins de points c\'est mieux', minPlayers: 2 },
  { id: 'suiteinfernale', label: 'La Suite Infernale', hint: '2 à 4 joueurs, construis ta suite de 1 à 10', minPlayers: 2 },
  { id: 'cinqrois', label: 'Les Cinq Rois', hint: '2 à 7 joueurs — moins de points gagne', minPlayers: 2 },
  { id: 'luckynumbers', label: 'Lucky Numbers', hint: '2 à 4 joueurs — remplis ton jardin en ordre croissant', minPlayers: 2, maxPlayers: 4 }
];

const PROFILE_KEY = 'cartes-familiales:profile';

function uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Repli pour les navigateurs plus anciens (Safari < 15.4, certains navigateurs
  // intégrés à des applis) où crypto.randomUUID n'existe pas encore.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Identité locale (prénom + id stable) mémorisée sur cet appareil, une fois pour toutes. */
export function getLocalProfile() {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function saveLocalProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function emptyLobbyState() {
  return {
    status: 'lobby',
    players: [],
    hostId: null,
    hostLastSeen: null,
    turnOrder: [],
    currentPlayerId: null,
    oddCardId: null,
    loserId: null,
    lastDraw: null,
    log: [{ ts: Date.now(), message: 'Table ouverte.' }]
  };
}

// Noms de salons (avec emoji assorti) attribués au hasard à la création —
// permet de différencier les salons dans la liste sans avoir à les nommer
// soi-même. Rangé dans `state.roomName`/`state.roomEmoji` plutôt qu'une
// colonne dédiée, pour ne pas avoir à toucher au schéma Supabase.
const ROOM_NAME_POOL = [
  { name: 'Renard', emoji: '🦊' },
  { name: 'Panda', emoji: '🐼' },
  { name: 'Loutre', emoji: '🦦' },
  { name: 'Hibou', emoji: '🦉' },
  { name: 'Koala', emoji: '🐨' },
  { name: 'Dauphin', emoji: '🐬' },
  { name: 'Manchot', emoji: '🐧' },
  { name: 'Hérisson', emoji: '🦔' },
  { name: 'Ours', emoji: '🐻' },
  { name: 'Loup', emoji: '🐺' },
  { name: 'Lapin', emoji: '🐰' },
  { name: 'Perroquet', emoji: '🦜' },
  { name: 'Kangourou', emoji: '🦘' },
  { name: 'Tigre', emoji: '🐯' },
  { name: 'Lion', emoji: '🦁' },
  { name: 'Zèbre', emoji: '🦓' },
  { name: 'Girafe', emoji: '🦒' },
  { name: 'Écureuil', emoji: '🐿️' },
  { name: 'Faucon', emoji: '🦅' },
  { name: 'Pieuvre', emoji: '🐙' }
];

/**
 * Choisit un nom encore libre parmi les salons actuellement listés (le but
 * du nom est de pouvoir désigner un salon précis pour le rejoindre — un
 * doublon rendrait ça ambigu). Repli sur un nom au hasard, doublon possible,
 * si les 20 sont déjà pris (ne devrait pas arriver à l'échelle familiale).
 * Reste une vérification "au mieux" : deux créations simultanées sur deux
 * appareils pourraient en théorie choisir le même nom, comme partout
 * ailleurs dans ce fichier (verrou optimiste par salon, pas de verrou global).
 */
async function pickAvailableRoomName() {
  const rows = await listRooms();
  const takenNames = new Set(rows.map((r) => r.state.roomName).filter(Boolean));
  const free = ROOM_NAME_POOL.filter((n) => !takenNames.has(n.name));
  const pool = free.length ? free : ROOM_NAME_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Au bout de ce délai sans nouvelles de l'hôte (en salle d'attente), n'importe
// qui peut reprendre la main automatiquement au prochain chargement de l'appli.
export const HOST_STALE_MS = 2 * 60 * 1000;

function isHostStale(state) {
  if (!state.hostId) return false;
  return Date.now() - (state.hostLastSeen || 0) > HOST_STALE_MS;
}

// Même idée que HOST_STALE_MS, mais pour n'importe quel joueur : couvre
// l'abandon silencieux (onglet fermé, téléphone verrouillé) sans clic sur
// "quitter" — voir `reclaimStalePlayers`.
export const PLAYER_STALE_MS = 2 * 60 * 1000;

function isPlayerStale(p) {
  if (p.isBot || !p.lastSeen) return false; // pas de battement reçu pour l'instant (salon créé avant ce mécanisme, ou vient de rejoindre) : pas de verdict prématuré, on attend le prochain battement pour se prononcer.
  return Date.now() - p.lastSeen > PLAYER_STALE_MS;
}

/** Salons actifs pour l'écran "salons" — projection minimale (jamais les mains, même si RLS permettrait de lire `state` en entier, voir README "Limite connue"). */
export async function listActiveRooms() {
  const rows = await listRooms();
  return rows.map((row) => ({
    id: row.id,
    game: row.game,
    status: row.state.status,
    roomName: row.state.roomName || 'Salon',
    roomEmoji: row.state.roomEmoji || '🎲',
    players: (row.state.players || []).map((p) => ({ name: p.name, isBot: p.isBot || false })),
    updatedAt: row.updated_at
  }));
}

/** Crée un nouveau salon vide (salle d'attente), avec un nom encore libre pour le désigner sans ambiguïté dans la liste des salons. */
export async function createNewRoom() {
  const { name, emoji } = await pickAvailableRoomName();
  const state = { ...emptyLobbyState(), roomName: name, roomEmoji: emoji };
  return createRoom(state, 'pouilleux');
}

/**
 * Change tout au plus une entrée de `players` : `id` (le bot qui reprend
 * l'identité de la personne) et references croisées (`hostId`,
 * `currentPlayerId`, `turnOrder`, `connections`) qui pointaient vers l'ancien
 * id. Utilisé quand on reprend la place d'un bot qui portait notre nom sur un
 * autre appareil (voir `ensureMembership`) — le `hand`/`grid`/`score`, etc.
 * du joueur restent inchangés puisqu'ils vivent sur l'entrée `players`
 * elle-même, pas dans une structure séparée indexée par id.
 */
function reassignPlayerId(state, oldId, newId) {
  return {
    ...state,
    players: state.players.map((p) => (p.id === oldId ? { ...p, id: newId } : p)),
    hostId: state.hostId === oldId ? newId : state.hostId,
    currentPlayerId: state.currentPlayerId === oldId ? newId : state.currentPlayerId,
    turnOrder: (state.turnOrder || []).map((id) => (id === oldId ? newId : id)),
    connections: state.connections
      ? Object.fromEntries(Object.entries(state.connections).map(([id, v]) => [id === oldId ? newId : id, v]))
      : state.connections
  };
}

/**
 * S'assure que le profil local fait partie des joueurs de la table. Idempotent
 * si déjà membre actif. Gère aussi la reprise de contrôle :
 * - **Même appareil** (notre id est déjà dans `players`, mais marqué `isBot`
 *   — on avait été remplacé après un départ en pleine partie) : on redevient
 *   humain sur cette même entrée.
 * - **Autre appareil / identité recréée**, partie en cours ou terminée : si
 *   un bot présent porte notre nom ET a le marqueur `replacedHuman` (posé
 *   uniquement quand un humain est remplacé après un départ — jamais sur un
 *   bot ajouté volontairement via `addBot`, pour ne pas voler sa place par
 *   simple coïncidence de prénom), on reprend cette place plutôt que de
 *   rester spectateur.
 * - Sinon, partie en cours : mode spectateur (lecture seule).
 * - Sinon (salle d'attente ou manche terminée, aucun bot à reprendre) : ajout
 *   classique comme nouveau joueur.
 */
export async function ensureMembership(room, profile) {
  const existing = room.state.players.find((p) => p.id === profile.id);
  if (existing && !existing.isBot) return room;

  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    const mine = fresh.state.players.find((p) => p.id === profile.id);

    if (mine && !mine.isBot) return fresh;

    if (mine && mine.isBot) {
      const newState = {
        ...fresh.state,
        players: fresh.state.players.map((p) => (p.id === profile.id ? { ...p, isBot: false, replacedHuman: false, lastSeen: Date.now() } : p)),
        log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} reprend sa place.` }]
      };
      try {
        return await updateRoomState(fresh.id, fresh.version, newState);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        continue;
      }
    }

    if (fresh.state.status !== 'lobby') {
      const botMatch = fresh.state.players.find((p) => p.isBot && p.replacedHuman && p.name === profile.name);
      if (botMatch) {
        const reassigned = reassignPlayerId(fresh.state, botMatch.id, profile.id);
        const newState = {
          ...reassigned,
          players: reassigned.players.map((p) => (p.id === profile.id ? { ...p, isBot: false, replacedHuman: false, lastSeen: Date.now() } : p)),
          log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} reprend la place du bot qui le remplaçait.` }]
        };
        try {
          return await updateRoomState(fresh.id, fresh.version, newState);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          continue;
        }
      }
      if (fresh.state.status === 'playing') return fresh; // spectateur, jusqu'à la prochaine manche
    }

    const becomesHost = !fresh.state.hostId;
    const newState = {
      ...fresh.state,
      hostId: fresh.state.hostId || profile.id,
      hostLastSeen: becomesHost ? Date.now() : fresh.state.hostLastSeen,
      players: [...fresh.state.players, { id: profile.id, name: profile.name, hand: [], lastSeen: Date.now() }],
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} a rejoint la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de rejoindre la table, réessaie.');
}

/** Première connexion sur cet appareil : crée et mémorise l'identité locale (le salon se choisit séparément, une fois sur l'écran des salons). */
export function createLocalIdentity(name) {
  const profile = { id: uuid(), name };
  saveLocalProfile(profile);
  return profile;
}

/** Change le prénom mémorisé sur cet appareil, et le répercute sur la table si on y est déjà. */
export async function renameLocalPlayer(room, profile, newName) {
  const updatedProfile = { ...profile, name: newName };
  saveLocalProfile(updatedProfile);

  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (!fresh.state.players.some((p) => p.id === profile.id)) return { room: fresh, player: updatedProfile };

    const newState = {
      ...fresh.state,
      players: fresh.state.players.map((p) => (p.id === profile.id ? { ...p, name: newName } : p))
    };

    try {
      const updated = await updateRoomState(fresh.id, fresh.version, newState);
      return { room: updated, player: updatedProfile };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de changer le prénom, réessaie.');
}

/** Choisit le nouvel hôte parmi les joueurs restants : toujours un humain en priorité (un bot ne peut pas cliquer sur "Lancer la partie"). */
function pickNewHost(remainingPlayers) {
  const human = remainingPlayers.find((p) => !p.isBot);
  return human?.id || remainingPlayers[0]?.id || null;
}

/**
 * Calcule l'état du salon après le départ (volontaire ou constaté par
 * inactivité — voir `reclaimStalePlayers`) d'un joueur donné, sans effectuer
 * l'écriture elle-même. Centralise les règles pour que `leaveTable` et le
 * repli sur inactivité appliquent exactement le même sort :
 * - **Plus aucun humain ne resterait** (que des bots, ou personne) : le
 *   salon n'a plus de raison d'exister → fermeture (`closeRoom: true`).
 * - **L'hôte part en pleine partie** : le perdre casserait la table pour
 *   tout le monde (relais WebRTC, voir webrtc/relay.js) — la manche est
 *   interrompue, tout le monde retourne en salle d'attente avec un nouvel
 *   hôte humain. Les bots qui ne faisaient que remplacer un humain absent
 *   (`replacedHuman`) sont purgés au passage : ils ne représentent personne
 *   dans une salle d'attente.
 * - **Un autre joueur part en pleine partie** : remplacé par un bot à sa
 *   place (marqué `replacedHuman` pour pouvoir le reprendre plus tard, voir
 *   `ensureMembership`), pour ne pas bloquer les autres.
 * - **Hors partie** (salle d'attente ou manche terminée) : retrait complet
 *   classique.
 */
function computeLeaveOutcome(state, leavingId, leavingName, reasonSuffix = '') {
  const remainingHumans = state.players.filter((p) => p.id !== leavingId && !p.isBot);
  if (remainingHumans.length === 0) {
    return { closeRoom: true };
  }

  const isMidGame = state.status !== 'lobby' && state.status !== 'finished';
  const suffix = reasonSuffix ? ` (${reasonSuffix})` : '';

  if (isMidGame && state.hostId === leavingId) {
    const remainingPlayers = state.players.filter((p) => p.id !== leavingId && !p.replacedHuman);
    return {
      closeRoom: false,
      newState: {
        ...state,
        status: 'lobby',
        players: remainingPlayers.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot || false, hand: [], lastSeen: p.lastSeen })),
        hostId: pickNewHost(remainingPlayers),
        hostLastSeen: Date.now(),
        turnOrder: [],
        currentPlayerId: null,
        log: [...state.log, { ts: Date.now(), message: `${leavingName} (hôte) a quitté${suffix} — partie interrompue, retour à la salle d'attente.` }].slice(-40)
      }
    };
  }

  if (isMidGame) {
    return {
      closeRoom: false,
      newState: {
        ...state,
        players: state.players.map((p) => (p.id === leavingId ? { ...p, isBot: true, replacedHuman: true } : p)),
        log: [...state.log, { ts: Date.now(), message: `${leavingName} a quitté en pleine partie${suffix} — remplacé·e par un bot.` }]
      }
    };
  }

  const remainingPlayers = state.players.filter((p) => p.id !== leavingId);
  const hostChanged = state.hostId === leavingId;
  return {
    closeRoom: false,
    newState: {
      ...state,
      players: remainingPlayers,
      hostId: hostChanged ? pickNewHost(remainingPlayers) : state.hostId,
      hostLastSeen: hostChanged ? Date.now() : state.hostLastSeen,
      log: [...state.log, { ts: Date.now(), message: `${leavingName} a quitté la table${suffix}.` }]
    }
  };
}

export async function leaveTable(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (!fresh.state.players.some((p) => p.id === profile.id)) return fresh; // déjà parti

    const outcome = computeLeaveOutcome(fresh.state, profile.id, profile.name);
    if (outcome.closeRoom) {
      await deleteRoom(fresh.id);
      return null;
    }

    try {
      return await updateRoomState(fresh.id, fresh.version, outcome.newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de quitter la table, réessaie.');
}

/**
 * Retire un joueur donné de la table (utilisé par l'hôte pour quelqu'un qui a
 * oublié de quitter). Mêmes garde-fous que leaveTable : impossible en pleine partie.
 */
export async function kickPlayer(room, targetId) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    const target = fresh.state.players.find((p) => p.id === targetId);
    if (!target) return fresh; // déjà parti
    if (fresh.state.status === 'playing' || fresh.state.status === 'exchange') {
      throw new Error('Impossible de retirer un joueur en pleine partie.');
    }

    const remainingPlayers = fresh.state.players.filter((p) => p.id !== targetId);
    const hostChanged = fresh.state.hostId === targetId;
    const newHostId = hostChanged ? pickNewHost(remainingPlayers) : fresh.state.hostId;
    const newState = {
      ...fresh.state,
      players: remainingPlayers,
      hostId: newHostId,
      hostLastSeen: hostChanged ? Date.now() : fresh.state.hostLastSeen,
      log: [...fresh.state.log, { ts: Date.now(), message: `${target.name} a été retiré de la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error('Impossible de retirer ce joueur, réessaie.');
}

const BOT_FIRST_NAMES = [
  'Camille', 'Léo', 'Manon', 'Hugo', 'Chloé', 'Nathan', 'Louise', 'Théo',
  'Emma', 'Lucas', 'Jade', 'Gabriel', 'Alice', 'Raphaël', 'Inès', 'Adam'
];

function pickBotName(existingPlayers) {
  const takenNames = new Set(existingPlayers.map((p) => p.name));
  const free = BOT_FIRST_NAMES.filter((n) => !takenNames.has(n));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const botNumber = existingPlayers.filter((p) => p.isBot).length + 1;
  return `Bot ${botNumber}`;
}

/** Ajoute un bot à la table (hôte uniquement, en salle d'attente). Limité à 4 joueurs au total. */
export async function addBot(room) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible d'ajouter un bot en pleine partie.");
    if (fresh.state.players.length >= 6) throw new Error('Table complète (6 joueurs maximum).');

    const botName = pickBotName(fresh.state.players);
    const newState = {
      ...fresh.state,
      players: [...fresh.state.players, { id: `bot-${uuid()}`, name: botName, isBot: true, hand: [] }],
      log: [...fresh.state.log, { ts: Date.now(), message: `${botName} rejoint la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error("Impossible d'ajouter un bot, réessaie.");
}

/**
 * Permet à un humain de reprendre le rôle d'hôte si celui-ci est actuellement
 * un bot, ou un humain inactif depuis plus de 2 minutes. Porte de sortie pour
 * ne pas rester bloqué si l'hôte a disparu sans prévenir.
 */
export async function claimHost(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible de changer d'hôte en pleine partie.");
    if (!fresh.state.players.some((p) => p.id === profile.id)) throw new Error("Tu n'es pas (encore) à cette table.");

    const currentHost = fresh.state.players.find((p) => p.id === fresh.state.hostId);
    if (currentHost && !currentHost.isBot && !isHostStale(fresh.state)) {
      throw new Error('Il y a déjà un hôte actif à la table.');
    }

    const newState = {
      ...fresh.state,
      hostId: profile.id,
      hostLastSeen: Date.now(),
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} devient l'hôte.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  throw new Error("Impossible de devenir l'hôte, réessaie.");
}

/**
 * Reprise automatique et silencieuse : appelée à chaque chargement/reconnexion.
 * Si l'hôte est un bot ou n'a plus donné signe de vie depuis plus de 2 minutes,
 * la première personne qui charge l'appli devient hôte sans avoir à cliquer sur
 * quoi que ce soit. Ne fait rien si l'hôte est déjà cette personne, ou actif.
 */
export async function reclaimStaleHost(room, profile) {
  if (room.state.status !== 'lobby') return room;
  if (room.state.hostId === profile.id) return room;
  if (!room.state.players.some((p) => p.id === profile.id)) return room;

  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status !== 'lobby') return fresh;
    if (fresh.state.hostId === profile.id) return fresh;

    const currentHost = fresh.state.players.find((p) => p.id === fresh.state.hostId);
    const shouldReclaim = !currentHost || currentHost.isBot || isHostStale(fresh.state);
    if (!shouldReclaim) return fresh;

    const newState = {
      ...fresh.state,
      hostId: profile.id,
      hostLastSeen: Date.now(),
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} devient l'hôte (ancien hôte inactif).` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  return room; // pas grave si ça échoue, ça retentera au prochain chargement
}

/** Battement de cœur : l'hôte signale sa présence pendant qu'il est en salle d'attente. */
export async function pingHostPresence(room, profile) {
  if (room.state.hostId !== profile.id) return room;
  if (room.state.status !== 'lobby') return room;
  try {
    return await updateRoomState(room.id, room.version, { ...room.state, hostLastSeen: Date.now() });
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

/**
 * Battement de cœur de n'importe quel joueur (pas seulement l'hôte), dans
 * n'importe quel statut de salon — contrairement à `pingHostPresence`,
 * l'abandon silencieux peut arriver en pleine partie, pas seulement en salle
 * d'attente. Alimente `reclaimStalePlayers`.
 */
export async function pingPlayerPresence(room, profile) {
  if (!room.state.players.some((p) => p.id === profile.id)) return room;
  try {
    return await updateRoomState(room.id, room.version, {
      ...room.state,
      players: room.state.players.map((p) => (p.id === profile.id ? { ...p, lastSeen: Date.now() } : p))
    });
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

/**
 * Repli passif pour l'abandon silencieux (onglet fermé sans cliquer
 * "quitter") : n'importe quel appareil actif dans un salon vérifie
 * périodiquement si un AUTRE joueur n'a plus donné signe de vie depuis
 * `PLAYER_STALE_MS`, et lui applique alors exactement le même sort qu'un
 * départ volontaire — voir `computeLeaveOutcome`, partagée avec `leaveTable`.
 * Ne traite qu'un joueur à la fois (au prochain battement, le suivant sera
 * traité) pour rester simple face aux écritures concurrentes.
 *
 * Un joueur sans `lastSeen` (salon créé avant ce mécanisme, ou avant même sa
 * toute première seconde d'existence) n'est PAS pour autant immunisé pour
 * toujours : on lui amorce un `lastSeen` fraîchement daté dès qu'on le
 * remarque (ce passage-ci ne le considère pas encore inactif — délai de
 * grâce), pour qu'il redevienne un candidat normal 2 minutes plus tard s'il
 * ne s'est toujours pas manifesté. Sans ça, un joueur disparu avant même le
 * déploiement de ce mécanisme resterait un fantôme définitivement protégé.
 */
export async function reclaimStalePlayers(room, profile) {
  const suspect = room.state.players.find((p) => p.id !== profile.id && isPlayerStale(p));
  const needsBootstrap = room.state.players.find((p) => p.id !== profile.id && !p.isBot && !p.lastSeen);
  if (!suspect && !needsBootstrap) return room;

  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await fetchRoomById(room.id);

    const toBootstrap = fresh.state.players.filter((p) => p.id !== profile.id && !p.isBot && !p.lastSeen);
    if (toBootstrap.length) {
      const bootstrappedIds = new Set(toBootstrap.map((p) => p.id));
      const newState = {
        ...fresh.state,
        players: fresh.state.players.map((p) => (bootstrappedIds.has(p.id) ? { ...p, lastSeen: Date.now() } : p))
      };
      try {
        return await updateRoomState(fresh.id, fresh.version, newState);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        continue;
      }
    }

    const target = fresh.state.players.find((p) => p.id !== profile.id && isPlayerStale(p));
    if (!target || target.isBot) return fresh; // quelqu'un d'autre s'en est déjà occupé, ou reconnecté

    const outcome = computeLeaveOutcome(fresh.state, target.id, target.name, 'inactif depuis plus de 2 minutes');
    if (outcome.closeRoom) {
      // Ne devrait pas arriver ici : `profile` est forcément un humain actif
      // et compte donc parmi les humains restants — filet de sécurité si
      // jamais le raisonnement change un jour.
      await deleteRoom(fresh.id);
      return null;
    }

    try {
      return await updateRoomState(fresh.id, fresh.version, outcome.newState);
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
    }
  }
  return room; // pas grave, retentera au prochain battement
}

export async function startGame(room, gameType = 'pouilleux') {
  const initializer = GAME_INITIALIZERS[gameType];
  if (!initializer) throw new Error('Jeu inconnu.');

  if (gameType === 'trouduc') {
    if (room.state.players.length !== 4) {
      throw new Error('Le Trou du Cul se joue à 4 joueurs exactement.');
    }
    // Toujours un tirage au sort frais des rôles en démarrant depuis le lobby
    // (le lobby remet systématiquement à zéro — voir playAgain). Pour
    // reconduire les rôles d'une manche à l'autre sans repasser par le lobby,
    // voir continueGame.
    const gameState = initializer(room.state.players.map(({ id, name, isBot }) => ({ id, name, isBot })), null);
    const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
    return updateRoomState(room.id, room.version, newState, { game: gameType });
  }

  const gameMeta = AVAILABLE_GAMES.find((g) => g.id === gameType);
  const minPlayers = gameMeta?.minPlayers ?? 2;
  if (room.state.players.length < minPlayers) {
    throw new Error(`Il faut au moins ${minPlayers} joueur${minPlayers > 1 ? 's' : ''}.`);
  }
  if (gameMeta?.maxPlayers && room.state.players.length > gameMeta.maxPlayers) {
    throw new Error(`${gameMeta.label} se joue au maximum à ${gameMeta.maxPlayers} joueurs.`);
  }
  // `bet` (Blackjack) est réglé par chacun dans le lobby via setBlackjackBet, et
  // déjà présent sur l'entrée du joueur — on le transmet, ignoré par les autres jeux.
  const playersList = room.state.players.map(({ id, name, isBot, bet }) => ({ id, name, isBot, bet }));
  const gameState = initializer(playersList);
  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState, { game: gameType });
}

/**
 * Signale si CET appareil bénéficie actuellement d'une liaison directe
 * (WebRTC) vers l'hôte — poussé régulièrement par `main.js` (voir
 * `isRelayActive`) pour que l'indicateur 🔌 soit visible par tout le monde à
 * côté du prénom concerné, pas seulement sur l'appareil de la personne
 * connectée. Rangé à part dans `room.state.connections` (et non sur l'entrée
 * du joueur dans `players`) pour survivre aux changements de forme des
 * joueurs d'un jeu à l'autre (`startGame`/`continueGame` ne recopient que
 * `{id, name, isBot, bet}` depuis le lobby). Non critique : en cas de
 * conflit d'écriture, on laisse simplement le prochain passage de
 * `main.js` (quelques secondes plus tard) corriger l'état.
 */
export async function reportRelayStatus(room, playerId, active) {
  try {
    const fresh = await fetchRoomById(room.id);
    if (Boolean(fresh.state.connections?.[playerId]) === active) return fresh;
    const newState = { ...fresh.state, connections: { ...fresh.state.connections, [playerId]: active } };
    return await updateRoomState(fresh.id, fresh.version, newState);
  } catch (e) {
    if (e instanceof ConflictError) return room;
    throw e;
  }
}

/** Règle sa propre mise au Blackjack (lobby ou écran de fin de manche — jamais en pleine manche). */
export async function setBlackjackBet(room, playerId, bet) {
  if (room.state.status === 'playing') throw new Error('Impossible de changer sa mise en pleine manche.');
  const clamped = clampBlackjackBet(bet);
  const players = room.state.players.map((p) => (p.id === playerId ? { ...p, bet: clamped } : p));
  return updateRoomState(room.id, room.version, { ...room.state, players });
}

/**
 * Fait piocher le joueur courant au Pouilleux, à l'index de carte qu'il a choisi
 * (à l'aveugle) chez le joueur ciblé. On laisse l'appelant gérer ConflictError :
 * il resynchronisera via l'abonnement realtime (watchRoom) plutôt que de rejouer
 * l'action à l'aveugle.
 */
export async function drawForCurrentPlayer(room, playerId, cardIndex) {
  const newState = applyDraw(room.state, playerId, cardIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Le Président ou le Vice-Président choisit les cartes qu'il rend lors de l'échange privé. */
export async function submitExchangeGift(room, playerId, cardIds) {
  const newState = applyExchangeChoice(room.state, playerId, cardIds);
  return updateRoomState(room.id, room.version, newState);
}

/** Pose un ou plusieurs cartes de même rang au Trou du Cul. */
export async function playCards(room, playerId, cardIds) {
  const newState = applyTrouducPlay(room.state, playerId, cardIds);
  return updateRoomState(room.id, room.version, newState);
}

/** Passe son tour au Trou du Cul. */
export async function passTurn(room, playerId) {
  const newState = applyTrouducPass(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Pose une carte au 8 américain (`chosenSuit` uniquement pour un 8). */
export async function playAmericainCard(room, playerId, cardId, chosenSuit) {
  const newState = applyAmericainPlay(room.state, playerId, cardId, chosenSuit);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche une carte au 8 américain (uniquement si aucun coup possible). */
export async function drawAmericainCard(room, playerId) {
  const newState = applyAmericainDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Tire une carte au Blackjack. */
export async function hitBlackjack(room, playerId) {
  const newState = applyBlackjackHit(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Reste sur sa main au Blackjack. */
export async function standBlackjack(room, playerId) {
  const newState = applyBlackjackStand(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Flippe une carte à Flip 7 (résout aussi, dans le même appel, tout Flip Three déclenché). */
export async function hitFlip7(room, playerId) {
  const newState = applyFlip7Hit(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Reste sur sa main à Flip 7. */
export async function stayFlip7(room, playerId) {
  const newState = applyFlip7Stay(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche la carte du dessus de la pioche à Skyjo (à placer, ou à défausser en retournant une case, ensuite). */
export async function drawSkyjoFromDeck(room, playerId) {
  const newState = applySkyjoDrawDeck(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Prend la carte visible de la défausse à Skyjo (doit obligatoirement être placée sur la grille ensuite). */
export async function drawSkyjoFromDiscard(room, playerId) {
  const newState = applySkyjoDrawDiscard(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Place la carte piochée à Skyjo sur une case de sa grille. */
export async function placeSkyjoCard(room, playerId, gridIndex) {
  const newState = applySkyjoPlaceCard(room.state, playerId, gridIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Défausse la carte piochée du sabot à Skyjo (jamais celle de la défausse) et retourne une case cachée à la place. */
export async function discardSkyjoAndReveal(room, playerId, gridIndex) {
  const newState = applySkyjoDiscardAndReveal(room.state, playerId, gridIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche 1 carte à la Suite Infernale (obligatoire avant de jouer ou de défausser). */
export async function drawSuiteInfernale(room, playerId) {
  const newState = applySuiteInfernaleDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Pose une carte numéro, Joker +1 ou Joker +2 à la Suite Infernale, dans sa propre suite. */
export async function playSuiteInfernaleSequenceCard(room, playerId, cardId) {
  const newState = applySuiteInfernalePlaySequenceCard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

/** Joue "Rejouer 2 coups" à la Suite Infernale : pioche 2 cartes et rejoue aussitôt. */
export async function playSuiteInfernaleRejouer(room, playerId, cardId) {
  const newState = applySuiteInfernalePlayRejouer(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Joue une carte ciblant un adversaire à la Suite Infernale (vol, sabotage,
 * échange de mains ou de place) — reste en attente d'une éventuelle réponse
 * STOP de la cible, voir `respondToSuiteInfernaleAttack`. `slotIndex`
 * uniquement pour "retirer 1 carte" / "voler 1 carte".
 */
export async function playSuiteInfernaleAttack(room, playerId, cardId, targetPlayerId, slotIndex = null) {
  const newState = applySuiteInfernalePlayAttack(room.state, playerId, cardId, targetPlayerId, slotIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Réponse de la cible à une attaque en attente à la Suite Infernale : bloque avec un STOP, ou laisse passer. */
export async function respondToSuiteInfernaleAttack(room, playerId, { block = false, stopCardId = null } = {}) {
  const newState = applySuiteInfernaleRespondToAttack(room.state, playerId, { block, stopCardId });
  return updateRoomState(room.id, room.version, newState);
}

/** Défausse une carte de sa main à la Suite Infernale (quand aucune carte en main ne convient). */
export async function discardSuiteInfernale(room, playerId, cardId) {
  const newState = applySuiteInfernaleDiscard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche la carte du dessus du talon aux Cinq Rois. */
export async function drawCinqRoisFromStock(room, playerId) {
  const newState = applyCinqRoisDrawStock(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Prend la carte visible de la défausse aux Cinq Rois. */
export async function drawCinqRoisFromDiscard(room, playerId) {
  const newState = applyCinqRoisDrawDiscard(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Défausse une carte aux Cinq Rois, en posant éventuellement toute sa main du même coup (`goOut`). */
export async function discardCinqRois(room, playerId, cardId, goOut = false) {
  const newState = applyCinqRoisDiscard(room.state, playerId, cardId, goOut);
  return updateRoomState(room.id, room.version, newState);
}

/** Lucky Numbers — pioche un trèfle face cachée. */
export async function drawLuckyNumbersFromStock(room, playerId) {
  const newState = applyLuckyNumbersDrawStock(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Lucky Numbers — prend un trèfle visible de la défausse et le place. */
export async function takeLuckyNumbersFromDiscard(room, playerId, tileId, boardIndex) {
  const newState = applyLuckyNumbersTakeFromDiscard(room.state, playerId, tileId, boardIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Lucky Numbers — place la tuile piochée sur le plateau. */
export async function placeLuckyNumbersDrawn(room, playerId, boardIndex) {
  const newState = applyLuckyNumbersPlaceDrawn(room.state, playerId, boardIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Lucky Numbers — défausse la tuile piochée face visible. */
export async function discardLuckyNumbersDrawn(room, playerId) {
  const newState = applyLuckyNumbersDiscardDrawn(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Remet la table en salle d'attente — **réinitialise le contexte de la partie**
 * (rôles du Trou du Cul retirés au sort à la prochaine donne, argent du
 * Blackjack remis à `STARTING_MONEY`, score de Flip 7/Skyjo remis à 0)
 * puisqu'on quitte volontairement la partie en cours. Pour enchaîner une
 * manche en conservant ce contexte, voir `continueGame`.
 */
export async function playAgain(room) {
  // Les bots qui ne faisaient que remplacer un humain parti (`replacedHuman`)
  // n'ont rien à faire dans une salle d'attente — seuls les vrais joueurs
  // (humains, ou bots ajoutés volontairement via `addBot`) y retournent.
  const players = room.state.players
    .filter((p) => !p.replacedHuman)
    .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot || false, lastSeen: p.lastSeen }));

  const newState = {
    ...room.state,
    status: 'lobby',
    players: players.map((p) => ({ ...p, hand: [] })),
    hostId: room.state.hostId,
    hostLastSeen: Date.now(),
    turnOrder: [],
    currentPlayerId: null,
    log: [...room.state.log, { ts: Date.now(), message: 'Retour à la salle d\'attente — nouvelle partie.' }].slice(-40)
  };
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Enchaîne directement une nouvelle manche du même jeu, avec les mêmes
 * joueurs, **sans repasser par le lobby** — et en conservant le contexte
 * propre à chaque jeu (rôles du Trou du Cul, argent du Blackjack). Seulement
 * disponible une fois la manche/partie précédente terminée.
 */
export async function continueGame(room) {
  if (room.state.status !== 'finished') {
    throw new Error("La manche en cours n'est pas terminée.");
  }

  const gameType = room.game;
  const initializer = GAME_INITIALIZERS[gameType];
  if (!initializer) throw new Error('Jeu inconnu.');

  // `bet` (Blackjack) est déjà porté par chaque entrée de `room.state.players`
  // (réglable indépendamment par chacun via setBlackjackBet) — on le transmet
  // tel quel, ignoré par les autres jeux.
  const playersList = room.state.players.map(({ id, name, isBot, bet }) => ({ id, name, isBot, bet }));

  let gameState;
  if (gameType === 'trouduc') {
    gameState = initializer(playersList, room.state.finishedOrder || null);
  } else if (gameType === 'blackjack') {
    const previousMoney = Object.fromEntries(room.state.players.map((p) => [p.id, p.money]));
    gameState = initializer(playersList, previousMoney);
  } else if (gameType === 'flip7' || gameType === 'skyjo') {
    // Si la PARTIE (pas juste la manche) vient d'être gagnée par quelqu'un,
    // "Continuer" démarre une partie neuve — les scores repartent à 0, sinon
    // ils resteraient gonflés depuis une partie déjà remportée.
    const previousScores = room.state.gameWinnerId
      ? null
      : Object.fromEntries(room.state.players.map((p) => [p.id, p.score]));
    gameState = initializer(playersList, previousScores);
  } else if (gameType === 'cinqrois') {
    gameState = startCinqRoisNextRound(room.state);
  } else {
    gameState = initializer(playersList);
  }

  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState, { game: gameType });
}

export function watchRoom(roomId, onChange) {
  return subscribeRoom(roomId, onChange);
}

export { fetchRoomById, initRelay, isRelayActive };
