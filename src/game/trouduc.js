import { buildStandardDeck, shuffle, deal } from './deck.js';

/**
 * Ordre des rangs pour le Trou du Cul (du plus faible au plus fort) : le 2 est la
 * carte la plus forte de tout le jeu. Différent de l'ordre "naturel" utilisé au Pouilleux.
 */
export const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

// Règle "8 brûle" : poser un 8 vide immédiatement le pli en cours, et la main continue
// au même joueur (qui peut relancer sur n'importe quel rang).
const BURN_RANKS = new Set(['8']);

// Jeu à 4 exactement : Président / Vice-Président / Secrétaire / Trou du Cul,
// avec échange forcé de cartes entre les deux extrêmes (2 cartes) et le binôme
// du milieu (1 carte) avant chaque donne.
export const REQUIRED_PLAYERS = 4;
const ROLE_LABELS = ['Président', 'Vice-Président', 'Secrétaire', 'Trou du Cul'];

export function rankValue(rank) {
  return RANK_ORDER.indexOf(rank);
}

export function rankLabel(rank) {
  return ROLE_LABELS[rank - 1] || `Rang ${rank}`;
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
 * Détermine l'ordre des rôles [Président, Vice-Président, Secrétaire, Trou du Cul]
 * pour cette manche : reprend le classement de la manche précédente si on en a un
 * et que les 4 mêmes joueurs sont toujours là, sinon tirage au sort (première manche).
 */
function assignRoleOrder(players, previousRanking) {
  const ids = players.map((p) => p.id);
  const previousValid =
    Array.isArray(previousRanking) &&
    previousRanking.length === REQUIRED_PLAYERS &&
    previousRanking.every((id) => ids.includes(id));

  return previousValid ? previousRanking : shuffle(ids);
}

/**
 * Déplace `count` cartes du haut de la main de `fromId` vers `toId`, et lui rend
 * `count` cartes du bas de sa main en échange. Retourne le détail (pour l'affichage).
 */
function exchangeCards(hands, fromId, toId, count) {
  const fromHand = sortHand(hands[fromId]);
  const given = fromHand.slice(fromHand.length - count);
  const fromRemainder = fromHand.slice(0, fromHand.length - count);

  const toHand = sortHand(hands[toId]);
  const returned = toHand.slice(0, count);
  const toRemainder = toHand.slice(count);

  hands[fromId] = [...fromRemainder, ...returned];
  hands[toId] = [...toRemainder, ...given];

  return { fromId, toId, given, returned };
}

/**
 * Crée l'état initial d'une manche à 4 joueurs : rôles (aléatoires ou hérités du
 * classement précédent via `previousRanking`), distribution, puis échange forcé
 * de cartes selon les rôles. Le Trou du Cul entame le premier pli.
 */
export function initGame(players, previousRanking = null) {
  if (players.length !== REQUIRED_PLAYERS) {
    throw new Error('Le Trou du Cul se joue à 4 joueurs exactement.');
  }

  const [presidentId, vicePresidentId, secretaireId, trouDuCulId] = assignRoleOrder(players, previousRanking);

  const deck = shuffle(buildStandardDeck());
  const hands = deal(deck, players.map((p) => p.id));

  const exchange1 = exchangeCards(hands, trouDuCulId, presidentId, 2);
  const exchange2 = exchangeCards(hands, secretaireId, vicePresidentId, 1);

  const roleById = {
    [presidentId]: 'Président',
    [vicePresidentId]: 'Vice-Président',
    [secretaireId]: 'Secrétaire',
    [trouDuCulId]: 'Trou du Cul'
  };

  const gamePlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: sortHand(hands[p.id]),
    finished: false,
    rank: null,
    role: roleById[p.id]
  }));

  const nameOf = (id) => players.find((p) => p.id === id)?.name || '?';

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: trouDuCulId,
    pile: [],
    pileRank: null,
    pileCount: 0,
    lastPlayerToPlay: null,
    passedSinceLastPlay: [],
    finishedOrder: [],
    loserId: null,
    lastMove: null,
    cardExchange: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pairs: [exchange1, exchange2]
    },
    log: [
      { ts: Date.now(), message: 'Nouvelle manche : les rôles sont distribués.' },
      { ts: Date.now(), message: `${nameOf(trouDuCulId)} (Trou du Cul) donne ses 2 meilleures cartes à ${nameOf(presidentId)} (Président), qui lui rend 2 cartes.` },
      { ts: Date.now(), message: `${nameOf(secretaireId)} (Secrétaire) donne sa meilleure carte à ${nameOf(vicePresidentId)} (Vice-Président), qui lui rend une carte.` },
      { ts: Date.now(), message: `${nameOf(trouDuCulId)} entame le premier pli.` }
    ]
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
  if (finishedNow) current.finished = true;

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

  let nextState = {
    ...state,
    passedSinceLastPlay,
    log: [...state.log, { ts: Date.now(), message: `${player.name} passe.` }].slice(-40)
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
