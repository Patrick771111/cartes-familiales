import { fetchRoomById, commitGameAction } from './core.js';
import { applyDraw, applyFormAdjacentPairs, playerToDrawFrom, hasPair, idsGroupedByRank } from './pouilleux.js';

function drawForCurrentPlayer(room, playerId, cardIndex) {
  return commitGameAction(room, (state) => applyDraw(state, playerId, cardIndex));
}

function formPairs(room, playerId, orderedIds) {
  return commitGameAction(room, (state) => applyFormAdjacentPairs(state, playerId, orderedIds));
}

// Évite que ce même appareil ne programme deux fois le coup d'un bot pour le
// même état de partie (plusieurs appareils peuvent chacun tenter le coup ;
// le verrou optimiste de Supabase ne laisse passer que le premier).
let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing') return;

      const botWithPairs = fresh.state.players.find((p) => p.isBot && hasPair(p.hand));
      if (botWithPairs) {
        await formPairs(fresh, botWithPairs.id, idsGroupedByRank(botWithPairs.hand));
        return;
      }

      const currentId = fresh.state.currentPlayerId;
      const bot = fresh.state.players.find((p) => p.id === currentId && p.isBot);
      if (!bot) return;

      const targetId = playerToDrawFrom(fresh.state);
      const target = fresh.state.players.find((p) => p.id === targetId);
      if (!target || target.hand.length === 0) return;

      const cardIndex = Math.floor(Math.random() * target.hand.length);
      await drawForCurrentPlayer(fresh, currentId, cardIndex);
    } catch (err) {
      // Un autre appareil a probablement déjà joué le coup, ou la partie a changé
      // entre temps — la resynchro realtime prendra le relais normalement.
    }
  }, 1000 + Math.random() * 700);
}
