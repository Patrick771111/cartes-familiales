import { buildStandardDeck, shuffle, suitInfo } from './deck.js';
import { updateRoomState } from './core.js';

export const meta = { id: 'americain', label: 'Le 8 américain', hint: '2 à 6 joueurs', minPlayers: 2 };

const SUIT_KEYS = ['S', 'H', 'D', 'C'];

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Prochain joueur dans l'ordre du tour (tous les joueurs restent "actifs" jusqu'à la victoire, pas de sortie en cours de partie). `direction` = 1 (sens normal) ou -1 (inversé par un Valet). */
function nextPlayerId(turnOrder, fromId, direction = 1) {
  const idx = turnOrder.indexOf(fromId);
  const len = turnOrder.length;
  return turnOrder[(idx + direction + len) % len];
}

/** Tire `count` cartes du sabot, en le reformant depuis la défausse (sauf sa carte du dessus) si besoin. */
function drawFromStock(stock, discard, count) {
  let currentStock = stock.slice();
  let currentDiscard = discard.slice();
  const cards = [];
  for (let i = 0; i < count; i++) {
    if (currentStock.length === 0) {
      if (currentDiscard.length <= 1) break; // plus aucune carte disponible nulle part : on s'arrête là
      const top = currentDiscard[currentDiscard.length - 1];
      currentStock = shuffle(currentDiscard.slice(0, -1));
      currentDiscard = [top];
    }
    cards.push(currentStock.shift());
  }
  return { cards, stock: currentStock, discard: currentDiscard };
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
 * De même si elle est un Valet/2/As : son effet spécial ne s'applique pas à la
 * toute première carte, seulement à celles jouées ensuite.
 *
 * Règles spéciales (en plus du 8, voir `isLegalCard`) — appliquées dans
 * `applyPlay`, uniquement si la carte jouée n'est pas la dernière de la main :
 * - **Valet** : inverse le sens du jeu.
 * - **2** : le joueur suivant (dans le sens en cours) pioche 2 cartes et son
 *   tour est sauté.
 * - **As** : tu pioches une carte au hasard dans la main du joueur suivant
 *   (comme au Pouilleux) — son tour n'est en revanche pas sauté.
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

  // Ordre de jeu aléatoire, fixé pour toute la partie (pas l'ordre d'arrivée en salle).
  const turnOrder = shuffle(players.map((p) => p.id));

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
    direction: 1,
    stock,
    discard: [topCard],
    // Historique borné (4 dernières poses) des cartes défaussées, pour un
    // affichage empilé côté UI façon Trou du Cul — contrairement au pli du
    // Trou du Cul, la défausse ici ne se vide jamais en cours de partie, donc
    // on garde volontairement une fenêtre glissante plutôt que tout l'historique.
    discardHistory: [{ by: null, cards: [topCard] }],
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

  let discard = [...state.discard, card];
  const discardHistory = [...(state.discardHistory || []), { by: current.id, cards: [card] }].slice(-4);
  const activeSuit = card.rank === '8' ? chosenSuit : card.suit;

  let stock = state.stock.slice();
  let direction = state.direction || 1;
  let extraLog = '';

  if (card.rank === '8') {
    extraLog = ` et choisit ${suitInfo(chosenSuit).symbol}`;
  } else if (!finishedNow && card.rank === 'J') {
    direction = -direction;
    extraLog = " — le sens de jeu s'inverse !";
  }

  let nextId = finishedNow ? null : nextPlayerId(state.turnOrder, current.id, direction);

  if (!finishedNow && card.rank === '2' && nextId) {
    const victim = players.find((p) => p.id === nextId);
    const drawn = drawFromStock(stock, discard, 2);
    stock = drawn.stock;
    discard = drawn.discard;
    victim.hand = [...victim.hand, ...drawn.cards];
    extraLog = ` — ${victim.name} pioche ${drawn.cards.length} carte${drawn.cards.length > 1 ? 's' : ''} et passe son tour !`;
    nextId = nextPlayerId(state.turnOrder, nextId, direction);
  }

  if (!finishedNow && card.rank === 'A' && nextId) {
    const victim = players.find((p) => p.id === nextId);
    if (victim.hand.length > 0) {
      const stealIndex = Math.floor(Math.random() * victim.hand.length);
      const [stolen] = victim.hand.splice(stealIndex, 1);
      current.hand.push(stolen);
      extraLog = ` — ${current.name} pioche une carte dans la main de ${victim.name} !`;
    }
  }

  const logMessage = `${current.name} pose ${card.rank}${suitInfo(card.suit).symbol}${extraLog}${finishedNow ? ` — ${current.name} a gagné !` : ''}`;

  return {
    ...state,
    players,
    stock,
    discard,
    discardHistory,
    activeSuit,
    direction,
    status: finishedNow ? 'finished' : 'playing',
    winnerId: finishedNow ? current.id : state.winnerId,
    currentPlayerId: nextId,
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

  const drawn = drawFromStock(state.stock, state.discard, 1);
  if (!drawn.cards.length) throw new Error('Plus aucune carte à piocher.');
  current.hand.push(...drawn.cards);

  return {
    ...state,
    players,
    stock: drawn.stock,
    discard: drawn.discard,
    currentPlayerId: nextPlayerId(state.turnOrder, current.id, state.direction || 1),
    lastMove: { id: uniqueId(), by: current.id, type: 'draw', card: null, chosenSuit: null, finished: false },
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche une carte.` }].slice(-40)
  };
}

/** Pose une carte au 8 américain (`chosenSuit` uniquement pour un 8). */
export async function playAmericainCard(room, playerId, cardId, chosenSuit) {
  const newState = applyPlay(room.state, playerId, cardId, chosenSuit);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche une carte au 8 américain (uniquement si aucun coup possible). */
export async function drawAmericainCard(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}
