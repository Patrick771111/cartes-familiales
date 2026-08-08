import { fetchRoomById, commitGameAction } from './core.js';
import {
  applyDrawFromStock as applyCinqRoisDrawStock,
  applyDrawFromDiscard as applyCinqRoisDrawDiscard,
  applyDiscard as applyCinqRoisDiscard,
  canGoOut as cinqRoisCanGoOut,
  cardPenalty as cinqRoisCardPenalty
} from './cinqrois.js';

function drawCinqRoisFromStock(room, playerId) {
  return commitGameAction(room, (state) => applyCinqRoisDrawStock(state, playerId));
}
function drawCinqRoisFromDiscard(room, playerId) {
  return commitGameAction(room, (state) => applyCinqRoisDrawDiscard(state, playerId));
}
function discardCinqRois(room, playerId, cardId, goOut = false) {
  return commitGameAction(room, (state) => applyCinqRoisDiscard(state, playerId, cardId, goOut));
}

// Politique du bot aux Cinq Rois (passe 3) :
// - pioche la défausse seulement si elle renforce vraiment la main
//   (famille, suite, wild utile), pas juste parce qu'elle est « petite » ;
// - à la défausse, cherche d'abord une carte dont le reste de la main est
//   posable (go-out), en se débarrassant de la plus chère possible ;
// - sinon défausse la carte la moins utile aux combinaisons, en préservant
//   paires, suites et wilds ; plus agressif en last_turns.
function isWild(card, trumpRank) {
  return card.isJoker || card.rank === trumpRank;
}

/** Combien de naturelles du même rang (hors wilds) dans la main. */
function rankCount(hand, rank, trumpRank) {
  return hand.filter((c) => !isWild(c, trumpRank) && c.rank === rank).length;
}

/** Rangs naturels d'une couleur, triés. */
function suitRanks(hand, suit, trumpRank) {
  return hand
    .filter((c) => !isWild(c, trumpRank) && c.suit === suit)
    .map((c) => c.rank)
    .sort((a, b) => a - b);
}

/**
 * Score d'intérêt d'ajouter `card` à `hand` (sans l'y mettre).
 * Plus c'est haut, plus la défausse vaut le coup d'être prise.
 */
function drawInterest(hand, card, trumpRank) {
  if (!card) return -1;
  // Joker visible : excellent (wild universel), sauf si on en a déjà trop
  // par rapport à la taille de main (éviter 50 pts collés pour rien).
  if (card.isJoker) {
    const wilds = hand.filter((c) => isWild(c, trumpRank)).length;
    return wilds >= Math.max(2, Math.floor(hand.length / 3)) ? 4 : 18;
  }
  if (card.rank === trumpRank) {
    const wilds = hand.filter((c) => isWild(c, trumpRank)).length;
    return wilds >= Math.max(2, Math.floor(hand.length / 3)) ? 3 : 14;
  }

  const sameRank = rankCount(hand, card.rank, trumpRank);
  // Famille en construction
  let score = 0;
  if (sameRank >= 2) score += 20; // 3e+ carte de famille
  else if (sameRank === 1) score += 10; // paire → potentiel famille

  // Suite : proximité avec d'autres rangs de la même couleur
  const ranks = suitRanks(hand, card.suit, trumpRank);
  if (ranks.length) {
    let bestGap = 99;
    for (const r of ranks) {
      const gap = Math.abs(r - card.rank);
      if (gap === 0) continue; // doublon de rang dans la couleur : peu utile en suite
      if (gap < bestGap) bestGap = gap;
    }
    if (bestGap === 1) score += 16; // adjacent → suite directe
    else if (bestGap === 2) score += 8; // un trou comblable par un wild
    else if (bestGap <= 3) score += 3;
  }

  // Carte isolée à faible pénalité : léger intérêt seulement
  if (score === 0) {
    const pen = cinqRoisCardPenalty(card, trumpRank);
    if (pen <= 4) score = 2;
    else if (pen <= 6) score = 1;
  }
  return score;
}

/**
 * Utilité d'une carte DANS la main : plus c'est haut, plus on veut la garder.
 * On défausse en priorité les cartes à faible utilité (et forte pénalité).
 */
function keepValue(hand, card, trumpRank) {
  if (isWild(card, trumpRank)) {
    // Garder les wilds sauf s'il y en a beaucoup
    const wilds = hand.filter((c) => isWild(c, trumpRank)).length;
    return card.isJoker ? 40 - wilds * 3 : 28 - wilds * 2;
  }
  let value = 0;
  const sameRank = rankCount(hand, card.rank, trumpRank);
  if (sameRank >= 3) value += 28;
  else if (sameRank === 2) value += 20; // quasi-famille : très précieux
  else if (sameRank === 1) value += 5;

  const ranks = suitRanks(hand, card.suit, trumpRank);
  // Densité de voisins dans la couleur
  let neighbors = 0;
  for (const r of ranks) {
    if (r === card.rank) continue;
    const gap = Math.abs(r - card.rank);
    if (gap === 1) neighbors += 2;
    else if (gap === 2) neighbors += 1;
  }
  value += neighbors * 5;

  // Pénalité : une carte chère isolée se défausse plus volontiers
  const pen = cinqRoisCardPenalty(card, trumpRank);
  value -= pen * 0.35;
  return value;
}

export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return null;
  const trump = state.trumpRank;
  const inLastTurns = state.status === 'last_turns';

  if (state.phase === 'draw') {
    const top = state.discard[state.discard.length - 1];
    const interest = drawInterest(bot.hand, top, trump);
    // Proche d'une pose possible → plus gourmand sur la défausse
    let nearGoOut = false;
    if (bot.hand.length >= 3) {
      for (const c of bot.hand) {
        const rem = bot.hand.filter((x) => x.id !== c.id);
        // Si en ajoutant top on pourrait être encore plus proche — heuristique simple
        if (rem.length >= 3 && cinqRoisCanGoOut(rem, trump)) { nearGoOut = true; break; }
      }
    }
    let threshold = inLastTurns ? 5 : 9;
    if (nearGoOut) threshold = Math.min(threshold, 4);
    if (top && interest >= threshold) return { type: 'draw_discard' };
    if (top && (top.isJoker || top.rank === trump) && interest >= 8) return { type: 'draw_discard' };
    return { type: 'draw_stock' };
  }

  // Phase défausse — d'abord chercher un go-out
  const hand = bot.hand.slice();
  let bestGoOut = null;
  let bestGoOutPenalty = -1;
  for (const card of hand) {
    const remaining = hand.filter((c) => c.id !== card.id);
    if (remaining.length >= 3 && cinqRoisCanGoOut(remaining, trump)) {
      const pen = cinqRoisCardPenalty(card, trump);
      // En go-out on se débarrasse de la carte la plus chère possible
      if (pen > bestGoOutPenalty) {
        bestGoOutPenalty = pen;
        bestGoOut = card;
      }
    }
  }
  if (bestGoOut) return { type: 'discard', cardId: bestGoOut.id, goOut: true };

  // Pas de pose : défausser la carte la moins utile
  // Score = keepValue ; on jette le minimum. En last_turns, pondérer plus la pénalité.
  let bestDiscard = hand[0];
  let bestScore = Infinity;
  for (const card of hand) {
    const keep = keepValue(hand, card, trump);
    const pen = cinqRoisCardPenalty(card, trump);
    // Moins on veut garder + plus c'est cher → meilleur candidat à jeter
    const score = inLastTurns ? keep - pen * 1.2 : keep - pen * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestDiscard = card;
    }
  }
  return { type: 'discard', cardId: bestDiscard.id, goOut: false };
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing' && room.state.status !== 'last_turns') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.currentPlayerId !== currentId) return;
      if (fresh.state.status !== 'playing' && fresh.state.status !== 'last_turns') return;

      const move = chooseMove(fresh.state, currentId);
      if (!move) return;
      if (move.type === 'draw_stock') await drawCinqRoisFromStock(fresh, currentId);
      else if (move.type === 'draw_discard') await drawCinqRoisFromDiscard(fresh, currentId);
      else if (move.type === 'discard') await discardCinqRois(fresh, currentId, move.cardId, move.goOut);
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
