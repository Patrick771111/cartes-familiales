import { fetchRoomById, commitGameAction } from './core.js';
import { applyPlace, legalMoves, cellRow, cellCol } from './boop.js';

function centerScore(index) {
  const r = cellRow(index);
  const c = cellCol(index);
  const dr = Math.abs(r - 2.5);
  const dc = Math.abs(c - 2.5);
  return 4 - (dr + dc);
}

export function chooseMove(state, botId) {
  const moves = legalMoves(state, botId);
  if (!moves.length) return null;

  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    let score = centerScore(move.index);
    if (move.type === 'cat') score += 0.4;
    try {
      const next = applyPlace(state, botId, move.index, move.type);
      if (next.status === 'finished' && next.winnerId === botId) score += 10000;
      else {
        const log = next.log[next.log.length - 1]?.message || '';
        if (log.includes('devient chat')) score += 120;
        if (log.includes('hors du plateau')) score += 18;
      }
    } catch {
      score -= 50;
    }
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;
  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}:${currentId}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;
      const move = chooseMove(fresh.state, currentId);
      if (!move) return;
      await commitGameAction(fresh, (state) => applyPlace(state, currentId, move.index, move.type));
    } catch {
      scheduled = null;
    }
  }, 2200 + Math.random() * 600);
}
