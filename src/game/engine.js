import {
  getOrCreateRoomByCode,
  fetchRoomById,
  updateRoomState,
  subscribeRoom,
  ConflictError
} from '../supabase/sync.js';
import { initGame as initPouilleux, applyDraw } from './pouilleux.js';
import { initGame as initTrouduc, applyPlay as applyTrouducPlay, applyPass as applyTrouducPass, applyExchangeChoice } from './trouduc.js';

const GAME_INITIALIZERS = {
  pouilleux: initPouilleux,
  trouduc: initTrouduc
};

export const AVAILABLE_GAMES = [
  { id: 'pouilleux', label: 'Le Pouilleux', hint: '2 à 4 joueurs' },
  { id: 'trouduc', label: 'Le Trou du Cul', hint: 'exactement 4 joueurs' }
];

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

    if (fresh.state.status === 'playing') {
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

/**
 * Retire le profil local de la liste des joueurs de la table. Impossible en pleine
 * partie (ça casserait la distribution/l'ordre du tour) : uniquement en salle
 * d'attente ou une fois la manche terminée.
 */
/** Choisit le nouvel hôte parmi les joueurs restants : toujours un humain en priorité (un bot ne peut pas cliquer sur "Lancer la partie"). */
function pickNewHost(remainingPlayers) {
  const human = remainingPlayers.find((p) => !p.isBot);
  return human?.id || remainingPlayers[0]?.id || null;
}

export async function leaveTable(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (!fresh.state.players.some((p) => p.id === profile.id)) return fresh; // déjà parti
    if (fresh.state.status === 'playing') {
      throw new Error('Impossible de quitter en pleine partie — attends la fin de la manche.');
    }

    const remainingPlayers = fresh.state.players.filter((p) => p.id !== profile.id);
    const newHostId = fresh.state.hostId === profile.id ? pickNewHost(remainingPlayers) : fresh.state.hostId;
    const newState = {
      ...fresh.state,
      players: remainingPlayers,
      hostId: newHostId,
      log: [...fresh.state.log, { ts: Date.now(), message: `${profile.name} a quitté la table.` }]
    };

    try {
      return await updateRoomState(fresh.id, fresh.version, newState);
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
    if (fresh.state.status === 'playing') {
      throw new Error('Impossible de retirer un joueur en pleine partie.');
    }

    const remainingPlayers = fresh.state.players.filter((p) => p.id !== targetId);
    const newHostId = fresh.state.hostId === targetId ? pickNewHost(remainingPlayers) : fresh.state.hostId;
    const newState = {
      ...fresh.state,
      players: remainingPlayers,
      hostId: newHostId,
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

/** Ajoute un bot à la table (hôte uniquement, en salle d'attente). Limité à 4 joueurs au total. */
export async function addBot(room) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible d'ajouter un bot en pleine partie.");
    if (fresh.state.players.length >= 4) throw new Error('Table complète (4 joueurs maximum).');

    const botNumber = fresh.state.players.filter((p) => p.isBot).length + 1;
    const botName = `Bot ${botNumber}`;
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
 * un bot (ex: après le départ de l'hôte humain). Porte de sortie pour ne pas
 * rester bloqué, personne ne pouvant retirer un bot hôte sans être hôte soi-même.
 */
export async function claimHost(room, profile) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const fresh = await fetchRoomById(room.id);
    if (fresh.state.status === 'playing') throw new Error("Impossible de changer d'hôte en pleine partie.");
    if (!fresh.state.players.some((p) => p.id === profile.id)) throw new Error("Tu n'es pas (encore) à cette table.");

    const currentHost = fresh.state.players.find((p) => p.id === fresh.state.hostId);
    if (currentHost && !currentHost.isBot) {
      throw new Error('Il y a déjà un hôte humain à la table.');
    }

    const newState = {
      ...fresh.state,
      hostId: profile.id,
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

export async function startGame(room, gameType = 'pouilleux') {
  const initializer = GAME_INITIALIZERS[gameType];
  if (!initializer) throw new Error('Jeu inconnu.');

  if (gameType === 'trouduc') {
    if (room.state.players.length !== 4) {
      throw new Error('Le Trou du Cul se joue à 4 joueurs exactement.');
    }
    const gameState = initializer(
      room.state.players.map(({ id, name, isBot }) => ({ id, name, isBot })),
      room.state.previousTrouducRanking || null
    );
    const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
    return updateRoomState(room.id, room.version, newState, { game: gameType });
  }

  if (room.state.players.length < 2) throw new Error('Il faut au moins 2 joueurs.');
  const gameState = initializer(room.state.players.map(({ id, name, isBot }) => ({ id, name, isBot })));
  const newState = { ...room.state, ...gameState, hostId: room.state.hostId };
  return updateRoomState(room.id, room.version, newState, { game: gameType });
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

/** Remet la table en salle d'attente pour relancer une manche du même jeu, en gardant les mêmes joueurs. */
export async function playAgain(room) {
  const players = room.state.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot || false }));

  const justFinishedTrouduc = room.game === 'trouduc' && room.state.status === 'finished';
  const previousTrouducRanking = justFinishedTrouduc
    ? room.state.finishedOrder
    : room.state.previousTrouducRanking || null;

  const newState = {
    status: 'lobby',
    players: players.map((p) => ({ ...p, hand: [] })),
    hostId: room.state.hostId,
    turnOrder: [],
    currentPlayerId: null,
    previousTrouducRanking,
    log: [...room.state.log, { ts: Date.now(), message: 'Nouvelle partie.' }].slice(-40)
  };
  return updateRoomState(room.id, room.version, newState);
}

export function watchRoom(roomId, onChange) {
  return subscribeRoom(roomId, onChange);
}

export { fetchRoomById };
