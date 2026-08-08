import { shuffle } from './deck.js';

export const meta = { id: 'luckynumbers', label: 'Lucky Numbers', hint: '2 à 4 joueurs — remplis ton jardin en ordre croissant', minPlayers: 2, maxPlayers: 4 };

/** Grille 4×4 — Lucky Numbers (Michael Schacht / Tiki Editions). */
export const GRID_SIZE = 16;
export const GRID_DIM = 4;
/** Cases de la diagonale dorée (mise en place) : (0,0) (1,1) (2,2) (3,3). */
export const DIAGONAL_INDEXES = [0, 5, 10, 15];

const COLORS = ['yellow', 'red', 'violet', 'green'];

/**
 * Une série 1–20 par joueur (2 à 4 joueurs). Les couleurs ne servent qu'à
 * constituer le matériel ; en jeu elles n'ont plus d'importance.
 */
function buildTiles(playerCount) {
  const tiles = [];
  for (let c = 0; c < playerCount; c++) {
    const color = COLORS[c];
    for (let v = 1; v <= 20; v++) {
      tiles.push({ id: `${color}-${v}`, value: v, color });
    }
  }
  return shuffle(tiles);
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function emptyCells(board) {
  return board.reduce((n, cell) => n + (cell ? 0 : 1), 0);
}

function isBoardFull(board) {
  return board.every(Boolean);
}

/**
 * Vérifie qu'une valeur `value` peut occuper l'index `index` sur `board`
 * (en ignorant l'ancienne valeur de cette case si on échange).
 * Ordre strictement croissant dans la rangée (G→D) et la colonne (H→B).
 */
export function canPlace(board, index, value) {
  if (index < 0 || index >= GRID_SIZE) return false;
  const row = Math.floor(index / GRID_DIM);
  const col = index % GRID_DIM;

  for (let c = 0; c < GRID_DIM; c++) {
    const i = row * GRID_DIM + c;
    if (i === index) continue;
    const cell = board[i];
    if (!cell) continue;
    if (c < col && cell.value >= value) return false;
    if (c > col && cell.value <= value) return false;
  }

  for (let r = 0; r < GRID_DIM; r++) {
    const i = r * GRID_DIM + col;
    if (i === index) continue;
    const cell = board[i];
    if (!cell) continue;
    if (r < row && cell.value >= value) return false;
    if (r > row && cell.value <= value) return false;
  }

  return true;
}

/** Toutes les cases où `value` peut être posée (case libre ou échange). */
export function validPlacements(board, value) {
  const indexes = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (canPlace(board, i, value)) indexes.push(i);
  }
  return indexes;
}

/**
 * Place `tile` à `index`. Si la case était occupée, l'ancienne tuile est
 * renvoyée (à défausser) ; sinon `replaced` vaut null.
 */
function placeOnBoard(board, index, tile) {
  const next = board.slice();
  const replaced = next[index] || null;
  next[index] = tile;
  return { board: next, replaced };
}

function finishGame(state, players, explicitWinnerIds = null) {
  let winnerIds = explicitWinnerIds;
  if (!winnerIds) {
    const minEmpty = Math.min(...players.map((p) => emptyCells(p.board)));
    winnerIds = players.filter((p) => emptyCells(p.board) === minEmpty).map((p) => p.id);
  }
  return {
    ...state,
    players,
    status: 'finished',
    currentPlayerId: null,
    drawnTile: null,
    winnerIds,
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message:
          winnerIds.length === 1
            ? `${players.find((p) => p.id === winnerIds[0])?.name || '?'} complète son jardin et gagne !`
            : `Fin de pioche — vainqueur${winnerIds.length > 1 ? 's' : ''} : ${winnerIds
                .map((id) => players.find((p) => p.id === id)?.name || '?')
                .join(', ')}`
      }
    ].slice(-40)
  };
}

/**
 * Mise en place automatique : 4 tuiles piochées, posées sur la diagonale
 * en ordre croissant (petits nombres en haut à gauche). Évite une phase
 * de setup interactive peu pratique en multi-écrans / bots.
 */
export function initGame(players) {
  if (players.length < 2 || players.length > 4) {
    throw new Error('Lucky Numbers se joue de 2 à 4 joueurs.');
  }

  let stock = buildTiles(players.length);
  const turnOrder = players.map((p) => p.id);

  const resolvedPlayers = players.map((p) => {
    const setup = stock.splice(0, 4).sort((a, b) => a.value - b.value);
    const board = Array(GRID_SIZE).fill(null);
    DIAGONAL_INDEXES.forEach((idx, i) => {
      board[idx] = setup[i];
    });
    return {
      id: p.id,
      name: p.name,
      isBot: Boolean(p.isBot),
      board
    };
  });

  return {
    status: 'playing',
    stock,
    discard: [],
    drawnTile: null,
    players: resolvedPlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
    winnerIds: null,
    log: [{ ts: Date.now(), message: 'Lucky Numbers — les jardins sont prêts, à vous de jouer !' }]
  };
}

/** A) Piocher un trèfle face cachée. */
export function applyDrawFromStock(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (state.drawnTile) throw new Error('Vous avez déjà une tuile en main.');
  if (state.stock.length === 0) throw new Error('La pioche est vide.');

  const stock = state.stock.slice();
  const drawnTile = stock.shift();
  const stockExhausted = stock.length === 0;

  return {
    ...state,
    stock,
    drawnTile,
    stockExhaustedOnDraw: stockExhausted,
    log: [...state.log, { ts: Date.now(), message: `Pioche un trèfle : ${drawnTile.value}` }].slice(-40)
  };
}

/**
 * B) Récupérer un trèfle visible de la défausse et le placer immédiatement
 * sur le plateau (pas de "tenir en main" : la pose est obligatoire).
 */
export function applyTakeFromDiscard(state, playerId, tileId, boardIndex) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (state.drawnTile) throw new Error('Terminez d\'abord avec la tuile piochée.');

  const discardIdx = state.discard.findIndex((t) => t.id === tileId);
  if (discardIdx === -1) throw new Error('Cette tuile n\'est pas dans la défausse.');

  const tile = state.discard[discardIdx];
  const players = state.players.map((p) => ({ ...p, board: p.board.slice() }));
  const current = players.find((p) => p.id === playerId);
  if (!current) throw new Error('Joueur introuvable.');

  if (!canPlace(current.board, boardIndex, tile.value)) {
    throw new Error('Pose impossible : l\'ordre croissant n\'est pas respecté.');
  }

  const { board, replaced } = placeOnBoard(current.board, boardIndex, tile);
  current.board = board;

  const discard = state.discard.slice();
  discard.splice(discardIdx, 1);
  if (replaced) discard.push(replaced);

  if (isBoardFull(current.board)) {
    return finishGame(state, players, [playerId]);
  }

  return {
    ...state,
    players,
    discard,
    drawnTile: null,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message: replaced
          ? `Échange ${tile.value} contre ${replaced.value}`
          : `Place ${tile.value} depuis la défausse`
      }
    ].slice(-40)
  };
}

/**
 * Place la tuile piochée (drawnTile) sur le plateau, ou l'échange.
 * Si c'était le dernier trèfle de la pioche, la partie se termine ensuite
 * (moins de cases libres gagne).
 */
export function applyPlaceDrawn(state, playerId, boardIndex) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (!state.drawnTile) throw new Error('Aucune tuile piochée à placer.');

  const tile = state.drawnTile;
  const players = state.players.map((p) => ({ ...p, board: p.board.slice() }));
  const current = players.find((p) => p.id === playerId);
  if (!current) throw new Error('Joueur introuvable.');

  if (!canPlace(current.board, boardIndex, tile.value)) {
    throw new Error('Pose impossible : l\'ordre croissant n\'est pas respecté.');
  }

  const { board, replaced } = placeOnBoard(current.board, boardIndex, tile);
  current.board = board;

  const discard = state.discard.slice();
  if (replaced) discard.push(replaced);

  if (isBoardFull(current.board)) {
    return finishGame({ ...state, discard, drawnTile: null, stockExhaustedOnDraw: false }, players, [playerId]);
  }

  if (state.stockExhaustedOnDraw) {
    return finishGame({ ...state, discard, drawnTile: null, stockExhaustedOnDraw: false }, players, null);
  }

  return {
    ...state,
    players,
    discard,
    drawnTile: null,
    stockExhaustedOnDraw: false,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message: replaced
          ? `Échange ${tile.value} contre ${replaced.value}`
          : `Place ${tile.value}`
      }
    ].slice(-40)
  };
}

/** Défausse la tuile piochée face visible (ne veut / ne peut pas la placer). */
export function applyDiscardDrawn(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (!state.drawnTile) throw new Error('Aucune tuile piochée à défausser.');

  const tile = state.drawnTile;
  const discard = [...state.discard, tile];
  const players = state.players;

  if (state.stockExhaustedOnDraw) {
    return finishGame(
      { ...state, discard, drawnTile: null, stockExhaustedOnDraw: false },
      players,
      null
    );
  }

  return {
    ...state,
    discard,
    drawnTile: null,
    stockExhaustedOnDraw: false,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    log: [...state.log, { ts: Date.now(), message: `Défausse ${tile.value}` }].slice(-40)
  };
}
