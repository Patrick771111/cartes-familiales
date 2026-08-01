import { createRoom, fetchRoomByCode, fetchRoomById, updateRoomState, subscribeRoom, ConflictError } from '../supabase/sync.js';
import { initGame, applyDraw } from './pouilleux.js';

function uuid() {
  return crypto.randomUUID();
}

function playerStorageKey(code) {
  return `cartes-familiales:player:${code.toUpperCase()}`;
}

export function getLocalPlayer(code) {
  const raw = localStorage.getItem(playerStorageKey(code));
  return raw ? JSON.parse(raw) : null;
}

function saveLocalPlayer(code, player) {
  localStorage.setItem(playerStorageKey(code), JSON.stringify(player));
}

export async function hostNewRoom(hostName) {
  const hostId = uuid();
  const initialState = {
    status: 'lobby',
    players: [{ id: hostId, name: hostName, hand: [] }],
    hostId,
    turnOrder: [],
    currentPlayerId: null,
    oddCardId: null,
    loserId: null,
    log: [{ ts: Date.now(), message: `${hostName} a créé la partie.` }]
  };
  const room = await createRoom(initialState, 'pouilleux');
  saveLocalPlayer(room.code, { id: hostId, name: hostName });
  return room;
}

/** Rejoint une partie en cours de lobby. Relit et réessaie en cas de conflit d'écriture. */
export async function joinRoom(code, playerName) {
  const upperCode = code.toUpperCase();
  const existing = getLocalPlayer(upperCode);
  if (existing) {
    const room = await fetchRoomByCode(upperCode);
    if (room && room.state.players.some((p) => p.id === existing.id)) return { room, player: existing };
  }

  const playerId = uuid();
  const player = { id: playerId, name: playerName };

  for (let attempt = 0; attempt < 5; attempt++) {
    const room = await fetchRoomByCode(upperCode);
    if (!room) throw new Error("Aucune partie ne correspond à ce code.");
    if (room.state.status !== 'lobby') throw new Error('La partie a déjà commencé.');
    if (room.state.players.length >= 8) throw new Error('La table est complète.');

    const newState = {
      ...room.state,
      players: [...room.state.players, { id: playerId, name: playerName, hand: [] }],
      log: [...room.state.log, { ts: Date.now(), message: `${playerName} a rejoint la partie.` }]
    };

    try {
      const updated = await updateRoomState(room.id, room.version, newState);
      saveLocalPlayer(upperCode, player);
      return { room: updated, player };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // quelqu'un d'autre a écrit en même temps -> on relit et retente
    }
  }
  throw new Error('Impossible de rejoindre la partie, réessaie.');
}

export async function startGame(room) {
  if (room.state.players.length < 2) throw new Error('Il faut au moins 2 joueurs.');
  const gameState = initGame(room.state.players.map(({ id, name }) => ({ id, name })));
  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Fait piocher le joueur courant. En cas de conflit (rare : un seul joueur agit à la fois
 * normalement), relit l'état à jour et abandonne l'action plutôt que de la rejouer à l'aveugle.
 */
export async function drawForCurrentPlayer(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  // On laisse volontairement l'appelant gérer ConflictError : il resynchronisera via
  // l'abonnement realtime (watchRoom) plutôt que de rejouer l'action à l'aveugle.
  return updateRoomState(room.id, room.version, newState);
}

export function watchRoom(roomId, onChange) {
  return subscribeRoom(roomId, onChange);
}

export { fetchRoomByCode, fetchRoomById };
