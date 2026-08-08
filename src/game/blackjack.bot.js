import { fetchRoomById, updateRoomState } from './core.js';
import { applyHit as applyBlackjackHit, applyStand as applyBlackjackStand, handTotal as blackjackHandTotal } from './blackjack.js';

function hitBlackjack(room, playerId) {
  const newState = applyBlackjackHit(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

function standBlackjack(room, playerId) {
  const newState = applyBlackjackStand(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

// Politique du bot au Blackjack (passe 2) — stratégie de base plus fine :
// distingue mains dures / soft (As compté 11), et affine les seuils selon la banque.
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stand' };
  const hand = bot.hand;
  const total = blackjackHandTotal(hand);
  if (total >= 21) return { type: 'stand' };

  // Soft = au moins un As encore compté pour 11
  let raw = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces += 1; raw += 11; }
    else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') raw += 10;
    else raw += parseInt(c.rank, 10) || 0;
  }
  let softAces = aces;
  let softTotal = raw;
  while (softTotal > 21 && softAces > 0) { softTotal -= 10; softAces -= 1; }
  const isSoft = softAces > 0 && total <= 21;

  const dealerUp = state.dealer?.hand?.[0];
  let dealerVal = 10;
  if (dealerUp) {
    if (dealerUp.rank === 'A') dealerVal = 11;
    else if (dealerUp.rank === 'J' || dealerUp.rank === 'Q' || dealerUp.rank === 'K') dealerVal = 10;
    else dealerVal = parseInt(dealerUp.rank, 10) || 10;
  }

  if (isSoft) {
    // Soft 18 : reste vs 2-8, tire vs 9-A ; soft ≤17 : tire toujours
    if (total <= 17) return { type: 'hit' };
    if (total === 18) return dealerVal >= 9 ? { type: 'hit' } : { type: 'stand' };
    return { type: 'stand' };
  }

  // Main dure
  if (total <= 11) return { type: 'hit' };
  if (total === 12) return dealerVal >= 4 && dealerVal <= 6 ? { type: 'stand' } : { type: 'hit' };
  if (total >= 13 && total <= 16) return dealerVal >= 2 && dealerVal <= 6 ? { type: 'stand' } : { type: 'hit' };
  return { type: 'stand' }; // 17+
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
        await hitBlackjack(fresh, currentId);
      } else {
        await standBlackjack(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
