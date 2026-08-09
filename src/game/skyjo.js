import { shuffle } from './deck.js';
import { commitGameAction } from './core.js';

// Répartition officielle du jeu physique Skyjo : 150 cartes — -2 (×5),
// -1 (×10), 0 (×15), 1 à 12 (×10 chacune).
export const TARGET_SCORE = 100;

export const meta = { id: 'skyjo', label: 'Skyjo', hint: "2 à 6 joueurs, moins de points c'est mieux", minPlayers: 2 };

const COUNTS = { '-2': 5, '-1': 10, 0: 15 };
for (let v = 1; v <= 12; v++) COUNTS[v] = 10;

// Grille 3 lignes × 4 colonnes (12 cases), colonnes = ces 4 groupes de 3 index.
export const COLUMNS = [
  [0, 4, 8],
  [1, 5, 9],
  [2, 6, 10],
  [3, 7, 11]
];
const GRID_SIZE = 12;
const REVEALED_AT_START = 2;

function buildDeck() {
  const cards = [];
  for (const [value, count] of Object.entries(COUNTS)) {
    for (let i = 0; i < count; i++) {
      cards.push({ id: `${value}-${i}`, value: Number(value) });
    }
  }
  return cards;
}

/** Score d'un joueur : somme des cartes encore en jeu (les colonnes effacées ne comptent pas). */
export function computeGridScore(grid) {
  return grid.reduce((sum, cell) => sum + (cell ? cell.card.value : 0), 0);
}

/** Une grille est complète quand toutes les cases sont soit effacées, soit face visible. */
function isGridComplete(grid) {
  return grid.every((cell) => !cell || cell.faceUp);
}

/** Efface toute colonne dont les 3 cases sont face visible avec la même valeur. */
function clearMatchingColumns(grid) {
  const next = grid.slice();
  let discarded = [];
  for (const col of COLUMNS) {
    const cells = col.map((i) => next[i]);
    if (cells.every((c) => c && c.faceUp) && cells[0].card.value === cells[1].card.value && cells[1].card.value === cells[2].card.value) {
      discarded = discarded.concat(cells.map((c) => c.card));
      col.forEach((i) => {
        next[i] = null;
      });
    }
  }
  return { grid: next, discarded };
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function drawFromStock(stock, discard, count) {
  let currentStock = stock.slice();
  let currentDiscard = discard.slice();
  const cards = [];
  for (let i = 0; i < count; i++) {
    if (currentStock.length === 0) {
      if (currentDiscard.length <= 1) break;
      const top = currentDiscard[currentDiscard.length - 1];
      currentStock = shuffle(currentDiscard.slice(0, -1));
      currentDiscard = [top];
    }
    cards.push(currentStock.shift());
  }
  return { cards, stock: currentStock, discard: currentDiscard };
}

/**
 * Résout la fin de manche : révèle toutes les cartes encore cachées, calcule le
 * score de chacun, double celui du joueur qui a terminé sa grille en premier
 * s'il n'a pas le score strictement le plus bas de la manche (règle Skyjo),
 * puis ajoute au score cumulé. Victoire de partie dès qu'un score cumulé
 * atteint `TARGET_SCORE` : le plus bas des scores cumulés gagne (au Skyjo,
 * moins de points c'est mieux).
 */
function finishRound(state, players, roundEndingPlayerId) {
  const revealedPlayers = players.map((p) => ({
    ...p,
    grid: p.grid.map((cell) => (cell ? { ...cell, faceUp: true } : null))
  }));

  const roundScores = {};
  revealedPlayers.forEach((p) => {
    roundScores[p.id] = computeGridScore(p.grid);
  });

  if (roundEndingPlayerId) {
    const endingScore = roundScores[roundEndingPlayerId];
    const isStrictlyLowest = revealedPlayers.every((p) => p.id === roundEndingPlayerId || endingScore < roundScores[p.id]);
    if (!isStrictlyLowest) roundScores[roundEndingPlayerId] *= 2;
  }

  const resolvedPlayers = revealedPlayers.map((p) => ({
    ...p,
    roundScore: roundScores[p.id],
    score: p.score + roundScores[p.id]
  }));

  const eligible = resolvedPlayers.filter((p) => p.score >= TARGET_SCORE);
  const gameWinnerId = eligible.length
    ? resolvedPlayers.reduce((best, p) => (p.score < best.score ? p : best), resolvedPlayers[0]).id
    : null;

  return {
    ...state,
    players: resolvedPlayers,
    status: 'finished',
    currentPlayerId: null,
    drawnCard: null,
    roundEndingPlayerId,
    gameWinnerId,
    log: [...state.log, { ts: Date.now(), message: 'Manche terminée, les grilles sont révélées.' }].slice(-40)
  };
}

/**
 * Crée l'état initial d'une manche : grille de 12 cartes cachées par joueur,
 * 2 révélées au hasard chacun (choisir *quelle* case révéler n'apporterait
 * aucune information puisque leur contenu est de toute façon inconnu avant de
 * les retourner — simplification volontaire par rapport à un vrai choix
 * manuel). `previousScores` (optionnel) = `{ [playerId]: score }` fourni par
 * `continueGame` (engine.js) pour enchaîner sans repasser par le lobby.
 */
export function initGame(players, previousScores = null) {
  if (players.length < 2) {
    throw new Error('Il faut au moins 2 joueurs pour Skyjo.');
  }

  const deck = shuffle(buildDeck());
  let cursor = 0;

  const gamePlayers = players.map((p) => {
    const cards = deck.slice(cursor, cursor + GRID_SIZE);
    cursor += GRID_SIZE;
    const revealedIndexes = new Set();
    while (revealedIndexes.size < REVEALED_AT_START) {
      revealedIndexes.add(Math.floor(Math.random() * GRID_SIZE));
    }
    const grid = cards.map((card, i) => ({ card, faceUp: revealedIndexes.has(i) }));
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot || false,
      grid,
      score: previousScores?.[p.id] ?? 0,
      roundScore: null
    };
  });

  const discardStart = deck[cursor];
  cursor += 1;

  // Ordre de jeu aléatoire, fixé pour toute la partie (pas l'ordre d'arrivée en salle).
  const turnOrder = shuffle(players.map((p) => p.id));

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
    deck: deck.slice(cursor),
    discard: [discardStart],
    drawnCard: null,
    roundEndingPlayerId: null,
    finalTurnsRemaining: null,
    gameWinnerId: null,
    log: [{ ts: Date.now(), message: 'Nouvelle manche : 2 cartes révélées chacun, à vous de jouer !' }]
  };
}

/**
 * Enchaîne une manche en reconduisant les scores cumulés — sauf si la PARTIE
 * (pas juste la manche) vient d'être gagnée, auquel cas on repart à 0.
 */
export function continueRound(room, playersList) {
  const previousScores = room.state.gameWinnerId
    ? null
    : Object.fromEntries(room.state.players.map((p) => [p.id, p.score]));
  return initGame(playersList, previousScores);
}

/** Pioche la carte du dessus de la pioche : à placer ou à défausser en retournant une case, au choix. */
export function applyDrawFromDeck(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.drawnCard) throw new Error('Une carte est déjà en attente de placement.');

  const drawn = drawFromStock(state.deck, state.discard, 1);
  if (!drawn.cards.length) throw new Error('Plus aucune carte à piocher.');

  return {
    ...state,
    deck: drawn.stock,
    discard: drawn.discard,
    drawnCard: { card: drawn.cards[0], source: 'deck' }
  };
}

/** Prend la carte visible du dessus de la défausse : doit obligatoirement être placée sur la grille. */
export function applyDrawFromDiscard(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.drawnCard) throw new Error('Une carte est déjà en attente de placement.');
  if (!state.discard.length) throw new Error('La défausse est vide.');

  const discard = state.discard.slice();
  const card = discard.pop();

  return {
    ...state,
    discard,
    drawnCard: { card, source: 'discard' }
  };
}

/** Termine le tour : avance normalement, ou décompte les derniers tours si la manche se termine. */
function advanceTurn(state, players, playerId, roundJustEnded) {
  let nextState = { ...state, players, drawnCard: null };

  if (roundJustEnded && !state.roundEndingPlayerId) {
    nextState.roundEndingPlayerId = playerId;
    nextState.finalTurnsRemaining = state.turnOrder.length - 1;
  } else if (state.roundEndingPlayerId) {
    nextState.finalTurnsRemaining = state.finalTurnsRemaining - 1;
  }

  if (nextState.roundEndingPlayerId && nextState.finalTurnsRemaining <= 0) {
    return finishRound(nextState, players, nextState.roundEndingPlayerId);
  }

  nextState.currentPlayerId = nextPlayerId(state.turnOrder, playerId);
  return nextState;
}

/** Place la carte en attente sur une case de sa grille (l'ancienne carte, si présente, part à la défausse face visible). */
export function applyPlaceCard(state, playerId, gridIndex) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.drawnCard) throw new Error("Pioche d'abord une carte.");
  if (gridIndex < 0 || gridIndex >= GRID_SIZE) throw new Error('Case invalide.');

  const players = state.players.map((p) => ({ ...p, grid: p.grid.slice() }));
  const current = players.find((p) => p.id === playerId);
  const oldCell = current.grid[gridIndex];
  if (!oldCell) throw new Error('Cette case est déjà effacée.');

  let discard = state.discard.slice();
  discard.push(oldCell.card);
  current.grid[gridIndex] = { card: state.drawnCard.card, faceUp: true };

  const { grid: clearedGrid, discarded } = clearMatchingColumns(current.grid);
  current.grid = clearedGrid;
  discard = [...discard, ...discarded];

  const logMessage = { ts: Date.now(), message: `${current.name} place ${state.drawnCard.card.value} sur sa grille${discarded.length ? ' — colonne effacée !' : ''}.` };

  const roundJustEnded = isGridComplete(current.grid);
  const nextState = advanceTurn({ ...state, discard, log: [...state.log, logMessage].slice(-40) }, players, playerId, roundJustEnded);
  return nextState;
}

/** Défausse la carte piochée du sabot (jamais celle de la défausse) sans la jouer, et retourne une case cachée à la place. */
export function applyDiscardAndReveal(state, playerId, gridIndex) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.drawnCard) throw new Error("Pioche d'abord une carte.");
  if (state.drawnCard.source !== 'deck') throw new Error('Une carte prise à la défausse doit être placée sur la grille.');
  if (gridIndex < 0 || gridIndex >= GRID_SIZE) throw new Error('Case invalide.');

  const players = state.players.map((p) => ({ ...p, grid: p.grid.slice() }));
  const current = players.find((p) => p.id === playerId);
  const cell = current.grid[gridIndex];
  if (!cell) throw new Error('Cette case est déjà effacée.');
  if (cell.faceUp) throw new Error('Cette case est déjà visible.');

  current.grid[gridIndex] = { ...cell, faceUp: true };
  const { grid: clearedGrid, discarded } = clearMatchingColumns(current.grid);
  current.grid = clearedGrid;

  const discard = [...state.discard, state.drawnCard.card, ...discarded];
  const logMessage = { ts: Date.now(), message: `${current.name} défausse sa pioche et retourne une case${discarded.length ? ' — colonne effacée !' : ''}.` };

  const roundJustEnded = isGridComplete(current.grid);
  return advanceTurn({ ...state, discard, log: [...state.log, logMessage].slice(-40) }, players, playerId, roundJustEnded);
}

/** Pioche la carte du dessus de la pioche à Skyjo (à placer, ou à défausser en retournant une case, ensuite). */
export async function drawSkyjoFromDeck(room, playerId) {
  return commitGameAction(room, (state) => applyDrawFromDeck(state, playerId));
}

/** Prend la carte visible de la défausse à Skyjo (doit obligatoirement être placée sur la grille ensuite). */
export async function drawSkyjoFromDiscard(room, playerId) {
  return commitGameAction(room, (state) => applyDrawFromDiscard(state, playerId));
}

/** Place la carte piochée à Skyjo sur une case de sa grille. */
export async function placeSkyjoCard(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applyPlaceCard(state, playerId, gridIndex));
}

/** Défausse la carte piochée du sabot à Skyjo (jamais celle de la défausse) et retourne une case cachée à la place. */
export async function discardSkyjoAndReveal(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applyDiscardAndReveal(state, playerId, gridIndex));
}
