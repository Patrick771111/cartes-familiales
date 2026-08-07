import { shuffle } from './deck.js';

/**
 * Les Cinq Rois — adaptation familiale multi-joueurs.
 *
 * Source : https://nfc.accessijeux.com/regles-du-jeu-les-cinq-rois/
 *
 * - 2 jeux × 5 couleurs (♥ ♦ ♣ ♠ ★) × rangs 3→Roi + 6 jokers = 116 cartes
 * - Manches de 3 à 13 cartes ; l'atout = le rang égal au nombre de cartes
 * - Tour : piocher (pioche ou défausse) → défausser 1 carte → éventuellement
 *   poser toute sa main (suites ≥3 même couleur et/ou familles ≥3 même rang)
 * - Jokers et atouts sont jokers (wilds) dans les combinaisons
 * - Quand quelqu'un pose, les autres jouent encore 1 tour, puis pénalités
 * - Moins de points cumulés à la fin (manche 13) = gagnant
 */

export const SUITS = [
  { key: 'H', symbol: '♥', color: 'red' },
  { key: 'D', symbol: '♦', color: 'red' },
  { key: 'C', symbol: '♣', color: 'dark' },
  { key: 'S', symbol: '♠', color: 'dark' },
  { key: 'T', symbol: '★', color: 'gold' } // étoile
];

export const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // 11=V, 12=D, 13=R

export function rankLabel(rank) {
  if (rank === 11) return 'V';
  if (rank === 12) return 'D';
  if (rank === 13) return 'R';
  return String(rank);
}

export function suitInfo(key) {
  return SUITS.find((s) => s.key === key);
}

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 2 jeux complets + 6 jokers. */
export function buildCinqRoisDeck() {
  const cards = [];
  for (let set = 0; set < 2; set++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${rank}${suit.key}-${set}`,
          rank,
          suit: suit.key,
          isJoker: false
        });
      }
    }
  }
  for (let j = 0; j < 6; j++) {
    cards.push({ id: `JOKER-${j}`, rank: null, suit: null, isJoker: true });
  }
  return cards;
}

/** Points de pénalité d'une carte non posée. */
export function cardPenalty(card, trumpRank) {
  if (card.isJoker) return 50;
  if (card.rank === trumpRank) return 20;
  return card.rank; // 3–13
}

export function handPenalty(hand, trumpRank) {
  return hand.reduce((s, c) => s + cardPenalty(c, trumpRank), 0);
}

function isWild(card, trumpRank) {
  return card.isJoker || card.rank === trumpRank;
}

/**
 * Vérifie si un ensemble de cartes forme UNE famille (même rang, ≥3)
 * ou UNE suite (même couleur, rangs consécutifs, ≥3), en utilisant les wilds.
 */
function isValidMeld(cards, trumpRank) {
  if (cards.length < 3) return false;
  const naturals = cards.filter((c) => !isWild(c, trumpRank));
  const wildCount = cards.length - naturals.length;

  // Famille : tous les naturels ont le même rang
  if (naturals.length === 0) {
    // Que des wilds : OK comme famille (ou suite) de taille ≥ 3
    return true;
  }
  const sameRank = naturals.every((c) => c.rank === naturals[0].rank);
  if (sameRank) return true;

  // Suite : même couleur, rangs distincts, formant une fenêtre continue avec wilds
  const sameSuit = naturals.every((c) => c.suit === naturals[0].suit);
  if (!sameSuit) return false;
  const ranks = naturals.map((c) => c.rank).sort((a, b) => a - b);
  // Pas de doublon de rang naturel dans une suite
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] === ranks[i - 1]) return false;
  }
  const min = ranks[0];
  const max = ranks[ranks.length - 1];
  const span = max - min + 1;
  // Il faut span positions, on a ranks.length naturelles → besoin de span - naturals wilds
  // et la taille totale de la meld doit être ≥ span (on ne peut pas avoir de trous hors wilds)
  if (cards.length < span) return false;
  const wildsNeeded = span - ranks.length;
  if (wildsNeeded > wildCount) return false;
  // Wilds en trop : on peut les coller aux extrémités tant que ça reste dans 3–13
  const extraWilds = wildCount - wildsNeeded;
  const roomLow = min - 3;
  const roomHigh = 13 - max;
  return extraWilds <= roomLow + roomHigh;
}

/**
 * Peut-on partitionner toute la main en melds valides ?
 * Backtracking borné (main ≤ 13 cartes), mémoïsé par sous-ensemble de cartes
 * restantes (identifié par les ids, triés pour une clé stable) — sans ça, une
 * main riche en jokers/atouts (beaucoup de wilds interchangeables) peut faire
 * réexplorer le même sous-ensemble des dizaines de fois via des chemins
 * différents et dépasser la seconde sur un clic (mesuré ~1s sur 6 jokers +
 * 7 cartes disparates), perceptible comme un blocage vu que `canGoOut` tourne
 * de façon synchrone à chaque sélection de carte côté UI.
 */
export function canGoOut(hand, trumpRank) {
  if (hand.length < 3) return false;
  return canPartition(hand.slice(), trumpRank, new Map());
}

function canPartition(cards, trumpRank, memo) {
  if (cards.length === 0) return true;
  if (cards.length < 3) return false;

  const key = cards.map((c) => c.id).sort().join(',');
  if (memo.has(key)) return memo.get(key);

  // Essayer toutes les sous-ensembles de taille 3..n comme premier meld
  const n = cards.length;
  // Ordre : d'abord les plus grands melds pour élaguer plus vite
  let found = false;
  for (let size = Math.min(n, 8); size >= 3 && !found; size--) {
    const indices = chooseIndices(n, size);
    for (const idxs of indices) {
      const meld = idxs.map((i) => cards[i]);
      if (!isValidMeld(meld, trumpRank)) continue;
      const rest = cards.filter((_, i) => !idxs.includes(i));
      if (canPartition(rest, trumpRank, memo)) {
        found = true;
        break;
      }
    }
  }
  memo.set(key, found);
  return found;
}

/** Génère les combinaisons d'indices (taille k parmi n), limité pour perf. */
function chooseIndices(n, k) {
  const result = [];
  const comb = [];
  function rec(start) {
    if (comb.length === k) {
      result.push(comb.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      comb.push(i);
      rec(i + 1);
      comb.pop();
      // Cap de sécurité : trop de combos sur 13 cartes
      if (result.length > 2000) return;
    }
  }
  rec(0);
  return result;
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function reshuffleIfNeeded(stock, discard) {
  if (stock.length > 0) return { stock, discard };
  if (discard.length <= 1) return { stock, discard };
  const top = discard[discard.length - 1];
  return { stock: shuffle(discard.slice(0, -1)), discard: [top] };
}

/**
 * @param {Array} players - {id, name, isBot}
 * @param {object|null} previousScores - map id → score cumulé, ou null pour repartir de 0
 * @param {number} handSize - 3..13 (défaut 3 pour une nouvelle partie)
 */
export function initGame(players, previousScores = null, handSize = 3) {
  if (players.length < 2 || players.length > 7) {
    throw new Error('Les Cinq Rois se jouent de 2 à 7 joueurs.');
  }
  const size = Math.max(3, Math.min(13, handSize || 3));
  const trumpRank = size; // manche à N cartes → atout = N (13 = Roi)

  const deck = shuffle(buildCinqRoisDeck());
  let cursor = 0;
  const gamePlayers = players.map((p) => {
    const hand = deck.slice(cursor, cursor + size);
    cursor += size;
    return {
      id: p.id,
      name: p.name,
      isBot: p.isBot || false,
      hand,
      score: previousScores ? previousScores[p.id] || 0 : 0,
      laidDown: false,
      laidCards: []
    };
  });

  const stock = deck.slice(cursor + 1);
  const discard = [deck[cursor]];

  return {
    status: 'playing', // playing | last_turns | finished
    phase: 'draw', // draw | discard
    handSize: size,
    trumpRank,
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: players[0].id,
    stock,
    discard,
    drawnCard: null, // carte venant d'être piochée (phase discard)
    firstToLayId: null,
    lastTurnQueue: [], // ids restant à jouer après un pose
    roundScores: null,
    gameWinnerId: null,
    lastMove: null,
    log: [
      {
        ts: Date.now(),
        message: `Manche à ${size} cartes — atout : ${rankLabel(trumpRank)}${size === 13 ? ' (Rois)' : ''}.`
      }
    ]
  };
}

/** Pioche depuis le stock. */
export function applyDrawFromStock(state, playerId) {
  if (state.status !== 'playing' && state.status !== 'last_turns') {
    throw new Error('La manche est terminée.');
  }
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.phase !== 'draw') throw new Error('Tu as déjà pioché — défausse une carte.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  if (current.laidDown) throw new Error('Tu as déjà posé ta main.');

  let { stock, discard } = reshuffleIfNeeded(state.stock.slice(), state.discard.slice());
  if (stock.length === 0) throw new Error('Plus de cartes à piocher.');

  const card = stock.shift();
  current.hand.push(card);

  return {
    ...state,
    players,
    stock,
    discard,
    phase: 'discard',
    drawnCard: card,
    lastMove: { id: uniqueId(), by: playerId, type: 'draw_stock', card },
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche dans le talon.` }].slice(-40)
  };
}

/** Pioche la carte du dessus de la défausse. */
export function applyDrawFromDiscard(state, playerId) {
  if (state.status !== 'playing' && state.status !== 'last_turns') {
    throw new Error('La manche est terminée.');
  }
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.phase !== 'draw') throw new Error('Tu as déjà pioché — défausse une carte.');
  if (!state.discard.length) throw new Error('La défausse est vide.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  if (current.laidDown) throw new Error('Tu as déjà posé ta main.');

  const discard = state.discard.slice();
  const card = discard.pop();
  current.hand.push(card);

  return {
    ...state,
    players,
    discard,
    phase: 'discard',
    drawnCard: card,
    lastMove: { id: uniqueId(), by: playerId, type: 'draw_discard', card },
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message: `${current.name} prend ${card.isJoker ? 'un Joker' : rankLabel(card.rank) + (suitInfo(card.suit)?.symbol || '')} sur la défausse.`
      }
    ].slice(-40)
  };
}

/**
 * Défausse une carte. Après défausse :
 * - si goOut=true et main restante posable → pose
 * - sinon passe au joueur suivant (ou termine les last_turns)
 */
export function applyDiscard(state, playerId, cardId, goOut = false) {
  if (state.status !== 'playing' && state.status !== 'last_turns') {
    throw new Error('La manche est terminée.');
  }
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.phase !== 'discard') throw new Error("Pioche d'abord une carte.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const cardIndex = current.hand.findIndex((c) => c.id === cardId);
  if (cardIndex < 0) throw new Error("Cette carte n'est pas dans ta main.");

  const [card] = current.hand.splice(cardIndex, 1);
  const discard = [...state.discard, card];

  let logMessage = `${current.name} défausse ${
    card.isJoker ? 'un Joker' : rankLabel(card.rank) + (suitInfo(card.suit)?.symbol || '')
  }.`;

  let nextState = {
    ...state,
    players,
    discard,
    phase: 'draw',
    drawnCard: null,
    lastMove: { id: uniqueId(), by: playerId, type: 'discard', card, goOut: false }
  };

  // Tentative de pose (main entière) — possible aussi pendant les derniers
  // tours (`last_turns`) : chacun garde une chance d'éviter les pénalités en
  // posant à son tour, pas seulement le tout premier à avoir posé.
  const canAttemptGoOut = state.status === 'playing' || state.status === 'last_turns';
  if (goOut && canAttemptGoOut && canGoOut(current.hand, state.trumpRank)) {
    current.laidDown = true;
    // Conserve les cartes posées pour que les autres joueurs puissent les voir.
    current.laidCards = current.hand.slice();
    current.hand = [];
    logMessage += ` ${current.name} pose sa main !`;
    nextState.lastMove.goOut = true;
    nextState.log = [...state.log, { ts: Date.now(), message: logMessage }].slice(-40);

    if (state.status === 'playing') {
      // Premier à poser : déclenche les derniers tours pour tout le monde d'autre.
      nextState.firstToLayId = playerId;
      nextState.status = 'last_turns';
      nextState.lastTurnQueue = state.turnOrder.filter((id) => id !== playerId);
    } else {
      // Déjà en derniers tours : ce joueur a posé au lieu de simplement défausser,
      // il sort donc de la file de ceux qui doivent encore jouer.
      nextState.lastTurnQueue = (state.lastTurnQueue || []).filter((id) => id !== playerId);
    }

    if (nextState.lastTurnQueue.length === 0) {
      return finishRound(nextState);
    }
    nextState.currentPlayerId = nextState.lastTurnQueue[0];
    return nextState;
  }

  if (goOut && canAttemptGoOut) {
    throw new Error("Tu ne peux pas poser : ta main ne forme pas uniquement des suites/familles.");
  }

  nextState.log = [...state.log, { ts: Date.now(), message: logMessage }].slice(-40);

  // Fin du tour
  if (state.status === 'last_turns') {
    const queue = (state.lastTurnQueue || []).filter((id) => id !== playerId);
    nextState.lastTurnQueue = queue;
    if (queue.length === 0) return finishRound(nextState);
    nextState.currentPlayerId = queue[0];
    return nextState;
  }

  nextState.currentPlayerId = nextPlayerId(state.turnOrder, playerId);
  return nextState;
}

function finishRound(state) {
  const players = state.players.map((p) => {
    if (p.laidDown) {
      return { ...p, hand: [], score: p.score }; // 0 point de manche
    }
    const penalty = handPenalty(p.hand, state.trumpRank);
    return { ...p, score: p.score + penalty };
  });

  const roundScores = {};
  for (const p of state.players) {
    roundScores[p.id] = p.laidDown ? 0 : handPenalty(p.hand, state.trumpRank);
  }

  const messages = players.map(
    (p) => `${p.name} : +${roundScores[p.id] ?? 0} (total ${p.score})`
  );

  const isLastRound = state.handSize >= 13;
  let gameWinnerId = null;
  if (isLastRound) {
    let best = Infinity;
    for (const p of players) {
      if (p.score < best) {
        best = p.score;
        gameWinnerId = p.id;
      }
    }
  }

  return {
    ...state,
    status: 'finished',
    phase: 'draw',
    players,
    roundScores,
    currentPlayerId: null,
    gameWinnerId,
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message: isLastRound
          ? `Partie terminée — ${messages.join(' · ')}. Gagnant : ${
              players.find((p) => p.id === gameWinnerId)?.name || '?'
            } !`
          : `Manche terminée — ${messages.join(' · ')}.`
      }
    ].slice(-40)
  };
}

/**
 * Manche suivante : handSize+1, scores conservés.
 * Si handSize était 13 ou gameWinnerId, repart à 3 (nouvelle partie).
 */
export function startNextRound(state) {
  if (state.status !== 'finished') {
    throw new Error("La manche n'est pas terminée.");
  }
  const players = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot || false
  }));
  const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  if (state.gameWinnerId || state.handSize >= 13) {
    return initGame(players, null, 3);
  }
  return initGame(players, scores, state.handSize + 1);
}
