import { fetchRoomById, updateRoomState } from './core.js';
import { applyPlay as applyTrouducPlay, applyPass as applyTrouducPass, applyExchangeChoice, rankValue as trouducRankValue } from './trouduc.js';

function playCards(room, playerId, cardIds) {
  const newState = applyTrouducPlay(room.state, playerId, cardIds);
  return updateRoomState(room.id, room.version, newState);
}

function passTurn(room, playerId) {
  const newState = applyTrouducPass(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

function submitExchangeGift(room, playerId, cardIds) {
  const newState = applyExchangeChoice(room.state, playerId, cardIds);
  return updateRoomState(room.id, room.version, newState);
}

// Politique du bot au Trou du Cul (passe 3) :
// - finit dès que possible
// - pli libre : préfère un rang dont on a beaucoup de cartes (vider la main)
// - brûle (8/2) pour récupérer la main si on a peu de cartes restantes après
// - égalise pour verrouiller si d'autres ont encore beaucoup de cartes
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'pass' };
  const groups = new Map();
  for (const card of bot.hand) {
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push(card);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => trouducRankValue(a[0]) - trouducRankValue(b[0]));
  const handSize = bot.hand.length;
  const othersMaxHand = Math.max(
    0,
    ...state.players.filter((p) => p.id !== botId && !p.finished).map((p) => p.hand.length)
  );

  if (state.pileCount === 0) {
    // Finir en un coup
    for (const [, cards] of sortedGroups) {
      if (cards.length === handSize) return { type: 'play', cardIds: cards.map((c) => c.id) };
    }
    // Préférer le rang le plus faible avec le plus de cartes (se délester)
    let best = sortedGroups[0];
    let bestScore = -Infinity;
    for (const entry of sortedGroups) {
      const [rank, cards] = entry;
      const isBurn = rank === '8' || rank === '2';
      let s = cards.length * 3 - trouducRankValue(rank);
      // Brûler seulement si après on a ≤3 cartes (on rejoue aussitôt)
      if (isBurn) s += handSize - cards.length <= 3 ? 8 : -6;
      if (s > bestScore) {
        bestScore = s;
        best = entry;
      }
    }
    return { type: 'play', cardIds: best[1].map((c) => c.id) };
  }

  const pileRankValue = trouducRankValue(state.pileRank);
  const need = state.pileCount;

  // Finir la main d'un coup si possible
  if (handSize === need) {
    for (const [rank, cards] of sortedGroups) {
      if (cards.length < need) continue;
      const rv = trouducRankValue(rank);
      const legal = state.rankLocked ? rv === pileRankValue : rv >= pileRankValue;
      if (legal) return { type: 'play', cardIds: cards.slice(0, need).map((c) => c.id) };
    }
  }

  let best = null;
  let bestScore = Infinity;
  for (const [rank, cards] of sortedGroups) {
    if (cards.length < need) continue;
    const rv = trouducRankValue(rank);
    const legal = state.rankLocked ? rv === pileRankValue : rv >= pileRankValue;
    if (!legal) continue;
    const isBurn = rank === '8' || rank === '2';
    const equals = rv === pileRankValue;
    let score = (rv - pileRankValue) + (equals ? 0 : 10);
    if (equals && othersMaxHand >= 5) score -= 4; // verrouiller face à une grosse main
    if (isBurn) score += handSize <= need + 3 ? -6 : 4;
    if (handSize === need) score -= 50;
    if (score < bestScore) {
      bestScore = score;
      best = cards.slice(0, need).map((c) => c.id);
    }
  }
  return best ? { type: 'play', cardIds: best } : { type: 'pass' };
}

let scheduledMove = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledMove === signature) return;
  scheduledMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'play') {
        await playCards(fresh, currentId, move.cardIds);
      } else {
        await passTurn(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

let scheduledExchange = null;

/** Pendant la phase d'échange, un bot Président/Vice-Président rend toujours ses cartes les plus faibles. */
export function scheduleExchange(room) {
  if (room.state.status !== 'exchange') return;

  const ex = room.state.exchange;
  const pendingGivers = [];
  if (!ex.presidentGiven) pendingGivers.push({ id: ex.presidentId, count: ex.presidentGiftCount });
  if (!ex.vicePresidentGiven) pendingGivers.push({ id: ex.vicePresidentId, count: ex.vicePresidentGiftCount });

  const botsPending = pendingGivers.filter(({ id }) => room.state.players.find((p) => p.id === id)?.isBot);
  if (!botsPending.length) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledExchange === signature) return;
  scheduledExchange = signature;

  botsPending.forEach(({ id, count }) => {
    window.setTimeout(async () => {
      try {
        const fresh = await fetchRoomById(room.id);
        if (fresh.state.status !== 'exchange') return;
        const freshEx = fresh.state.exchange;
        const alreadyGiven = id === freshEx.presidentId ? freshEx.presidentGiven : freshEx.vicePresidentGiven;
        if (alreadyGiven) return;

        const bot = fresh.state.players.find((p) => p.id === id);
        if (!bot) return;
        const worstCardIds = bot.hand
          .slice()
          .sort((a, b) => trouducRankValue(a.rank) - trouducRankValue(b.rank))
          .slice(0, count)
          .map((c) => c.id);

        await submitExchangeGift(fresh, id, worstCardIds);
      } catch (err) {
        // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
      }
    }, 900 + Math.random() * 700);
  });
}
