import { shuffle } from './deck.js';
import { commitGameAction } from './core.js';

export const meta = {
  id: 'boop',
  label: 'Boop',
  hint: '2 joueurs — pose tes chatons, pousse, fais grandir tes chats',
  minPlayers: 2,
  maxPlayers: 2
};

export const GRID = 6;
export const GRID_SIZE = GRID * GRID;
export const PIECES_PER_PLAYER = 8;
export const COLORS = ['orange', 'gray'];

const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1]
];
const LINE_DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function inBounds(r, c) {
  return r >= 0 && r < GRID && c >= 0 && c < GRID;
}

export function cellIndex(row, col) {
  return row * GRID + col;
}

export function cellRow(index) {
  return Math.floor(index / GRID);
}

export function cellCol(index) {
  return index % GRID;
}

function makePool(playerId, color) {
  return Array.from({ length: PIECES_PER_PLAYER }, (_, i) => ({
    id: `${playerId}-${i}`,
    ownerId: playerId,
    type: 'kitten',
    color
  }));
}

function countOnBoard(board, playerId) {
  return board.filter((p) => p && p.ownerId === playerId).length;
}

function poolOf(players, playerId) {
  return players.find((p) => p.id === playerId)?.pool || [];
}

export function poolCounts(pool) {
  return {
    kitten: pool.filter((p) => p.type === 'kitten').length,
    cat: pool.filter((p) => p.type === 'cat').length
  };
}

function canBoop(pusher, target) {
  if (!pusher || !target) return false;
  if (pusher.type === 'kitten' && target.type === 'cat') return false;
  return true;
}

/** Poussées simultanées : destination occupée sur le plateau actuel = pas de mouvement. */
export function resolveBoops(board, fromIndex, pusher) {
  const next = board.slice();
  const toPool = [];
  const row = cellRow(fromIndex);
  const col = cellCol(fromIndex);
  const moves = [];

  for (const [dr, dc] of DIRS) {
    const r = row + dr;
    const c = col + dc;
    if (!inBounds(r, c)) continue;
    const i = cellIndex(r, c);
    const piece = board[i];
    if (!piece || !canBoop(pusher, piece)) continue;
    const nr = r + dr;
    const nc = c + dc;
    if (!inBounds(nr, nc)) {
      moves.push({ from: i, to: -1 });
      continue;
    }
    const dest = cellIndex(nr, nc);
    if (board[dest]) continue;
    moves.push({ from: i, to: dest });
  }

  const destCount = {};
  for (const m of moves) {
    if (m.to >= 0) destCount[m.to] = (destCount[m.to] || 0) + 1;
  }
  const applied = moves.filter((m) => m.to < 0 || destCount[m.to] === 1);
  const boops = [];

  for (const m of applied) {
    const piece = next[m.from];
    next[m.from] = null;
    boops.push({
      id: piece.id,
      from: m.from,
      to: m.to,
      ownerId: piece.ownerId,
      type: piece.type,
      color: piece.color
    });
    if (m.to < 0) toPool.push(piece);
    else next[m.to] = piece;
  }
  return { board: next, toPool, boops };
}

/**
 * Le pion qui vient d'arriver pousse ses 8 voisins ; chaque pion qui
 * atterrit pousse à son tour, jusqu'à ce que plus rien ne bouge.
 * La promotion (3 chatons) se calcule seulement après.
 */
export function resolveChainBoops(board, startIndex, startPiece) {
  let current = board.slice();
  const allBoops = [];
  const allToPool = [];
  const queue = [{ index: startIndex, piece: startPiece }];
  const didPush = new Set();
  let waves = 0;
  while (queue.length && waves < 32) {
    waves += 1;
    const { index, piece } = queue.shift();
    if (!piece || didPush.has(piece.id)) continue;
    if (current[index]?.id !== piece.id) continue;
    didPush.add(piece.id);
    const wave = resolveBoops(current, index, piece);
    current = wave.board;
    allToPool.push(...wave.toPool);
    for (const b of wave.boops) {
      allBoops.push(b);
      if (b.to >= 0) {
        const landed = current[b.to];
        if (landed && !didPush.has(landed.id)) queue.push({ index: b.to, piece: landed });
      }
    }
  }
  return { board: current, toPool: allToPool, boops: allBoops };
}

function linesOfThree(board, playerId, type) {
  const lines = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      for (const [dr, dc] of LINE_DIRS) {
        const cells = [];
        let ok = true;
        for (let k = 0; k < 3; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (!inBounds(rr, cc)) {
            ok = false;
            break;
          }
          const p = board[cellIndex(rr, cc)];
          if (!p || p.ownerId !== playerId || p.type !== type) {
            ok = false;
            break;
          }
          cells.push(cellIndex(rr, cc));
        }
        if (ok) lines.push(cells);
      }
    }
  }
  return lines;
}

function graduateKittens(board, players, playerId) {
  const lines = linesOfThree(board, playerId, 'kitten');
  if (!lines.length) return { board, players, graduated: [] };
  const indexes = new Set(lines.flat());
  const nextBoard = board.slice();
  const nextPlayers = players.map((p) => ({ ...p, pool: p.pool.slice() }));
  const owner = nextPlayers.find((p) => p.id === playerId);
  const graduated = [];
  for (const i of indexes) {
    const piece = nextBoard[i];
    if (!piece || piece.type !== 'kitten') continue;
    nextBoard[i] = null;
    const grown = { ...piece, type: 'cat' };
    owner.pool.push(grown);
    graduated.push({ id: piece.id, from: i, ownerId: piece.ownerId, color: piece.color });
  }
  return { board: nextBoard, players: nextPlayers, graduated };
}

function graduateAllPlayers(board, players) {
  let nextBoard = board;
  let nextPlayers = players;
  const graduated = [];
  for (const p of players) {
    const g = graduateKittens(nextBoard, nextPlayers, p.id);
    nextBoard = g.board;
    nextPlayers = g.players;
    graduated.push(...g.graduated);
  }
  return { board: nextBoard, players: nextPlayers, graduated };
}

function finishWin(state, players, playerId, reason) {
  const winner = players.find((p) => p.id === playerId);
  return {
    ...state,
    players,
    status: 'finished',
    currentPlayerId: null,
    winnerId: playerId,
    log: [...state.log, { ts: Date.now(), message: `${winner?.name || '?'} gagne${reason}` }].slice(-40)
  };
}

export function initGame(players) {
  if (players.length !== 2) throw new Error('Boop se joue à 2 joueurs.');
  const turnOrder = shuffle(players.map((p) => p.id));
  const gamePlayers = turnOrder.map((id, i) => {
    const p = players.find((pl) => pl.id === id);
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot || false,
      color: COLORS[i],
      pool: makePool(p.id, COLORS[i])
    };
  });
  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
    board: Array(GRID_SIZE).fill(null),
    winnerId: null,
    lastMove: null,
    log: [{ ts: Date.now(), message: 'À vos chatons ! Posez-en un sur une case vide.' }]
  };
}

export function applyPlace(state, playerId, index, pieceType) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (index < 0 || index >= GRID_SIZE) throw new Error('Case invalide.');
  if (state.board[index]) throw new Error('Cette case est occupée.');
  if (pieceType !== 'kitten' && pieceType !== 'cat') throw new Error('Choisis un chaton ou un chat.');

  const players = state.players.map((p) => ({ ...p, pool: p.pool.slice() }));
  const current = players.find((p) => p.id === playerId);
  const poolIndex = current.pool.findIndex((p) => p.type === pieceType);
  if (poolIndex < 0) throw new Error(pieceType === 'cat' ? "Tu n'as plus de chat." : "Tu n'as plus de chaton.");

  const piece = current.pool.splice(poolIndex, 1)[0];
  let board = state.board.slice();
  board[index] = piece;

  const booped = resolveChainBoops(board, index, piece);
  board = booped.board;
  for (const bounced of booped.toPool) {
    const owner = players.find((p) => p.id === bounced.ownerId);
    if (owner) owner.pool.push(bounced);
  }

  const label = pieceType === 'cat' ? 'chat' : 'chaton';
  let logMessage = `${current.name} pose un ${label}`;
  if (booped.toPool.length) logMessage += ` — ${booped.toPool.length} pion${booped.toPool.length > 1 ? 's' : ''} hors du plateau`;

  const lastMove = {
    id: `${piece.id}:${index}:${state.log.length}`,
    playerId,
    placedId: piece.id,
    placedType: pieceType,
    placedIndex: index,
    color: piece.color,
    boops: booped.boops,
    graduated: []
  };

  if (linesOfThree(board, playerId, 'cat').length) {
    return finishWin(
      { ...state, board, lastMove, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) },
      players,
      playerId,
      ' avec 3 chats alignés !'
    );
  }
  if (countOnBoard(board, playerId) >= PIECES_PER_PLAYER) {
    return finishWin(
      { ...state, board, lastMove, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) },
      players,
      playerId,
      ' : ses 8 pions sont sur le plateau !'
    );
  }

  const graduated = graduateAllPlayers(board, players);
  board = graduated.board;
  const nextPlayers = graduated.players;
  lastMove.graduated = graduated.graduated;
  if (graduated.graduated.length) {
    logMessage += ` — ${graduated.graduated.length} chaton${graduated.graduated.length > 1 ? 's' : ''} devient chat`;
  }

  return {
    ...state,
    players: nextPlayers,
    board,
    lastMove,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    log: [...state.log, { ts: Date.now(), message: `${logMessage}.` }].slice(-40)
  };
}

export function legalMoves(state, playerId) {
  if (state.status !== 'playing' || state.currentPlayerId !== playerId) return [];
  const pool = poolOf(state.players, playerId);
  const types = [];
  if (pool.some((p) => p.type === 'kitten')) types.push('kitten');
  if (pool.some((p) => p.type === 'cat')) types.push('cat');
  const moves = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (state.board[i]) continue;
    for (const type of types) moves.push({ index: i, type });
  }
  return moves;
}

export async function placeBoopPiece(room, playerId, index, pieceType) {
  return commitGameAction(room, (state) => applyPlace(state, playerId, index, pieceType));
}
