import { buildStandardDeck, shuffle, suitInfo } from './deck.js';

const SUIT_KEYS = ['S', 'H', 'D', 'C'];

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Prochain joueur dans l'ordre du tour (tous les joueurs restent "actifs" jusqu'à la victoire, pas de sortie en cours de partie). */
function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

/**
 * Une carte est jouable si c'est un 8 (toujours autorisé, change la couleur en
 * cours — voir `activeSuit`), si elle correspond à la couleur actuellement
 * demandée, ou si elle correspond au rang exact de la carte au sommet de la
 * défausse (utile après qu'un 8 a changé la couleur : on peut toujours
 * "rattraper" sur le rang réel de la carte posée).
 */
export function isLegalCard(state, card) {
  if (card.rank === '8') return true;
  const topCard = state.discard[state.discard.length - 1];
  return card.suit === state.activeSuit || card.rank === topCard.rank;
}

export function hasLegalMove(state, hand) {
  return hand.some((card) => isLegalCard(state, card));
}

/**
 * Crée l'état initial d'une partie : distribution (7 cartes chacun à 4 joueurs
 * ou moins, 5 au-delà, pour garder assez de pioche), puis on retourne la
 * première carte de la pioche pour ouvrir la défausse. Si cette carte de départ
 * est un 8, elle garde simplement sa couleur imprimée (pas de joker déclenché
 * avant même le premier tour) — hypothèse, à ajuster dans `initGame` si besoin.
 */
export function initGame(players) {
  if (players.length < 2) {
    throw new Error('Il faut au moins 2 joueurs pour le 8 américain.');
  }

  const deck = shuffle(buildStandardDeck());
  const handSize = players.length <= 4 ? 7 : 5;

  let cursor = 0;
  const gamePlayers = players.map((p) => {
    const hand = deck.slice(cursor, cursor + handSize);
    cursor += handSize;
    return { id: p.id, name: p.name, hand, finished: false, isBot: p.isBot || false };
  });

  const topCard = deck[cursor];
  cursor += 1;
  const stock = deck.slice(cursor);

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: players[0].id,
    stock,
    discard: [topCard],
    activeSuit: topCard.suit,
    winnerId: null,
    lastMove: null,
    log: [
      { ts: Date.now(), message: 'La partie commence !' },
      { ts: Date.now(), message: `Carte de départ : ${topCard.rank}${suitInfo(topCard.suit).symbol}.` }
    ]
  };
}

/**
 * Pose une carte (un seul à la fois, contrairement au Trou du Cul). `chosenSuit`
 * est obligatoire uniquement si `cardId` désigne un 8 — c'est la nouvelle
 * couleur demandée pour le prochain joueur.
 */
export function applyPlay(state, playerId, cardId, chosenSuit) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card) throw new Error("Cette carte n'est pas dans ta main.");
  if (!isLegalCard(state, card)) throw new Error('Coup invalide.');
  if (card.rank === '8' && !SUIT_KEYS.includes(chosenSuit)) {
    throw new Error('Choisis une couleur pour ton 8.');
  }

  current.hand = current.hand.filter((c) => c.id !== cardId);
  const finishedNow = current.hand.length === 0;
  if (finishedNow) current.finished = true;

  const discard = [...state.discard, card];
  const activeSuit = card.rank === '8' ? chosenSuit : card.suit;

  const logMessage = `${current.name} pose ${card.rank}${suitInfo(card.suit).symbol}${
    card.rank === '8' ? ` et choisit ${suitInfo(chosenSuit).symbol}` : ''
  }${finishedNow ? ` — ${current.name} a gagné !` : ''}`;

  return {
    ...state,
    players,
    discard,
    activeSuit,
    status: finishedNow ? 'finished' : 'playing',
    winnerId: finishedNow ? current.id : state.winnerId,
    currentPlayerId: finishedNow ? null : nextPlayerId(state.turnOrder, current.id),
    lastMove: { id: uniqueId(), by: current.id, type: 'play', card, chosenSuit: card.rank === '8' ? chosenSuit : null, finished: finishedNow },
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };
}

/**
 * Pioche une carte (uniquement permis si aucune carte en main n'est jouable) et
 * passe la main — pas de "rejouer immédiatement la carte piochée" dans cette
 * version, pour rester simple : elle attendra le prochain tour. Repioche
 * automatique en mélangeant la défausse (sauf la carte du dessus) si la pioche
 * est vide.
 */
export function applyDraw(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);

  if (hasLegalMove(state, current.hand)) {
    throw new Error('Tu as un coup possible : impossible de piocher.');
  }

  let stock = state.stock.slice();
  let discard = state.discard.slice();
  if (stock.length === 0) {
    if (discard.length <= 1) throw new Error('Plus aucune carte à piocher.');
    const top = discard[discard.length - 1];
    stock = shuffle(discard.slice(0, -1));
    discard = [top];
  }

  const [drawnCard, ...restStock] = stock;
  current.hand.push(drawnCard);

  return {
    ...state,
    players,
    stock: restStock,
    discard,
    currentPlayerId: nextPlayerId(state.turnOrder, current.id),
    lastMove: { id: uniqueId(), by: current.id, type: 'draw', card: null, chosenSuit: null, finished: false },
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche une carte.` }].slice(-40)
  };
}
