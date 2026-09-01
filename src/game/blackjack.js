import { buildStandardDeck, shuffle } from './deck.js';
import { commitGameAction } from './core.js';

export const meta = { id: 'blackjack', label: 'Blackjack', hint: '1 à 6 joueurs, banque tenue par un bot', minPlayers: 1 };

export const STARTING_MONEY = 500;
export const DEFAULT_BET = 25;
export const MIN_BET = 5;
export const MAX_BET = 500;
export const CHIP_VALUES = [5, 10, 25, 100];

export function chipsForAmount(amount) {
  const chips = [];
  let left = Math.max(0, amount);
  for (const v of [...CHIP_VALUES].reverse()) {
    while (left >= v) {
      chips.push(v);
      left -= v;
    }
  }
  return chips;
}
export const SHOE_DECKS = 6;
export const MAX_SPLIT_HANDS = 4;

export function clampBet(bet, money = MAX_BET) {
  const n = Number(bet);
  if (!Number.isFinite(n)) return DEFAULT_BET;
  const cap = Math.min(MAX_BET, Math.max(0, money));
  const rounded = Math.round(n / MIN_BET) * MIN_BET;
  return Math.min(cap, Math.max(0, rounded));
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return parseInt(card.rank, 10);
}

export function isTenValue(card) {
  return cardValue(card) === 10;
}

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

export function isSoft(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += cardValue(card);
    if (card.rank === 'A') aces += 1;
  }
  let softAces = aces;
  while (total > 21 && softAces > 0) {
    total -= 10;
    softAces -= 1;
  }
  return softAces > 0 && total <= 21;
}

export function isBlackjack(hand) {
  return hand.length === 2 && handTotal(hand) === 21;
}

export function playerHands(p) {
  if (Array.isArray(p.hands) && p.hands.length) return p.hands;
  if (Array.isArray(p.hand) && p.hand.length) {
    return [{ cards: p.hand, bet: p.bet ?? DEFAULT_BET, status: p.status || 'playing' }];
  }
  return [];
}

export function activeHand(p) {
  const hands = playerHands(p);
  const i = Math.max(0, Math.min(p.handIndex || 0, hands.length - 1));
  return hands[i] || null;
}

function buildShoe() {
  const cards = [];
  for (let d = 0; d < SHOE_DECKS; d++) {
    for (const card of buildStandardDeck()) {
      cards.push({ ...card, id: `${card.id}-${d}` });
    }
  }
  return shuffle(cards);
}

function freshPlayer(p, money) {
  return {
    id: p.id,
    name: p.name,
    isBot: p.isBot || false,
    money,
    bet: 0,
    betReady: false,
    hands: [],
    handIndex: 0,
    insurance: 0,
    insuranceDecided: false
  };
}

function nextActingPlayer(state, fromId) {
  const order = state.turnOrder;
  const idx = Math.max(0, order.indexOf(fromId));
  for (let step = 1; step <= order.length; step++) {
    const id = order[(idx + step) % order.length];
    const p = state.players.find((pl) => pl.id === id);
    if (!p) continue;
    const hands = playerHands(p);
    if (hands.some((h) => h.status === 'playing')) return id;
  }
  return null;
}

export function canDouble(p, money = p.money) {
  const h = activeHand(p);
  if (!h || h.status !== 'playing' || h.cards.length !== 2) return false;
  if (h.splitAces) return false;
  return money >= h.bet;
}

export function canSplit(p, money = p.money) {
  const h = activeHand(p);
  if (!h || h.status !== 'playing' || h.cards.length !== 2) return false;
  if (playerHands(p).length >= MAX_SPLIT_HANDS) return false;
  if (h.splitAces) return false;
  if (h.cards[0].rank !== h.cards[1].rank) return false;
  return money >= h.bet;
}

export function canTakeInsurance(state, p) {
  if (state.status !== 'playing' || !state.offerInsurance) return false;
  if (p.insuranceDecided) return false;
  if (!state.dealer?.hand?.[0] || state.dealer.hand[0].rank !== 'A') return false;
  const bet = p.bet || 0;
  return bet > 0 && p.money >= Math.floor(bet / 2);
}

function payoutHand(result, bet, natural) {
  if (result === 'win') return natural ? Math.floor(bet * 2.5) : bet * 2;
  if (result === 'push') return bet;
  return 0;
}

function compareHands(playerHand, dealerHand, dealerBj, dealerBust, dealerTotal) {
  const total = handTotal(playerHand.cards);
  const playerBj = isBlackjack(playerHand.cards) && !playerHand.fromSplit;
  if (playerHand.status === 'bust') return { result: 'lose', natural: false };
  if (playerBj && dealerBj) return { result: 'push', natural: true };
  if (playerBj) return { result: 'win', natural: true };
  if (dealerBj) return { result: 'lose', natural: false };
  if (dealerBust || total > dealerTotal) return { result: 'win', natural: false };
  if (total < dealerTotal) return { result: 'lose', natural: false };
  return { result: 'push', natural: false };
}

function finishRound(state) {
  const deck = state.deck.slice();
  const dealerHand = state.dealer.hand.slice();
  const dealerBj = isBlackjack(dealerHand);

  if (!dealerBj) {
    while (handTotal(dealerHand) < 17 && deck.length > 0) {
      dealerHand.push(deck.shift());
    }
  }

  const dealerTotal = handTotal(dealerHand);
  const dealerBust = dealerTotal > 21;
  const results = {};
  const players = state.players.map((p) => {
    let money = p.money;
    const handResults = [];
    for (const h of playerHands(p)) {
      const { result, natural } = compareHands(h, dealerHand, dealerBj, dealerBust, dealerTotal);
      handResults.push(result);
      money += payoutHand(result, h.bet, natural);
    }
    if (p.insurance > 0) {
      money += dealerBj ? p.insurance * 3 : 0;
    }
    const overall =
      handResults.every((r) => r === 'win') ? 'win' : handResults.every((r) => r === 'lose') ? 'lose' : handResults.every((r) => r === 'push') ? 'push' : 'mixed';
    results[p.id] = overall;
    return { ...p, money, hands: playerHands(p) };
  });

  const logMessage = dealerBj
    ? 'Blackjack de la banque !'
    : dealerBust
      ? `La banque saute avec ${dealerTotal} !`
      : `La banque s'arrête à ${dealerTotal}.`;

  return {
    ...state,
    players,
    status: 'finished',
    dealer: { hand: dealerHand, hidden: false },
    deck,
    results,
    offerInsurance: false,
    currentPlayerId: null,
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };
}

function dealRoundFixed(state) {
  const deck = buildShoe();
  const active = state.players.filter((p) => p.bet >= MIN_BET && p.bet <= p.money);
  if (!active.length) {
    return {
      ...state,
      status: 'finished',
      log: [...state.log, { ts: Date.now(), message: 'Personne n’a misé — manche annulée.' }].slice(-40)
    };
  }

  const players = state.players.map((p) => ({
    ...p,
    hands: [],
    handIndex: 0,
    insurance: 0,
    insuranceDecided: p.bet < MIN_BET || p.bet > p.money
  }));

  let i = 0;
  const take = () => deck[i++];

  for (const p of players) {
    if (p.bet < MIN_BET || p.bet > p.money) continue;
    p.hands = [{ cards: [take()], bet: p.bet, status: 'playing', fromSplit: false, splitAces: false }];
    p.money -= p.bet;
  }
  const dealerHand = [take()];
  for (const p of players) {
    if (!p.hands.length) continue;
    p.hands[0].cards.push(take());
  }
  dealerHand.push(take());

  for (const p of players) {
    if (!p.hands.length) continue;
    if (isBlackjack(p.hands[0].cards)) p.hands[0].status = 'blackjack';
  }

  const dealerUp = dealerHand[0];
  const dealerBj = isBlackjack(dealerHand);
  const offerInsurance = dealerUp.rank === 'A';

  let next = {
    ...state,
    status: 'playing',
    players,
    dealer: { hand: dealerHand, hidden: true },
    deck: deck.slice(i),
    offerInsurance,
    results: null,
    currentPlayerId: null,
    log: [...state.log, { ts: Date.now(), message: 'La banque distribue.' }].slice(-40)
  };

  if (offerInsurance) {
    const first = next.turnOrder.find((id) => {
      const p = players.find((pl) => pl.id === id);
      return p && p.hands.length && !p.insuranceDecided;
    });
    next.currentPlayerId = first || null;
    if (!first) next = afterInsurance(next);
    return next;
  }

  if (isTenValue(dealerUp) && dealerBj) {
    return finishRound({ ...next, dealer: { hand: dealerHand, hidden: false } });
  }

  return startActing(next);
}

function afterInsurance(state) {
  const dealerBj = isBlackjack(state.dealer.hand);
  if (dealerBj) {
    return finishRound({ ...state, offerInsurance: false, dealer: { ...state.dealer, hidden: false } });
  }
  return startActing({ ...state, offerInsurance: false });
}

function startActing(state) {
  const firstId = state.turnOrder.find((id) => {
    const p = state.players.find((pl) => pl.id === id);
    return p && playerHands(p).some((h) => h.status === 'playing');
  });
  if (!firstId) return finishRound(state);
  const players = state.players.map((p) => {
    if (p.id !== firstId) return p;
    const idx = playerHands(p).findIndex((h) => h.status === 'playing');
    return { ...p, handIndex: Math.max(0, idx) };
  });
  return { ...state, players, currentPlayerId: firstId, offerInsurance: false };
}

function advanceAfterHand(state, playerId) {
  const players = state.players.map((p) => ({ ...p, hands: playerHands(p).map((h) => ({ ...h, cards: h.cards.slice() })) }));
  const p = players.find((pl) => pl.id === playerId);
  const nextHand = playerHands(p).findIndex((h, i) => i > (p.handIndex || 0) && h.status === 'playing');
  if (nextHand !== -1) {
    p.handIndex = nextHand;
    return { ...state, players, currentPlayerId: playerId };
  }
  const nextId = nextActingPlayer({ ...state, players }, playerId);
  if (!nextId) return finishRound({ ...state, players });
  const np = players.find((pl) => pl.id === nextId);
  np.handIndex = playerHands(np).findIndex((h) => h.status === 'playing');
  return { ...state, players, currentPlayerId: nextId };
}

export function initGame(players, previousMoney = null) {
  if (players.length < 1) throw new Error('Il faut au moins 1 joueur pour le Blackjack.');
  const gamePlayers = players.map((p) => {
    const money = previousMoney?.[p.id] ?? STARTING_MONEY;
    const suggested = clampBet(p.bet ?? DEFAULT_BET, money);
    return {
      ...freshPlayer(p, money),
      bet: p.isBot ? suggested : 0,
      betReady: Boolean(p.isBot && suggested >= MIN_BET)
    };
  });
  const turnOrder = shuffle(players.map((p) => p.id));
  let state = {
    status: 'betting',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: null,
    dealer: { hand: [], hidden: true },
    deck: [],
    results: null,
    offerInsurance: false,
    log: [{ ts: Date.now(), message: 'Placez vos jetons pour miser.' }]
  };
  if (gamePlayers.every((p) => p.betReady)) state = dealRoundFixed(state);
  return state;
}

export function continueRound(room, playersList) {
  const previousMoney = Object.fromEntries(room.state.players.map((p) => [p.id, p.money]));
  const withBets = playersList.map((p) => {
    const prev = room.state.players.find((x) => x.id === p.id);
    return { ...p, bet: prev?.bet ?? p.bet };
  });
  return initGame(withBets, previousMoney);
}

export function applyAddChip(state, playerId, value) {
  if (state.status !== 'betting') throw new Error('Les mises sont closes.');
  if (!CHIP_VALUES.includes(Number(value))) throw new Error('Jeton inconnu.');
  const players = state.players.map((p) => ({ ...p }));
  const p = players.find((x) => x.id === playerId);
  if (!p) throw new Error('Joueur introuvable.');
  if (p.betReady) throw new Error('Mise déjà validée.');
  const next = p.bet + Number(value);
  if (next > Math.min(MAX_BET, p.money)) throw new Error('Mise trop élevée.');
  p.bet = next;
  return { ...state, players };
}

export function applyClearBet(state, playerId) {
  if (state.status !== 'betting') throw new Error('Les mises sont closes.');
  const players = state.players.map((p) => (p.id === playerId && !p.betReady ? { ...p, bet: 0 } : p));
  return { ...state, players };
}

export function applyConfirmBet(state, playerId) {
  if (state.status !== 'betting') throw new Error('Les mises sont closes.');
  const players = state.players.map((p) => {
    if (p.id !== playerId) return p;
    if (p.money < MIN_BET) return { ...p, bet: 0, betReady: true };
    if (p.bet < MIN_BET) throw new Error(`Mise minimum : ${MIN_BET}.`);
    if (p.bet > p.money) throw new Error('Mise supérieure au solde.');
    return { ...p, betReady: true };
  });
  let next = { ...state, players };
  if (players.every((p) => p.betReady)) next = dealRoundFixed(next);
  return next;
}

export function applyInsurance(state, playerId, take) {
  if (state.status !== 'playing' || !state.offerInsurance) throw new Error("Pas d'assurance maintenant.");
  const players = state.players.map((p) => ({ ...p }));
  const p = players.find((x) => x.id === playerId);
  if (!p || p.insuranceDecided) throw new Error('Assurance déjà tranchée.');
  if (!p.hands.length) {
    p.insuranceDecided = true;
  } else if (take) {
    const cost = Math.floor((p.bet || 0) / 2);
    if (cost < 1 || p.money < cost) throw new Error('Solde insuffisant pour l’assurance.');
    p.money -= cost;
    p.insurance = cost;
    p.insuranceDecided = true;
  } else {
    p.insuranceDecided = true;
  }

  let next = {
    ...state,
    players,
    log: [...state.log, { ts: Date.now(), message: take ? `${p.name} prend l’assurance.` : `${p.name} refuse l’assurance.` }].slice(-40)
  };
  const pending = players.filter((pl) => pl.hands.length && !pl.insuranceDecided);
  if (!pending.length) return afterInsurance(next);
  next.currentPlayerId = pending[0].id;
  return next;
}

export function applyHit(state, playerId) {
  if (state.status !== 'playing' || state.offerInsurance) throw new Error('Action impossible maintenant.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  const players = state.players.map((p) => ({
    ...p,
    hands: playerHands(p).map((h) => ({ ...h, cards: h.cards.slice() }))
  }));
  const p = players.find((x) => x.id === playerId);
  const h = activeHand(p);
  if (!h || h.status !== 'playing') throw new Error('Aucune main à jouer.');
  if (h.splitAces) throw new Error('Après un split d’As, une seule carte.');
  if (!state.deck.length) throw new Error('Sabot vide.');

  const deck = state.deck.slice();
  h.cards.push(deck.shift());
  const total = handTotal(h.cards);
  if (total > 21) h.status = 'bust';
  else if (total === 21) h.status = 'stood';

  let next = {
    ...state,
    players,
    deck,
    log: [...state.log, { ts: Date.now(), message: `${p.name} tire (${total}${h.status === 'bust' ? ' — sauté' : ''}).` }].slice(-40)
  };
  if (h.status !== 'playing') next = advanceAfterHand(next, playerId);
  return next;
}

export function applyStand(state, playerId) {
  if (state.status !== 'playing' || state.offerInsurance) throw new Error('Action impossible maintenant.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  const players = state.players.map((p) => ({
    ...p,
    hands: playerHands(p).map((h) => ({ ...h, cards: h.cards.slice() }))
  }));
  const p = players.find((x) => x.id === playerId);
  const h = activeHand(p);
  if (!h || h.status !== 'playing') throw new Error('Aucune main à jouer.');
  h.status = 'stood';
  let next = {
    ...state,
    players,
    log: [...state.log, { ts: Date.now(), message: `${p.name} reste.` }].slice(-40)
  };
  return advanceAfterHand(next, playerId);
}

export function applyDouble(state, playerId) {
  if (state.status !== 'playing' || state.offerInsurance) throw new Error('Action impossible maintenant.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  const players = state.players.map((p) => ({
    ...p,
    hands: playerHands(p).map((h) => ({ ...h, cards: h.cards.slice() }))
  }));
  const p = players.find((x) => x.id === playerId);
  if (!canDouble(p)) throw new Error('Double impossible.');
  const h = activeHand(p);
  p.money -= h.bet;
  h.bet *= 2;
  const deck = state.deck.slice();
  h.cards.push(deck.shift());
  const total = handTotal(h.cards);
  h.status = total > 21 ? 'bust' : 'stood';
  let next = {
    ...state,
    players,
    deck,
    log: [...state.log, { ts: Date.now(), message: `${p.name} double (${total}).` }].slice(-40)
  };
  return advanceAfterHand(next, playerId);
}

export function applySplit(state, playerId) {
  if (state.status !== 'playing' || state.offerInsurance) throw new Error('Action impossible maintenant.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  const players = state.players.map((p) => ({
    ...p,
    hands: playerHands(p).map((h) => ({ ...h, cards: h.cards.slice() }))
  }));
  const p = players.find((x) => x.id === playerId);
  if (!canSplit(p)) throw new Error('Split impossible.');
  const idx = p.handIndex || 0;
  const h = p.hands[idx];
  const [a, b] = h.cards;
  p.money -= h.bet;
  const aces = a.rank === 'A';
  const deck = state.deck.slice();
  h.cards = [a, deck.shift()];
  h.fromSplit = true;
  h.splitAces = aces;
  if (aces) h.status = 'stood';
  else if (handTotal(h.cards) === 21) h.status = 'stood';

  const h2 = {
    cards: [b, deck.shift()],
    bet: h.bet,
    status: aces ? 'stood' : 'playing',
    fromSplit: true,
    splitAces: aces
  };
  if (!aces && handTotal(h2.cards) === 21) h2.status = 'stood';
  p.hands.splice(idx + 1, 0, h2);

  let next = {
    ...state,
    players,
    deck,
    log: [...state.log, { ts: Date.now(), message: `${p.name} split.` }].slice(-40)
  };
  if (h.status !== 'playing') next = advanceAfterHand(next, playerId);
  return next;
}

export async function addChip(room, playerId, value) {
  return commitGameAction(room, (s) => applyAddChip(s, playerId, value));
}
export async function clearBet(room, playerId) {
  return commitGameAction(room, (s) => applyClearBet(s, playerId));
}
export async function confirmBet(room, playerId) {
  return commitGameAction(room, (s) => applyConfirmBet(s, playerId));
}
export async function setBlackjackBet(room, playerId, bet) {
  return commitGameAction(room, (s) => {
    if (s.status === 'playing') throw new Error('Impossible de changer sa mise en pleine manche.');
    if (s.status === 'betting') {
      const players = s.players.map((p) => {
        if (p.id !== playerId || p.betReady) return p;
        return { ...p, bet: clampBet(bet, p.money) };
      });
      return { ...s, players };
    }
    const players = s.players.map((p) => (p.id === playerId ? { ...p, bet: clampBet(bet, p.money) } : p));
    return { ...s, players };
  });
}
export async function takeInsurance(room, playerId, take) {
  return commitGameAction(room, (s) => applyInsurance(s, playerId, take));
}
export async function hitBlackjack(room, playerId) {
  return commitGameAction(room, (s) => applyHit(s, playerId));
}
export async function standBlackjack(room, playerId) {
  return commitGameAction(room, (s) => applyStand(s, playerId));
}
export async function doubleBlackjack(room, playerId) {
  return commitGameAction(room, (s) => applyDouble(s, playerId));
}
export async function splitBlackjack(room, playerId) {
  return commitGameAction(room, (s) => applySplit(s, playerId));
}
