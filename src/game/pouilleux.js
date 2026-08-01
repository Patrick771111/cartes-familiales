import { buildPouilleuxDeck, shuffle, deal } from './deck.js';

/** Retire du tas toutes les paires de même rang (peu importe la couleur). */
export function discardPairs(hand) {
  const byRank = new Map();
  for (const card of hand) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card);
  }
  const kept = [];
  const discarded = [];
  for (const cards of byRank.values()) {
    const pairs = Math.floor(cards.length / 2);
    discarded.push(...cards.slice(0, pairs * 2));
    kept.push(...cards.slice(pairs * 2));
  }
  return { hand: kept, discarded };
}

/**
 * Crée l'état initial d'une partie : distribution + défaussage automatique des paires
 * déjà présentes en main. `players` est un tableau de {id, name} dans l'ordre du tour.
 */
export function initGame(players) {
  const { deck, oddCardId } = buildPouilleuxDeck();
  const shuffled = shuffle(deck);
  const hands = deal(shuffled, players.map((p) => p.id));

  const initializedPlayers = players.map((p) => {
    const { hand } = discardPairs(hands[p.id]);
    return { id: p.id, name: p.name, hand };
  });

  return {
    status: 'playing',
    players: initializedPlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: players[0].id,
    oddCardId,
    loserId: null,
    log: [{ ts: Date.now(), message: 'La partie commence !' }]
  };
}

/** Prochain joueur (dans l'ordre du tour) qui a encore des cartes en main, en partant de `fromId`. */
function nextActivePlayer(turnOrder, players, fromId) {
  const idx = turnOrder.indexOf(fromId);
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidateId = turnOrder[(idx + step) % turnOrder.length];
    const candidate = players.find((p) => p.id === candidateId);
    if (candidate && candidate.hand.length > 0) return candidateId;
  }
  return null;
}

export function playerToDrawFrom(state) {
  return nextActivePlayer(state.turnOrder, state.players, state.currentPlayerId);
}

/**
 * Applique le tirage : le joueur courant pioche une carte au hasard chez le joueur
 * suivant, défausse les paires formées, puis la main passe. Retourne un nouvel état.
 */
export function applyDraw(state, actingPlayerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== actingPlayerId) throw new Error("Ce n'est pas ton tour.");

  const targetId = playerToDrawFrom(state);
  if (!targetId) throw new Error('Aucun joueur chez qui piocher.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === actingPlayerId);
  const target = players.find((p) => p.id === targetId);

  const pickIndex = Math.floor(Math.random() * target.hand.length);
  const [card] = target.hand.splice(pickIndex, 1);
  current.hand.push(card);

  const { hand: newHand, discarded } = discardPairs(current.hand);
  current.hand = newHand;

  const logEntry = discarded.length
    ? { ts: Date.now(), message: `${current.name} pioche chez ${target.name} et défausse une paire.` }
    : { ts: Date.now(), message: `${current.name} pioche chez ${target.name}.` };

  const lastDraw = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    by: actingPlayerId,
    from: targetId,
    card,
    paired: discarded.length > 0
  };

  const remainingActive = players.filter((p) => p.hand.length > 0);

  let status = state.status;
  let loserId = state.loserId;
  let nextCurrentId = nextActivePlayer(state.turnOrder, players, actingPlayerId);

  if (remainingActive.length === 1) {
    status = 'finished';
    loserId = remainingActive[0].id;
    nextCurrentId = null;
  }

  return {
    ...state,
    players,
    status,
    loserId,
    currentPlayerId: nextCurrentId,
    lastDraw,
    log: [...state.log, logEntry].slice(-40)
  };
}
