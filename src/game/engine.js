import {
  getOrCreateRoomByCode,
  fetchRoomById,
  updateRoomState,
  subscribeRoom,
  ConflictError
} from '../supabase/sync.js';
import { initGame, applyDraw } from './pouilleux.js';

// Code fixe de la table familiale : personne n'a besoin de le saisir ni de le
// partager, tout le monde retombe automatiquement sur la même table.
// Modifiable via VITE_FAMILY_CODE si un jour tu veux plusieurs tables séparées.
const FAMILY_CODE = (import.meta.env.VITE_FAMILY_CODE || 'FAMILLE-BLAVIER').toUpperCase();

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
    turnOrder: [],
    currentPlayerId: null,
    oddCardId: null,
    loserId: null,
    lastDraw: null,
    log: [{ ts: Date.now(), message: 'Table ouverte.' }]
  };
}

/** Récupère la table familiale, la crée si c'est la toute première connexion. */
export async function ensureFamilyRoom() {
  return getOrCreateRoomByCode(FAMILY_CODE, emptyLobbyState(), 'pouilleux');
}

/**
 * S'assure que le profil local fait partie des joueurs de la table.
 * Idempotent : si déjà présent, ne fait rien. Gère les écritures concurrentes
 * (plusieurs membres de la famille qui ouvrent l'appli en même temps).
 */
export async function ensureMembership(room, profile) {
  if (room.state.players.some((p) => p.id === profile.id)) return room;

  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.players.some((p) => p.id === profile.id)) return fresh;

    if (fresh.state.status !== 'lobby') {
      // Une partie est déjà en cours : on ne peut pas rejoindre au milieu,
      // on affichera la table telle quelle et on rejoindra à la prochaine manche.
      return fresh;
    }

    const newState = {
      ...fresh.state,
      hostId: fresh.state.hostId || profile.id,
      players: [...fresh.state.players, { id: profile.id, name: profile.name, hand: [] }],
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

/** Première connexion sur cet appareil : crée l'identité locale et rejoint la table. */
export async function createIdentityAndJoin(room, name) {
  const profile = { id: uuid(), name };
  saveLocalProfile(profile);
  const joinedRoom = await ensureMembership(room, profile);
  return { room: joinedRoom, player: profile };
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

export async function startGame(room) {
  if (room.state.players.length < 2) throw new Error('Il faut au moins 2 joueurs.');
  const gameState = initGame(room.state.players.map(({ id, name }) => ({ id, name })));
  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Fait piocher le joueur courant. On laisse l'appelant gérer ConflictError : il
 * resynchronisera via l'abonnement realtime (watchRoom) plutôt que de rejouer l'action à l'aveugle.
 */
export async function drawForCurrentPlayer(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Remet la table en salle d'attente pour relancer une manche, en gardant les mêmes joueurs. */
export async function playAgain(room) {
  const players = room.state.players.map((p) => ({ id: p.id, name: p.name, hand: [] }));
  const newState = {
    status: 'lobby',
    players,
    hostId: room.state.hostId,
    turnOrder: [],
    currentPlayerId: null,
    oddCardId: null,
    loserId: null,
    lastDraw: null,
    log: [...room.state.log, { ts: Date.now(), message: 'Nouvelle partie.' }].slice(-40)
  };
  return updateRoomState(room.id, room.version, newState);
}

export function watchRoom(roomId, onChange) {
  return subscribeRoom(roomId, onChange);
}

export { fetchRoomById };
