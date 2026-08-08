// Point d'assemblage : découvre dynamiquement tous les jeux (src/game/<id>.js,
// chacun exportant au minimum `initGame` + `meta`) et les combine avec les
// mécaniques transverses de core.js (salons, présence, hôte). Ajouter un jeu
// = ajouter son fichier <id>.js (+ <id>.bot.js, <id>.rules.js,
// src/ui/games/<id>.js) — seuls les wrappers d'action ci-dessous doivent
// encore être ajoutés à la main (voir "Ajouter un jeu" dans README.md).
import * as core from './core.js';

export {
  ConflictError,
  fetchRoomById,
  initRelay,
  isRelayActive,
  stopRelay,
  getLocalProfile,
  createLocalIdentity,
  renameLocalPlayer,
  listActiveRooms,
  ensureMembership,
  leaveTable,
  kickPlayer,
  addBot,
  claimHost,
  reclaimStaleHost,
  pingHostPresence,
  pingPlayerPresence,
  reclaimStalePlayers,
  playAgain,
  reportRelayStatus,
  watchRoom,
  HOST_STALE_MS,
  PLAYER_STALE_MS,
  PLAYER_STALE_MS_PER_HUMAN,
  playerStaleMs
} from './core.js';

// Modules `<id>.js` de chaque jeu. `engine.js`/`core.js` explicitement
// exclus (pas de self-import) ; le filtre ci-dessous (présence de `meta` +
// `initGame`) écarte de toute façon `deck.js` et les futurs `.bot.js`/
// `.rules.js`/`.ui.js`, qui n'exportent pas cette forme.
const gameModules = import.meta.glob(['./*.js', '!./engine.js', '!./core.js'], { eager: true });

const GAME_INITIALIZERS = {};
const AVAILABLE_GAMES_LIST = [];
for (const path in gameModules) {
  const mod = gameModules[path];
  if (!mod.meta || typeof mod.initGame !== 'function') continue; // core.js, deck.js, etc. — pas un jeu
  GAME_INITIALIZERS[mod.meta.id] = mod;
  AVAILABLE_GAMES_LIST.push(mod.meta);
}
AVAILABLE_GAMES_LIST.sort((a, b) => a.label.localeCompare(b.label, 'fr'));

export const AVAILABLE_GAMES = AVAILABLE_GAMES_LIST;
const DEFAULT_GAME = AVAILABLE_GAMES_LIST.find((g) => g.id === 'pouilleux')?.id || AVAILABLE_GAMES_LIST[0]?.id;

/** Crée un nouveau salon vide (salle d'attente) sur le premier jeu disponible. */
export async function createNewRoom() {
  return core.createNewRoom(DEFAULT_GAME);
}

export async function startGame(room, gameType = DEFAULT_GAME) {
  return core.startGame(room, gameType, GAME_INITIALIZERS);
}

export async function continueGame(room) {
  return core.continueGame(room, GAME_INITIALIZERS);
}

import { applyDraw } from './pouilleux.js';
import { applyPlay as applyTrouducPlay, applyPass as applyTrouducPass, applyExchangeChoice } from './trouduc.js';
import { applyPlay as applyAmericainPlay, applyDraw as applyAmericainDraw } from './americain.js';
import { applyHit as applyBlackjackHit, applyStand as applyBlackjackStand, clampBet as clampBlackjackBet } from './blackjack.js';
import { applyHit as applyFlip7Hit, applyStay as applyFlip7Stay } from './flip7.js';
import {
  applyDrawFromDeck as applySkyjoDrawDeck,
  applyDrawFromDiscard as applySkyjoDrawDiscard,
  applyPlaceCard as applySkyjoPlaceCard,
  applyDiscardAndReveal as applySkyjoDiscardAndReveal
} from './skyjo.js';
import {
  applyDraw as applySuiteInfernaleDraw,
  applyPlaySequenceCard as applySuiteInfernalePlaySequenceCard,
  applyPlayRejouer as applySuiteInfernalePlayRejouer,
  applyPlayAttack as applySuiteInfernalePlayAttack,
  applyRespondToAttack as applySuiteInfernaleRespondToAttack,
  applyDiscard as applySuiteInfernaleDiscard
} from './suiteinfernale.js';
import {
  applyDrawFromStock as applyCinqRoisDrawStock,
  applyDrawFromDiscard as applyCinqRoisDrawDiscard,
  applyDiscard as applyCinqRoisDiscard
} from './cinqrois.js';
import {
  applyDrawFromStock as applyLuckyNumbersDrawStock,
  applyTakeFromDiscard as applyLuckyNumbersTakeFromDiscard,
  applyPlaceDrawn as applyLuckyNumbersPlaceDrawn,
  applyDiscardDrawn as applyLuckyNumbersDiscardDrawn
} from './luckynumbers.js';
import {
  applyRevealCenter as applyTrioRevealCenter,
  applyRevealRow as applyTrioRevealRow,
  applyConfirmTurn as applyTrioConfirmTurn
} from './trio.js';

const { commitGameAction, updateRoomState } = core;

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
  return commitGameAction(room, (state) => applyDraw(state, playerId, cardIndex));
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
  return commitGameAction(room, (state) => applyFlip7Hit(state, playerId));
}

/** Reste sur sa main à Flip 7. */
export async function stayFlip7(room, playerId) {
  return commitGameAction(room, (state) => applyFlip7Stay(state, playerId));
}

/** Pioche la carte du dessus de la pioche à Skyjo (à placer, ou à défausser en retournant une case, ensuite). */
export async function drawSkyjoFromDeck(room, playerId) {
  return commitGameAction(room, (state) => applySkyjoDrawDeck(state, playerId));
}

/** Prend la carte visible de la défausse à Skyjo (doit obligatoirement être placée sur la grille ensuite). */
export async function drawSkyjoFromDiscard(room, playerId) {
  return commitGameAction(room, (state) => applySkyjoDrawDiscard(state, playerId));
}

/** Place la carte piochée à Skyjo sur une case de sa grille. */
export async function placeSkyjoCard(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applySkyjoPlaceCard(state, playerId, gridIndex));
}

/** Défausse la carte piochée du sabot à Skyjo (jamais celle de la défausse) et retourne une case cachée à la place. */
export async function discardSkyjoAndReveal(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applySkyjoDiscardAndReveal(state, playerId, gridIndex));
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
  return commitGameAction(room, (state) => applyCinqRoisDrawStock(state, playerId));
}

/** Prend la carte visible de la défausse aux Cinq Rois. */
export async function drawCinqRoisFromDiscard(room, playerId) {
  return commitGameAction(room, (state) => applyCinqRoisDrawDiscard(state, playerId));
}

/** Défausse une carte aux Cinq Rois, en posant éventuellement toute sa main du même coup (`goOut`). */
export async function discardCinqRois(room, playerId, cardId, goOut = false) {
  return commitGameAction(room, (state) => applyCinqRoisDiscard(state, playerId, cardId, goOut));
}

/** Lucky Numbers — pioche un trèfle face cachée. */
export async function drawLuckyNumbersFromStock(room, playerId) {
  return commitGameAction(room, (state) => applyLuckyNumbersDrawStock(state, playerId));
}

/** Lucky Numbers — prend un trèfle visible de la défausse et le place. */
export async function takeLuckyNumbersFromDiscard(room, playerId, tileId, boardIndex) {
  return commitGameAction(room, (state) => applyLuckyNumbersTakeFromDiscard(state, playerId, tileId, boardIndex));
}

/** Lucky Numbers — place la tuile piochée sur le plateau. */
export async function placeLuckyNumbersDrawn(room, playerId, boardIndex) {
  return commitGameAction(room, (state) => applyLuckyNumbersPlaceDrawn(state, playerId, boardIndex));
}

/** Lucky Numbers — défausse la tuile piochée face visible. */
export async function discardLuckyNumbersDrawn(room, playerId) {
  return commitGameAction(room, (state) => applyLuckyNumbersDiscardDrawn(state, playerId));
}

/** Trio — révèle une carte du centre (identifiée par son id). */
export async function revealTrioCenter(room, playerId, cardId) {
  return commitGameAction(room, (state) => applyTrioRevealCenter(state, playerId, cardId));
}

/** Trio — révèle l'extrémité (`'low'`/`'high'`) de la main d'un joueur (soi-même ou un adversaire). */
export async function revealTrioRow(room, playerId, targetPlayerId, end) {
  return commitGameAction(room, (state) => applyTrioRevealRow(state, playerId, targetPlayerId, end));
}

/** Trio — confirme le résultat de la tentative en cours (remet en place, ou attribue le trio) et passe le tour. */
export async function confirmTrioTurn(room, playerId) {
  return commitGameAction(room, (state) => applyTrioConfirmTurn(state, playerId));
}
