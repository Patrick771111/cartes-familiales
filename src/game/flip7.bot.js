import { fetchRoomById, commitGameAction } from './core.js';
import { applyHit as applyFlip7Hit, applyStay as applyFlip7Stay } from './flip7.js';

function hitFlip7(room, playerId) {
  return commitGameAction(room, (state) => applyFlip7Hit(state, playerId));
}

function stayFlip7(room, playerId) {
  return commitGameAction(room, (state) => applyFlip7Stay(state, playerId));
}

// Politique du bot à Flip 7 (passe 3) :
// - estime P(doublon) grossièrement (cartes 0–12, N apparaît N fois)
// - reste si l'espérance devient mauvaise, ou si on bat déjà les stay adverses
// - plus agressif en retard au score cumulé
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stay' };
  // Flip 7 utilise status 'active' (pas 'playing') tant que le joueur peut flipper.
  if (bot.status && bot.status !== 'active') return { type: 'stay' };

  const numbers = bot.display.filter((c) => c.kind === 'number');
  const uniqueCount = numbers.length;
  if (uniqueCount >= 7) return { type: 'stay' };

  const have = new Set(numbers.map((c) => c.value));
  const roundSum = numbers.reduce((s, c) => s + (c.value || 0), 0);
  const hasX2 = bot.display.some((c) => c.kind === 'modifier' && c.modType === 'x2');
  const flatBonus = bot.display
    .filter((c) => c.kind === 'modifier' && c.modType === 'flat')
    .reduce((s, c) => s + (c.amount || 0), 0);
  const currentRound = roundSum * (hasX2 ? 2 : 1) + flatBonus;

  // Masse approximative du paquet restant (sans retirer précisément les cartes vues adverses)
  // N apparaît N fois (0 une fois) → total numéros = 1+sum(1..12)=79
  let danger = 0; // copies qui feraient bust
  let safe = 0;
  for (let v = 0; v <= 12; v++) {
    const copies = v === 0 ? 1 : v;
    if (have.has(v)) danger += copies;
    else safe += copies;
  }
  // Réduire un peu pour les cartes déjà sorties (heuristique)
  const seenFactor = Math.max(0.4, 1 - uniqueCount * 0.06);
  const pBust = (danger * seenFactor) / Math.max(1, (danger + safe) * seenFactor);
  const pSafe = 1 - pBust;

  const others = state.players.filter((p) => p.id !== botId);
  const bestOther = Math.max(0, ...others.map((p) => p.score ?? 0));
  const behind = bestOther - (bot.score ?? 0);
  const stayedRounds = others
    .filter((p) => p.status === 'stayed' || p.status === 'done' || p.flip7)
    .map((p) => {
      const nums = (p.display || []).filter((c) => c.kind === 'number');
      const sum = nums.reduce((s, c) => s + (c.value || 0), 0);
      const x2 = (p.display || []).some((c) => c.kind === 'modifier' && c.modType === 'x2');
      const flat = (p.display || [])
        .filter((c) => c.kind === 'modifier' && c.modType === 'flat')
        .reduce((s, c) => s + (c.amount || 0), 0);
      return sum * (x2 ? 2 : 1) + flat + (p.flip7 ? 15 : 0);
    });
  const bestStayed = stayedRounds.length ? Math.max(...stayedRounds) : 0;

  // Espérance grossière : stay = currentRound ; hit ≈ pSafe * (currentRound+5) + pBust * 0
  const expectedHit = pSafe * (currentRound + 5);
  const stayValue = currentRound;

  // Ajustements situationnels
  if (uniqueCount >= 6) return { type: 'stay' };
  if (behind < -30 && uniqueCount >= 3) return { type: 'stay' };
  if (currentRound >= bestStayed + 8 && uniqueCount >= 4 && behind <= 15) return { type: 'stay' };
  if (bot.hasSecondChance && uniqueCount < 6) return { type: 'hit' }; // filet de sécurité
  if (behind > 25 && uniqueCount < 6) return { type: 'hit' };
  if (expectedHit < stayValue * 0.85 && uniqueCount >= 4) return { type: 'stay' };
  if (uniqueCount >= 5 && pBust > 0.35) return { type: 'stay' };
  return uniqueCount < 4 ? { type: 'hit' } : expectedHit >= stayValue ? { type: 'hit' } : { type: 'stay' };
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
      if (move.type === 'hit') {
        await hitFlip7(fresh, currentId);
      } else {
        await stayFlip7(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
