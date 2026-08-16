import { fetchRoomById, commitGameAction } from './core.js';
import {
  applyDrawFromStock as applyLuckyNumbersDrawStock,
  applyTakeFromDiscard as applyLuckyNumbersTakeFromDiscard,
  applyPlaceDrawn as applyLuckyNumbersPlaceDrawn,
  applyDiscardDrawn as applyLuckyNumbersDiscardDrawn
} from './luckynumbers.js';

function drawLuckyNumbersFromStock(room, playerId) {
  return commitGameAction(room, (state) => applyLuckyNumbersDrawStock(state, playerId));
}
function takeLuckyNumbersFromDiscard(room, playerId, tileId, boardIndex) {
  return commitGameAction(room, (state) => applyLuckyNumbersTakeFromDiscard(state, playerId, tileId, boardIndex));
}
function placeLuckyNumbersDrawn(room, playerId, boardIndex) {
  return commitGameAction(room, (state) => applyLuckyNumbersPlaceDrawn(state, playerId, boardIndex));
}
function discardLuckyNumbersDrawn(room, playerId) {
  return commitGameAction(room, (state) => applyLuckyNumbersDiscardDrawn(state, playerId));
}

// Politique du bot à Lucky Numbers :
// - ne place jamais une valeur qui rend des cases vides impossibles à remplir
//   (ex. un 1 en bas à droite bloque toute la rangée / colonne) ;
// - préfère la case dont la valeur « idéale » (bas-droite = grands nombres)
//   est la plus proche de la tuile ;
// - privilégie les cases vides ; n'échange que si le gain de position est net ;
// - défausse si aucun placement n'est raisonnable.
const DIM = 4;

function canPlace(board, index, value) {
  const row = Math.floor(index / DIM);
  const col = index % DIM;
  for (let c = 0; c < DIM; c++) {
    const i = row * DIM + c;
    if (i === index || !board[i]) continue;
    if (c < col && board[i].value >= value) return false;
    if (c > col && board[i].value <= value) return false;
  }
  for (let r = 0; r < DIM; r++) {
    const i = r * DIM + col;
    if (i === index || !board[i]) continue;
    if (r < row && board[i].value >= value) return false;
    if (r > row && board[i].value <= value) return false;
  }
  return true;
}

/** Intervalle [min, max] encore possible pour une case vide, vu le plateau. */
function cellBounds(board, index) {
  const row = Math.floor(index / DIM);
  const col = index % DIM;
  let min = 1;
  let max = 20;
  for (let c = 0; c < DIM; c++) {
    const i = row * DIM + c;
    if (i === index || !board[i]) continue;
    if (c < col) min = Math.max(min, board[i].value + 1);
    if (c > col) max = Math.min(max, board[i].value - 1);
  }
  for (let r = 0; r < DIM; r++) {
    const i = r * DIM + col;
    if (i === index || !board[i]) continue;
    if (r < row) min = Math.max(min, board[i].value + 1);
    if (r > row) max = Math.min(max, board[i].value - 1);
  }
  return { min, max };
}

/**
 * Après avoir posé `value` en `index`, aucune case encore vide qui était
 * jouable ne doit devenir condamnée à cause de CE coup précis. Ne compte pas
 * une case déjà condamnée AVANT ce coup (ex: deux tuiles de même valeur
 * tombées sur la diagonale au tirage initial, ce qui arrive — les couleurs
 * partagent les mêmes valeurs 1-20) : sinon le premier blocage, même hors de
 * son contrôle, interdirait éternellement toute pose au bot pour le reste de
 * la partie (il ne ferait plus jamais que piocher/défausser).
 */
function placementKeepsBoardViable(board, index, value) {
  const next = board.slice();
  next[index] = { id: 'tmp', value };
  for (let i = 0; i < 16; i++) {
    if (next[i]) continue;
    const before = cellBounds(board, i);
    if (before.min > before.max) continue; // déjà condamnée avant ce coup, pas la faute de celui-ci
    const after = cellBounds(next, i);
    if (after.min > after.max) return false;
  }
  return true;
}

/** Valeur « idéale » pour une case : petits nombres en haut-gauche, grands en bas-droite. */
function idealValue(index) {
  const row = Math.floor(index / DIM);
  const col = index % DIM;
  return 1 + Math.round(((row + col) / 6) * 19);
}

/**
 * Score d'une pose : plus c'est haut, mieux c'est.
 * −∞ si illégal ou si ça bloque des cases vides.
 */
function scorePlacement(board, index, value) {
  if (!canPlace(board, index, value)) return -Infinity;
  if (!placementKeepsBoardViable(board, index, value)) return -Infinity;

  const ideal = idealValue(index);
  const fit = -Math.abs(value - ideal); // 0 = parfait
  const emptyBonus = board[index] ? 0 : 30;
  // Échange : seulement intéressant si l'ancienne valeur collait moins bien
  let swapBonus = 0;
  if (board[index]) {
    const oldFit = -Math.abs(board[index].value - ideal);
    swapBonus = fit - oldFit;
    if (swapBonus <= 0) return -Infinity;
  }
  const row = Math.floor(index / DIM);
  const col = index % DIM;
  const progressAlign = -Math.abs(row - col) * 0.5;

  // Flexibilité : après pose, somme des largeurs d'intervalle des cases vues restantes
  const next = board.slice();
  next[index] = { id: 'tmp', value };
  let flex = 0;
  let emptyLeft = 0;
  for (let i = 0; i < 16; i++) {
    if (next[i]) continue;
    emptyLeft += 1;
    const { min, max } = cellBounds(next, i);
    flex += Math.max(0, max - min + 1);
  }
  // Bonus si on est proche de remplir (moins de cases vides)
  const completionBonus = (16 - emptyLeft) * 0.8;

  return emptyBonus + fit * 3 + swapBonus * 2 + progressAlign + flex * 0.15 + completionBonus;
}

function bestPlacement(board, value) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const score = scorePlacement(board, i, value);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Seuil : un score très bas (ex. mauvais fit sans case vide) → plutôt défausser
  if (best === null || bestScore < -25) return null;
  return best;
}

export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'discard' };

  const filled = (board) => board.filter(Boolean).length;
  const myFilled = filled(bot.board);
  const bestOppFilled = Math.max(
    0,
    ...state.players.filter((p) => p.id !== botId).map((p) => filled(p.board || []))
  );
  const racing = bestOppFilled >= myFilled && bestOppFilled >= 10;

  if (state.drawnTile) {
    const index = bestPlacement(bot.board, state.drawnTile.value);
    if (index === null) return { type: 'discard' };
    // En course, accepter un placement un peu moins bon
    const score = scorePlacement(bot.board, index, state.drawnTile.value);
    if (!racing && score < -10 && myFilled < 12) return { type: 'discard' };
    return { type: 'place', index };
  }

  let bestTake = null;
  let bestTakeScore = -Infinity;
  for (const tile of state.discard) {
    const index = bestPlacement(bot.board, tile.value);
    if (index === null) continue;
    const score = scorePlacement(bot.board, index, tile.value);
    if (score > bestTakeScore) {
      bestTakeScore = score;
      bestTake = { type: 'take', tileId: tile.id, index };
    }
  }
  const takeThreshold = racing ? -5 : 0;
  if (bestTake && bestTakeScore >= takeThreshold) return bestTake;

  if (state.stock.length > 0) return { type: 'draw' };
  if (bestTake) return bestTake;
  return { type: 'discard' };
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'draw') {
        await drawLuckyNumbersFromStock(fresh, currentId);
      } else if (move.type === 'take') {
        await takeLuckyNumbersFromDiscard(fresh, currentId, move.tileId, move.index);
      } else if (move.type === 'place') {
        await placeLuckyNumbersDrawn(fresh, currentId, move.index);
      } else if (fresh.state.drawnTile) {
        await discardLuckyNumbersDrawn(fresh, currentId);
      }
    } catch (err) {
      // Autre appareil a probablement déjà joué.
    }
  }, 900 + Math.random() * 700);
}
