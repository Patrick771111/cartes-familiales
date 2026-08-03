import { buildStandardDeck, shuffle } from './deck.js';

// Solde de départ, et mise réglable via un slider (5 à 100, par pas de 5) côté
// UI — chaque joueur règle sa propre mise indépendamment (stockée sur son
// entrée `players[i].bet`), pas de mise commune à la table. Le solde peut
// devenir négatif, le jeu continue quand même tant que la table ne retourne
// pas au lobby (voir engine.js : continueGame vs playAgain).
export const STARTING_MONEY = 500;
export const DEFAULT_BET = 25;
export const MIN_BET = 5;
export const MAX_BET = 100;

export function clampBet(bet) {
  const n = Number(bet);
  if (!Number.isFinite(n)) return DEFAULT_BET;
  return Math.min(MAX_BET, Math.max(MIN_BET, Math.round(n)));
}

/** Valeur d'une carte : figures = 10, As = 11 (ramené à 1 si besoin dans `handTotal`). */
function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return parseInt(card.rank, 10);
}

/** Total d'une main, en ramenant autant d'As que nécessaire de 11 à 1 pour éviter de sauter si possible. */
export function handTotal(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function nextPlayerId(turnOrder, players, fromId) {
  const idx = turnOrder.indexOf(fromId);
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidateId = turnOrder[(idx + step) % turnOrder.length];
    const candidate = players.find((p) => p.id === candidateId);
    if (candidate && candidate.status === 'playing') return candidateId;
  }
  return null;
}

/** Fait jouer la banque (tire tant que son total est inférieur à 17), puis compare chaque main encore en lice. */
function finishRound(state) {
  const deck = state.deck.slice();
  const dealerHand = state.dealer.hand.slice();
  while (handTotal(dealerHand) < 17 && deck.length > 0) {
    dealerHand.push(deck.shift());
  }

  const dealerTotal = handTotal(dealerHand);
  const dealerBust = dealerTotal > 21;

  const results = {};
  for (const p of state.players) {
    if (p.status === 'bust') {
      results[p.id] = 'lose';
      continue;
    }
    const total = handTotal(p.hand);
    if (dealerBust || total > dealerTotal) results[p.id] = 'win';
    else if (total < dealerTotal) results[p.id] = 'lose';
    else results[p.id] = 'push';
  }

  // Chaque joueur a sa propre mise, appliquée à son solde (négatif autorisé) —
  // pas de bonus 3:2 pour un blackjack naturel, pour rester simple.
  const players = state.players.map((p) => {
    const bet = p.bet ?? DEFAULT_BET;
    const delta = results[p.id] === 'win' ? bet : results[p.id] === 'lose' ? -bet : 0;
    return { ...p, money: (p.money ?? STARTING_MONEY) + delta };
  });

  const logMessage = dealerBust
    ? `La banque saute avec ${dealerTotal} !`
    : `La banque s'arrête à ${dealerTotal}.`;

  return {
    ...state,
    players,
    status: 'finished',
    dealer: { hand: dealerHand, hidden: false },
    deck,
    results,
    currentPlayerId: null,
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };
}

/**
 * Crée l'état initial d'une manche : 2 cartes chacun, 2 pour la banque (dont une
 * cachée). La banque n'est **pas** un joueur — elle vit à part dans `state.dealer`
 * et n'est jamais contrôlée par un humain, toujours jouée automatiquement une fois
 * que tout le monde a fini *(hypothèse : pas de "peek" — si la banque a un
 * blackjack naturel avec une carte cachée, ça ne se révèle qu'à la toute fin,
 * comme pour n'importe quelle autre main)*.
 *
 * `previousMoney` (optionnel) = `{ [playerId]: solde }` de la manche précédente,
 * fourni par `continueGame` (engine.js) quand on enchaîne une manche sans
 * repasser par le lobby — sinon (première manche, ou retour au lobby entre
 * temps) tout le monde repart de `STARTING_MONEY`. Chaque joueur a sa propre
 * mise (`p.bet`, réglée via son propre slider côté UI, indépendamment des
 * autres), déjà présente sur les entrées de `players` fournies par engine.js.
 */
export function initGame(players, previousMoney = null) {
  if (players.length < 1) {
    throw new Error('Il faut au moins 1 joueur pour le Blackjack.');
  }

  const deck = shuffle(buildStandardDeck());
  let cursor = 0;

  const gamePlayers = players.map((p) => {
    const hand = [deck[cursor], deck[cursor + 1]];
    cursor += 2;
    const money = previousMoney?.[p.id] ?? STARTING_MONEY;
    const bet = clampBet(p.bet ?? DEFAULT_BET);
    const status = handTotal(hand) === 21 ? 'stood' : 'playing';
    return { id: p.id, name: p.name, hand, status, money, bet, isBot: p.isBot || false };
  });

  const dealerHand = [deck[cursor], deck[cursor + 1]];
  cursor += 2;

  const turnOrder = players.map((p) => p.id);
  const firstPlayerId = gamePlayers.find((p) => p.status === 'playing')?.id || null;

  let state = {
    status: 'playing',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: firstPlayerId,
    dealer: { hand: dealerHand, hidden: true },
    deck: deck.slice(cursor),
    results: null,
    log: [{ ts: Date.now(), message: 'La banque distribue 2 cartes à chacun.' }]
  };

  // Tout le monde a un blackjack naturel dès la donne : personne à faire jouer,
  // on résout directement.
  if (!firstPlayerId) state = finishRound(state);

  return state;
}

export function applyHit(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.deck.length) throw new Error('Plus de cartes dans le sabot — relance une manche.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const deck = state.deck.slice();
  current.hand.push(deck.shift());

  const total = handTotal(current.hand);
  const busted = total > 21;
  if (busted || total === 21) current.status = busted ? 'bust' : 'stood';

  const logMessage = `${current.name} tire une carte (${total}${busted ? ' — passé !' : ''}).`;
  let nextState = { ...state, players, deck, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) };

  if (current.status !== 'playing') {
    const nextId = nextPlayerId(state.turnOrder, players, playerId);
    nextState.currentPlayerId = nextId;
    if (!nextId) nextState = finishRound(nextState);
  }

  return nextState;
}

export function applyStand(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => (p.id === playerId ? { ...p, status: 'stood' } : p));
  const current = players.find((p) => p.id === playerId);

  let nextState = { ...state, players, log: [...state.log, { ts: Date.now(), message: `${current.name} reste.` }].slice(-40) };

  const nextId = nextPlayerId(state.turnOrder, players, playerId);
  nextState.currentPlayerId = nextId;
  if (!nextId) nextState = finishRound(nextState);

  return nextState;
}
