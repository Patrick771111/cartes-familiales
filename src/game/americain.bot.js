import { fetchRoomById, updateRoomState } from './core.js';
import { applyPlay as applyAmericainPlay, applyDraw as applyAmericainDraw, isLegalCard as americainIsLegalCard } from './americain.js';

function playAmericainCard(room, playerId, cardId, chosenSuit) {
  const newState = applyAmericainPlay(room.state, playerId, cardId, chosenSuit);
  return updateRoomState(room.id, room.version, newState);
}

function drawAmericainCard(room, playerId) {
  const newState = applyAmericainDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

// Politique du bot au 8 américain (passe 3) :
// - finir dès que possible ; garder les 8
// - 2 / As / Valet : joués de façon tactique (pénaliser le leader, etc.)
// - dump des hautes cartes et couleurs isolées
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'draw' };

  const rankWeight = (r) => {
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    if (r === '8') return -8;
    if (r === '2') return 9;
    return parseInt(r, 10) || 0;
  };

  const legalCards = bot.hand.filter((c) => americainIsLegalCard(state, c));
  if (!legalCards.length) return { type: 'draw' };

  if (bot.hand.length === 1) {
    const card = legalCards[0];
    if (card.rank === '8') return { type: 'play', cardId: card.id, chosenSuit: card.suit || 'S' };
    return { type: 'play', cardId: card.id };
  }

  // Joueur suivant dans le sens actuel (cible du 2 / As)
  const order = state.turnOrder || state.players.map((p) => p.id);
  const dir = state.direction || 1;
  const myIdx = order.indexOf(botId);
  const nextId = order[(myIdx + dir + order.length * 10) % order.length];
  const nextPlayer = state.players.find((p) => p.id === nextId);
  const nextHandSize = nextPlayer?.hand?.length ?? 7;
  const leader = state.players
    .filter((p) => p.id !== botId && !p.finished)
    .sort((a, b) => (a.hand?.length ?? 99) - (b.hand?.length ?? 99))[0];
  const leaderIsNext = leader && leader.id === nextId;

  const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
  bot.hand.forEach((c) => { if (c.suit) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1; });

  const nonEights = legalCards.filter((c) => c.rank !== '8');
  const pool = nonEights.length ? nonEights.slice() : legalCards.slice();

  pool.sort((a, b) => {
    const score = (c) => {
      let s = rankWeight(c.rank) + (suitCounts[c.suit] <= 1 ? 4 : 0);
      // 2 : fort si le suivant a peu de cartes (le ralentir)
      if (c.rank === '2') s += nextHandSize <= 3 ? 12 : nextHandSize <= 5 ? 4 : -2;
      // As : voler au leader s'il est le suivant
      if (c.rank === 'A') s += leaderIsNext ? 10 : 2;
      // Valet : utile surtout à 3+ joueurs pour changer le sens
      if (c.rank === 'J') s += (state.players?.length || 0) >= 3 ? 3 : 0;
      // Fin proche : privilégier n'importe quelle carte jouable non-8
      if (bot.hand.length <= 2) s += 5;
      return s;
    };
    return score(b) - score(a);
  });
  const card = pool[0];

  if (card.rank !== '8') return { type: 'play', cardId: card.id };

  const remaining = bot.hand.filter((c) => c.id !== card.id);
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  remaining.forEach((c) => { if (c.suit) counts[c.suit] = (counts[c.suit] || 0) + 1; });
  const bestSuit = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return { type: 'play', cardId: card.id, chosenSuit: bestSuit };
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
      if (move.type === 'play') {
        await playAmericainCard(fresh, currentId, move.cardId, move.chosenSuit);
      } else {
        await drawAmericainCard(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
