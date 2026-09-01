import { fetchRoomById } from './core.js';
import {
  applyHit,
  applyStand,
  applyDouble,
  applySplit,
  applyInsurance,
  applyConfirmBet,
  applyAddChip,
  handTotal,
  activeHand,
  canDouble,
  canSplit,
  canTakeInsurance,
  DEFAULT_BET,
  MIN_BET,
  CHIP_VALUES
} from './blackjack.js';
import { commitGameAction } from './core.js';

function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stand' };
  const h = activeHand(bot);
  if (!h) return { type: 'stand' };
  const total = handTotal(h.cards);
  const dealerUp = state.dealer?.hand?.[0];
  let dealerVal = 10;
  if (dealerUp) {
    if (dealerUp.rank === 'A') dealerVal = 11;
    else if (['J', 'Q', 'K'].includes(dealerUp.rank)) dealerVal = 10;
    else dealerVal = parseInt(dealerUp.rank, 10) || 10;
  }
  if (canSplit(bot) && h.cards[0].rank === 'A') return { type: 'split' };
  if (canSplit(bot) && h.cards[0].rank === '8') return { type: 'split' };
  if (canDouble(bot) && total >= 10 && total <= 11 && dealerVal <= 9) return { type: 'double' };
  if (total <= 11) return { type: 'hit' };
  if (total >= 17) return { type: 'stand' };
  if (total >= 13 && dealerVal <= 6) return { type: 'stand' };
  if (total === 12 && dealerVal >= 4 && dealerVal <= 6) return { type: 'stand' };
  return { type: 'hit' };
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing' && room.state.status !== 'betting') return;
  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (!fresh) return;

      if (fresh.state.status === 'betting') {
        const bot = fresh.state.players.find((p) => p.isBot && !p.betReady);
        if (!bot) return;
        const target = Math.min(bot.money, DEFAULT_BET);
        if (bot.bet < target) {
          const chip = [...CHIP_VALUES].reverse().find((v) => bot.bet + v <= target) || MIN_BET;
          await commitGameAction(fresh, (s) => applyAddChip(s, bot.id, chip));
          return;
        }
        await commitGameAction(fresh, (s) => applyConfirmBet(s, bot.id));
        return;
      }

      if (fresh.state.status !== 'playing') return;
      const currentId = fresh.state.currentPlayerId;
      const bot = fresh.state.players.find((p) => p.id === currentId && p.isBot);
      if (!bot) return;

      if (fresh.state.offerInsurance) {
        const take = canTakeInsurance(fresh.state, bot) && Math.random() < 0.15;
        await commitGameAction(fresh, (s) => applyInsurance(s, currentId, take));
        return;
      }

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'hit') await commitGameAction(fresh, (s) => applyHit(s, currentId));
      else if (move.type === 'double') await commitGameAction(fresh, (s) => applyDouble(s, currentId));
      else if (move.type === 'split') await commitGameAction(fresh, (s) => applySplit(s, currentId));
      else await commitGameAction(fresh, (s) => applyStand(s, currentId));
    } catch (err) {
      /* conflit / tour déjà joué */
    }
  }, 700 + Math.random() * 600);
}
