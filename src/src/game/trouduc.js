import { buildStandardDeck, shuffle, deal } from './deck.js';

/**
 * Ordre des rangs pour le Trou du Cul (du plus faible au plus fort) : le 2 est la
 * carte la plus forte de tout le jeu. Différent de l'ordre "naturel" utilisé au Pouilleux.
 */
export const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

// Règle "8 brûle" : poser un 8 vide immédiatement le pli en cours, et la main continue
// au même joueur (qui peut relancer sur n'importe quel rang). Règle classique du Trou du
// Cul, à distinguer du Président générique qui ne l'a pas toujours.
const BURN_RANKS = new Set(['8']);

export function rankValue(rank) {
  return RANK_ORDER.indexOf(rank);
}

function sortHand(hand) {
  return hand.slice().sort((a, b) => rankValue(a.rank) - rankValue(b.rank) || a.suit.localeCompare(b.suit));
}

function activePlayers(players) {
  return players.filter((p) => !p.finished);
}

function nextActivePlayerId(turnOrder, players, fromId) {
  const idx = turnOrder.indexOf(fromId);
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidateId = turnOrder[(idx + step) % turnOrder.length];
    const candidate = players.find((p) => p.id === candidateId);
    if (candidate && !candidate.finished) return candidateId;
  }
  return null;
}

/**
 * Crée l'état initial d'une manche : distribution complète du jeu de 52 cartes.
 * Le joueur qui a le 3 de trèfle commence (règle traditionnelle) ; à défaut
 * (ne devrait pas arriver avec un jeu complet), le premier joueur de la liste.
 */
export function initGame(players) {
  const deck = shuffle(buildStandardDeck());
  const hands = deal(deck, players.map((p) => p.id));

  const gamePlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: sortHand(hands[p.id]),
    finished: false,
    rank: null
  }));

  const starter = gamePlayers.find((p) => p.hand.some((c) => c.rank === '3' && c.suit === 'C'));
  const starterId = starter ? starter.id : gamePlayers[0].id;

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: starterId,
    pile: [],
    pileRank: null,
    pileCount: 0,
    lastPlayerToPlay: null,
    passedSinceLastPlay: [],
    finishedOrder: [],
    loserId: null,
    lastMove: null,
    log: [{ ts: Date.now(), message: 'La partie commence !' }]
  };
}

function finishRoundIfNeeded(state, players) {
  const remaining = activePlayers(players);
  if (remaining.length > 1) return null;

  const finishedOrder = [...state.finishedOrder];
  if (remaining.length === 1) finishedOrder.push(remaining[0].id);

  const withRanks = players.map((p) => ({
    ...p,
    rank: finishedOrder.indexOf(p.id) + 1
  }));

  return {
    status: 'finished',
    players: withRanks,
    currentPlayerId: null,
    finishedOrder,
    loserId: finishedOrder[finishedOrder.length - 1] || null
  };
}

/** Libellé de statut (Président / Trou du Cul / etc.) à partir du classement final. */
export function rankLabel(rank, totalPlayers) {
  if (rank === 1) return 'Président';
  if (rank === totalPlayers) return 'Trou du Cul';
  if (totalPlayers >= 4 && rank === 2) return 'Vice-Président';
  if (totalPlayers >= 4 && rank === totalPlayers - 1) return 'Vice-Trou du Cul';
  return 'Neutre';
}

/**
 * Vérifie si un ensemble de cartes (même rang) peut être posé sur le pli courant :
 * même nombre de cartes, rang strictement supérieur (ou pli vide = tout est permis).
 */
export function isLegalPlay(state, hand, cardIds) {
  if (!cardIds.length) return false;
  const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return false;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return false;

  if (state.pileCount === 0) return true;
  if (cards.length !== state.pileCount) return false;
  return rankValue(rank) > rankValue(state.pileRank);
}

export function applyPlay(state, playerId, cardIds) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);

  if (!isLegalPlay(state, current.hand, cardIds)) {
    throw new Error('Coup invalide.');
  }

  const rank = current.hand.find((c) => c.id === cardIds[0]).rank;
  const playedCards = cardIds.map((id) => current.hand.find((c) => c.id === id));
  current.hand = current.hand.filter((c) => !cardIds.includes(c.id));

  const finishedNow = current.hand.length === 0;
  if (finishedNow) {
    current.finished = true;
  }

  const finishedOrder = finishedNow ? [...state.finishedOrder, current.id] : state.finishedOrder;
  const willBurn = BURN_RANKS.has(rank);

  const logMessage = `${current.name} pose ${playedCards.length} × ${rank}${willBurn ? ' — le pli brûle !' : ''}${finishedNow ? ` — ${current.name} a fini !` : ''}`;

  let nextState = {
    ...state,
    players,
    pile: willBurn ? [] : playedCards,
    pileRank: willBurn ? null : rank,
    pileCount: willBurn ? 0 : playedCards.length,
    lastPlayerToPlay: willBurn ? null : current.id,
    passedSinceLastPlay: [],
    finishedOrder,
    lastMove: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      by: current.id,
      cards: playedCards,
      burned: willBurn,
      finished: finishedNow
    },
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };

  const roundEnd = finishRoundIfNeeded(nextState, players);
  if (roundEnd) {
    return { ...nextState, ...roundEnd };
  }

  if (willBurn && !finishedNow) {
    // Le joueur qui brûle le pli rejoue immédiatement.
    nextState.currentPlayerId = current.id;
  } else {
    nextState.currentPlayerId = nextActivePlayerId(nextState.turnOrder, players, current.id);
  }

  return nextState;
}

export function applyPass(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.pileCount === 0) throw new Error('Impossible de passer : à toi de relancer.');

  const player = state.players.find((p) => p.id === playerId);
  const passedSinceLastPlay = [...new Set([...state.passedSinceLastPlay, playerId])];
  const remaining = activePlayers(state.players).filter((p) => p.id !== state.lastPlayerToPlay);

  const logMessage = { ts: Date.now(), message: `${player.name} passe.` };
  let nextState = {
    ...state,
    passedSinceLastPlay,
    log: [...state.log, logMessage].slice(-40)
  };

  const everyoneElsePassed = remaining.every((p) => passedSinceLastPlay.includes(p.id));

  if (everyoneElsePassed) {
    const leaderStillIn = state.players.find((p) => p.id === state.lastPlayerToPlay && !p.finished);
    const leaderId = leaderStillIn ? leaderStillIn.id : nextActivePlayerId(state.turnOrder, state.players, state.lastPlayerToPlay);
    nextState = {
      ...nextState,
      pile: [],
      pileRank: null,
      pileCount: 0,
      lastPlayerToPlay: null,
      passedSinceLastPlay: [],
      currentPlayerId: leaderId,
      log: [...nextState.log, { ts: Date.now(), message: `Le pli est ramassé, ${state.players.find((p) => p.id === leaderId)?.name || '?'} relance.` }].slice(-40)
    };
  } else {
    nextState.currentPlayerId = nextActivePlayerId(state.turnOrder, state.players, playerId);
  }

  return nextState;
}
