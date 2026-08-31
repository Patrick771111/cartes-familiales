import { buildPouilleuxDeck, shuffle, deal } from './deck.js';
import { commitGameAction } from './core.js';

export const meta = { id: 'pouilleux', label: 'Le Pouilleux', hint: '2 à 6 joueurs', minPlayers: 2 };

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
 * Défausse uniquement les paires **adjacentes** dans l'ordre donné
 * (deux cartes de même rang côte à côte, ou l'une posée sur l'autre).
 * Les paires non collées restent en main — le joueur les forme en réordonnant.
 */
export function discardAdjacentPairs(hand) {
  const kept = [];
  const discarded = [];
  let i = 0;
  while (i < hand.length) {
    if (i + 1 < hand.length && hand[i].rank === hand[i + 1].rank) {
      discarded.push(hand[i], hand[i + 1]);
      i += 2;
    } else {
      kept.push(hand[i]);
      i += 1;
    }
  }
  return { hand: kept, discarded };
}

export function hasPair(hand) {
  const counts = new Map();
  for (const card of hand) counts.set(card.rank, (counts.get(card.rank) || 0) + 1);
  return [...counts.values()].some((n) => n >= 2);
}

/** Ordre qui colle les cartes de même rang — les bots « trient » ainsi pour former leurs paires. */
export function idsGroupedByRank(hand) {
  const byRank = new Map();
  for (const card of hand) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card.id);
  }
  return [...byRank.values()].flat();
}

/**
 * Crée l'état initial d'une partie : distribution complète. Les paires ne
 * sont plus défaussées automatiquement — chacun les forme en rangeant sa main.
 */
export function initGame(players) {
  const { deck, oddCardId } = buildPouilleuxDeck();
  const shuffled = shuffle(deck);
  const hands = deal(shuffled, players.map((p) => p.id));

  const initializedPlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: hands[p.id],
    isBot: p.isBot || false
  }));

  // Ordre de jeu aléatoire, fixé pour toute la partie (pas l'ordre d'arrivée en salle).
  const turnOrder = shuffle(players.map((p) => p.id));

  return {
    status: 'playing',
    players: initializedPlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
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

function finishIfNeeded(state, players, actingPlayerId) {
  const remainingActive = players.filter((p) => p.hand.length > 0);
  let status = state.status;
  let loserId = state.loserId;
  let currentPlayerId = state.currentPlayerId;
  if (remainingActive.length === 1) {
    status = 'finished';
    loserId = remainingActive[0].id;
    currentPlayerId = null;
  } else if (currentPlayerId === actingPlayerId) {
    const stillHere = players.find((p) => p.id === actingPlayerId);
    if (!stillHere || stillHere.hand.length === 0) {
      currentPlayerId = nextActivePlayer(state.turnOrder, players, actingPlayerId);
    }
  }
  return { status, loserId, currentPlayerId };
}

/**
 * Applique le tirage : le joueur courant pioche à l'aveugle chez le suivant.
 * La carte rejoint sa main (en bout) ; une paire ne se défausse que s'il
 * colle deux cartes de même rang (voir applyFormAdjacentPairs).
 */
export function applyDraw(state, actingPlayerId, cardIndex) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== actingPlayerId) throw new Error("Ce n'est pas ton tour.");

  const targetId = playerToDrawFrom(state);
  if (!targetId) throw new Error('Aucun joueur chez qui piocher.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === actingPlayerId);
  const target = players.find((p) => p.id === targetId);

  if (typeof cardIndex !== 'number' || cardIndex < 0 || cardIndex >= target.hand.length) {
    throw new Error('Choix de carte invalide.');
  }

  const [card] = target.hand.splice(cardIndex, 1);
  current.hand.push(card);

  const lastDraw = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    by: actingPlayerId,
    from: targetId,
    card,
    paired: false,
    drawerFinished: false,
    targetFinished: target.hand.length === 0
  };

  const { status, loserId, currentPlayerId } = finishIfNeeded(
    { ...state, currentPlayerId: nextActivePlayer(state.turnOrder, players, actingPlayerId) },
    players,
    actingPlayerId
  );

  return {
    ...state,
    players,
    status,
    loserId,
    currentPlayerId,
    lastDraw,
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche chez ${target.name}.` }].slice(-40)
  };
}

/**
 * Défausse les paires adjacentes dans `orderedIds` (permutation de la main
 * du joueur). Autorisé à tout moment : chacun range sa main quand il veut.
 */
export function applyFormAdjacentPairs(state, playerId, orderedIds) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const player = players.find((p) => p.id === playerId);
  if (!player) throw new Error('Joueur introuvable.');
  if (!Array.isArray(orderedIds)) throw new Error('Ordre de main invalide.');

  const have = new Set(player.hand.map((c) => c.id));
  if (orderedIds.length !== player.hand.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('Ordre de main invalide.');
  }
  if (!orderedIds.every((id) => have.has(id))) throw new Error('Ordre de main invalide.');

  const ordered = orderedIds.map((id) => player.hand.find((c) => c.id === id));
  const { hand, discarded } = discardAdjacentPairs(ordered);
  if (!discarded.length) throw new Error('Aucune paire collée.');
  player.hand = hand;

  const pairCount = discarded.length / 2;
  const logEntry = {
    ts: Date.now(),
    message: pairCount > 1 ? `${player.name} défausse ${pairCount} paires.` : `${player.name} défausse une paire.`
  };

  const emptied = player.hand.length === 0;
  const { status, loserId, currentPlayerId } = finishIfNeeded(state, players, playerId);

  return {
    ...state,
    players,
    status,
    loserId,
    currentPlayerId,
    lastPair: { by: playerId, cardIds: discarded.map((c) => c.id), emptied },
    log: [...state.log, logEntry].slice(-40)
  };
}

/**
 * Fait piocher le joueur courant, à l'index de carte qu'il a choisi
 * (à l'aveugle) chez le joueur ciblé. On laisse l'appelant gérer ConflictError :
 * il resynchronisera via l'abonnement realtime (watchRoom) plutôt que de rejouer
 * l'action à l'aveugle.
 */
export async function drawForCurrentPlayer(room, playerId, cardIndex) {
  return commitGameAction(room, (state) => applyDraw(state, playerId, cardIndex));
}

export async function formAdjacentPairs(room, playerId, orderedIds) {
  return commitGameAction(room, (state) => applyFormAdjacentPairs(state, playerId, orderedIds));
}
