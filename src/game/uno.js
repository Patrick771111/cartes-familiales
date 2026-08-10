import { shuffle } from './deck.js';
import { updateRoomState } from './core.js';

export const meta = { id: 'uno', label: 'Uno', hint: '2 à 6 joueurs — pose une carte de même couleur ou de même symbole', minPlayers: 2, maxPlayers: 6 };

/**
 * Uno — adaptation numérique du jeu de cartes bien connu.
 *
 * 108 cartes : 4 couleurs (rouge/jaune/vert/bleu) × {un 0, deux de chaque
 * 1-9, deux Passer, deux Inverser, deux +2} + 4 Joker + 4 Joker +4.
 * 7 cartes en main au départ, quel que soit le nombre de joueurs (règle
 * officielle — contrairement au 8 américain de cette appli, qui ajuste sa
 * distribution selon l'effectif).
 *
 * À son tour : poser une carte de même couleur, même symbole/valeur que le
 * sommet de la défausse, ou un Joker/Joker +4 (toujours jouable). Sans
 * carte jouable, piocher une carte (pioche automatique si le sabot est
 * vide, en remélangeant la défausse sauf sa carte du dessus).
 *
 * Effets spéciaux, appliqués uniquement si la carte jouée n'est pas la
 * dernière de la main :
 * - **Passer** : le joueur suivant passe son tour.
 * - **Inverser** : inverse le sens de jeu — à 2 joueurs, équivaut à Passer
 *   (tu rejoues), règle officielle.
 * - **+2** : le joueur suivant pioche 2 cartes et passe son tour.
 * - **Joker** : choisis la nouvelle couleur en cours.
 * - **Joker +4** : choisis la nouvelle couleur en cours, le joueur suivant
 *   pioche 4 cartes et passe son tour. *(Simplification : contrairement à
 *   la règle stricte du jeu physique, jouable à tout moment, même si tu as
 *   une carte de la couleur en cours — même simplification déjà en place
 *   pour le 8 du 8 américain de cette appli.)*
 */

export const COLORS = ['red', 'yellow', 'green', 'blue'];

const COLOR_INFO = {
  red: { label: 'Rouge', hex: '#d0342c' },
  yellow: { label: 'Jaune', hex: '#f5c518' },
  green: { label: 'Vert', hex: '#2e9e3d' },
  blue: { label: 'Bleu', hex: '#1259a5' }
};

export function colorInfo(color) {
  return COLOR_INFO[color] || null;
}

function uniqueId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildUnoDeck() {
  const cards = [];
  let cursor = 0;
  for (const color of COLORS) {
    cards.push({ id: `uno-${cursor++}`, color, kind: 'number', value: 0 });
    for (let v = 1; v <= 9; v++) {
      cards.push({ id: `uno-${cursor++}`, color, kind: 'number', value: v });
      cards.push({ id: `uno-${cursor++}`, color, kind: 'number', value: v });
    }
    for (let i = 0; i < 2; i++) {
      cards.push({ id: `uno-${cursor++}`, color, kind: 'skip', value: null });
      cards.push({ id: `uno-${cursor++}`, color, kind: 'reverse', value: null });
      cards.push({ id: `uno-${cursor++}`, color, kind: 'drawTwo', value: null });
    }
  }
  for (let i = 0; i < 4; i++) cards.push({ id: `uno-${cursor++}`, color: null, kind: 'wild', value: null });
  for (let i = 0; i < 4; i++) cards.push({ id: `uno-${cursor++}`, color: null, kind: 'wildDrawFour', value: null });
  return cards; // 108 cartes
}

/** Prochain joueur dans l'ordre du tour. `direction` = 1 (sens normal) ou -1 (inversé). */
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
      if (currentDiscard.length <= 1) break; // plus aucune carte disponible nulle part
      const top = currentDiscard[currentDiscard.length - 1];
      currentStock = shuffle(currentDiscard.slice(0, -1));
      currentDiscard = [top];
    }
    cards.push(currentStock.shift());
  }
  return { cards, stock: currentStock, discard: currentDiscard };
}

/**
 * Une carte est jouable si c'est un Joker/Joker +4 (toujours autorisés), si
 * elle correspond à la couleur en cours, ou si elle correspond exactement
 * au symbole/valeur de la carte au sommet de la défausse.
 */
export function isLegalCard(state, card) {
  if (card.kind === 'wild' || card.kind === 'wildDrawFour') return true;
  if (card.color === state.activeColor) return true;
  const topCard = state.discard[state.discard.length - 1];
  if (card.kind === 'number' && topCard.kind === 'number') return card.value === topCard.value;
  return card.kind === topCard.kind && card.kind !== 'number';
}

export function hasLegalMove(state, hand) {
  return hand.some((card) => isLegalCard(state, card));
}

export function initGame(players) {
  if (players.length < 2 || players.length > 6) {
    throw new Error('Uno se joue de 2 à 6 joueurs.');
  }

  let deck = shuffle(buildUnoDeck());
  const handSize = 7;

  let cursor = 0;
  const gamePlayers = players.map((p) => {
    const hand = deck.slice(cursor, cursor + handSize);
    cursor += handSize;
    return { id: p.id, name: p.name, hand, finished: false, isBot: p.isBot || false };
  });

  // La 1ère carte retournée ne doit jamais être un Joker +4 (règle
  // officielle) : on remélange tant que c'est le cas.
  let topCard = deck[cursor];
  while (topCard && topCard.kind === 'wildDrawFour') {
    deck = shuffle(deck.slice(cursor));
    cursor = 0;
    topCard = deck[cursor];
  }
  cursor += 1;
  const stock = deck.slice(cursor);

  // Si la 1ère carte est un Joker simple (couleur nulle), une couleur de
  // départ est tirée au hasard — dans le jeu physique, ce serait au premier
  // joueur de la choisir, simplifié ici pour rester automatique.
  const activeColor = topCard.color || COLORS[Math.floor(Math.random() * COLORS.length)];

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
    // Historique borné (4 dernières poses), pour un affichage empilé côté UI.
    discardHistory: [{ by: null, cards: [topCard] }],
    activeColor,
    winnerId: null,
    lastMove: null,
    log: [
      { ts: Date.now(), message: 'La partie commence !' },
      { ts: Date.now(), message: `Couleur de départ : ${colorInfo(activeColor).label}.` }
    ]
  };
}

/** Pose une carte. `chosenColor` obligatoire uniquement pour un Joker/Joker +4. */
export function applyPlay(state, playerId, cardId, chosenColor) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card) throw new Error("Cette carte n'est pas dans ta main.");
  if (!isLegalCard(state, card)) throw new Error('Coup invalide.');
  const isWild = card.kind === 'wild' || card.kind === 'wildDrawFour';
  if (isWild && !COLORS.includes(chosenColor)) throw new Error('Choisis une couleur.');

  current.hand = current.hand.filter((c) => c.id !== cardId);
  const finishedNow = current.hand.length === 0;
  if (finishedNow) current.finished = true;

  let discard = [...state.discard, card];
  const discardHistory = [...(state.discardHistory || []), { by: current.id, cards: [card] }].slice(-4);
  const activeColor = isWild ? chosenColor : card.color;

  let stock = state.stock.slice();
  let direction = state.direction || 1;
  let extraLog = '';

  if (isWild) {
    extraLog = ` et choisit ${colorInfo(chosenColor).label}`;
  } else if (!finishedNow && card.kind === 'reverse') {
    direction = -direction;
    extraLog = " — le sens de jeu s'inverse !";
  }

  // À 2 joueurs, Inverser équivaut à Passer (le sens n'a mathématiquement
  // aucun effet avec un seul adversaire) : tu rejoues, règle officielle.
  let nextId;
  if (!finishedNow && card.kind === 'reverse' && state.turnOrder.length === 2) {
    nextId = current.id;
    extraLog = ' — à 2 joueurs, Inverser équivaut à Passer : tu rejoues !';
  } else {
    nextId = finishedNow ? null : nextPlayerId(state.turnOrder, current.id, direction);
  }

  if (!finishedNow && card.kind === 'skip' && nextId) {
    const skipped = players.find((p) => p.id === nextId);
    extraLog = ` — ${skipped.name} passe son tour !`;
    nextId = nextPlayerId(state.turnOrder, nextId, direction);
  }

  if (!finishedNow && card.kind === 'drawTwo' && nextId) {
    const victim = players.find((p) => p.id === nextId);
    const drawn = drawFromStock(stock, discard, 2);
    stock = drawn.stock;
    discard = drawn.discard;
    victim.hand = [...victim.hand, ...drawn.cards];
    extraLog = ` — ${victim.name} pioche ${drawn.cards.length} cartes et passe son tour !`;
    nextId = nextPlayerId(state.turnOrder, nextId, direction);
  }

  if (!finishedNow && card.kind === 'wildDrawFour' && nextId) {
    const victim = players.find((p) => p.id === nextId);
    const drawn = drawFromStock(stock, discard, 4);
    stock = drawn.stock;
    discard = drawn.discard;
    victim.hand = [...victim.hand, ...drawn.cards];
    extraLog += ` — ${victim.name} pioche ${drawn.cards.length} cartes et passe son tour !`;
    nextId = nextPlayerId(state.turnOrder, nextId, direction);
  }

  const cardLabel = card.kind === 'number' ? String(card.value) : card.kind;
  const logMessage = `${current.name} pose ${cardLabel}${card.color ? ` (${colorInfo(card.color).label})` : ''}${extraLog}${finishedNow ? ` — ${current.name} a gagné !` : ''}`;

  return {
    ...state,
    players,
    stock,
    discard,
    discardHistory,
    activeColor,
    direction,
    status: finishedNow ? 'finished' : 'playing',
    winnerId: finishedNow ? current.id : state.winnerId,
    currentPlayerId: nextId,
    lastMove: { id: uniqueId(), by: current.id, type: 'play', card, chosenColor: isWild ? chosenColor : null, finished: finishedNow },
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };
}

/**
 * Pioche une carte (uniquement permis si aucune carte en main n'est jouable)
 * et passe la main — pas de "rejouer immédiatement la carte piochée" dans
 * cette version, pour rester simple.
 */
export function applyDraw(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);

  if (hasLegalMove(state, current.hand)) {
    throw new Error('Tu as un coup possible : impossible de piocher.');
  }

  const drawn = drawFromStock(state.stock, state.discard, 1);
  if (!drawn.cards.length) throw new Error('Plus aucune carte à piocher.');
  current.hand.push(...drawn.cards);

  return {
    ...state,
    players,
    stock: drawn.stock,
    discard: drawn.discard,
    currentPlayerId: nextPlayerId(state.turnOrder, current.id, state.direction || 1),
    lastMove: { id: uniqueId(), by: current.id, type: 'draw', card: null, chosenColor: null, finished: false },
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche une carte.` }].slice(-40)
  };
}

/** Pose une carte à Uno (`chosenColor` uniquement pour un Joker/Joker +4). */
export async function playUnoCard(room, playerId, cardId, chosenColor) {
  const newState = applyPlay(room.state, playerId, cardId, chosenColor);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche une carte à Uno (uniquement si aucun coup possible). */
export async function drawUnoCard(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}
