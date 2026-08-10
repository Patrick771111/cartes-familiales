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
 * - **+2** / **Joker +4** : au lieu de forcer immédiatement le joueur
 *   suivant à piocher, la pénalité s'accumule dans `pendingDraw` — le
 *   joueur suivant peut **empiler** une autre carte +2/+4 (n'importe
 *   laquelle des deux, y compris pour "riposter" à un +2 par un +4) pour
 *   faire grimper la pile et la refiler au joueur d'après, ou piocher toute
 *   la pile d'un coup (perdant alors son tour) — même s'il a une carte
 *   d'empilement en main, piocher reste toujours un choix valable. Tant que
 *   `pendingDraw > 0`, seules les cartes +2/+4 sont jouables (voir
 *   `isLegalCard`).
 * - **Joker** : choisis la nouvelle couleur en cours.
 * - **Joker +4** : choisis la nouvelle couleur en cours en plus de son
 *   effet d'empilement ci-dessus. *(Simplification : contrairement à la
 *   règle stricte du jeu physique, jouable à tout moment, même si tu as une
 *   carte de la couleur en cours — même simplification déjà en place pour
 *   le 8 du 8 américain de cette appli.)*
 *
 * **UNO / Contre-UNO** : un joueur qui vient de poser sa carte
 * avant-dernière (il ne lui en reste plus qu'une) doit le signaler
 * (`callUno`) — tant qu'il ne l'a pas fait, n'importe quel autre joueur
 * peut le "contre-signaler" (`catchUno`) pour lui infliger 2 cartes de
 * pénalité. La fenêtre se ferme dès qu'une action suivante a lieu (pose ou
 * pioche, par n'importe qui) : passé ce moment, plus rattrapable pour ce
 * tour-ci.
 */

export const COLORS = ['red', 'yellow', 'green', 'blue'];
const UNO_CATCH_PENALTY = 2;

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
 * au symbole/valeur de la carte au sommet de la défausse. Sous le coup
 * d'une pile de pioche en attente (`pendingDraw > 0`), seules les cartes
 * +2/+4 comptent comme jouables — n'importe laquelle des deux, sans
 * condition de couleur, pour riposter/empiler.
 */
export function isLegalCard(state, card) {
  if (state.pendingDraw > 0) {
    return card.kind === 'drawTwo' || card.kind === 'wildDrawFour';
  }
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
    pendingDraw: 0,
    // Id du joueur actuellement "exposé" (1 carte, pas encore signalé UNO),
    // ou null. Voir applyCallUno/applyCatchUno.
    unoWindowOpenFor: null,
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

  const stock = state.stock.slice();
  let direction = state.direction || 1;
  let pendingDraw = state.pendingDraw || 0;
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

  // +2 et Joker +4 : n'empilent que la pile en attente, ne forcent plus la
  // pioche immédiate — c'est au joueur suivant (nextId) de choisir entre
  // empiler à son tour ou piocher toute la pile (voir applyDraw).
  if (!finishedNow && card.kind === 'drawTwo') {
    pendingDraw += 2;
    extraLog += ` — pile de pioche à ${pendingDraw} !`;
  }
  if (!finishedNow && card.kind === 'wildDrawFour') {
    pendingDraw += 4;
    extraLog += ` — pile de pioche à ${pendingDraw} !`;
  }

  const cardLabel = card.kind === 'number' ? String(card.value) : card.kind;
  const logMessage = `${current.name} pose ${cardLabel}${card.color ? ` (${colorInfo(card.color).label})` : ''}${extraLog}${finishedNow ? ` — ${current.name} a gagné !` : ''}`;

  // Fenêtre de rattrapage UNO : toute action (celle-ci) ferme celle
  // éventuellement ouverte par une pose précédente — puis s'en rouvre une
  // nouvelle si ce coup laisse le joueur à exactement 1 carte.
  const unoWindowOpenFor = !finishedNow && current.hand.length === 1 ? current.id : null;

  return {
    ...state,
    players,
    stock,
    discard,
    discardHistory,
    activeColor,
    direction,
    pendingDraw,
    unoWindowOpenFor,
    status: finishedNow ? 'finished' : 'playing',
    winnerId: finishedNow ? current.id : state.winnerId,
    currentPlayerId: nextId,
    lastMove: { id: uniqueId(), by: current.id, type: 'play', card, chosenColor: isWild ? chosenColor : null, finished: finishedNow },
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };
}

/**
 * Pioche. Deux cas très différents :
 * - `pendingDraw > 0` (sous le coup d'une pile de +2/+4 en attente) :
 *   toujours permis, même avec une carte d'empilement en main (piocher
 *   plutôt qu'empiler est un choix valable) — pioche la pile entière d'un
 *   coup, qui se vide, et le tour passe.
 * - Sinon, pioche normale d'une seule carte, uniquement permise si aucune
 *   carte en main n'est jouable — pas de "rejouer immédiatement la carte
 *   piochée" dans cette version, pour rester simple.
 */
export function applyDraw(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);

  if (state.pendingDraw > 0) {
    const count = state.pendingDraw;
    const drawn = drawFromStock(state.stock, state.discard, count);
    current.hand.push(...drawn.cards);
    return {
      ...state,
      players,
      stock: drawn.stock,
      discard: drawn.discard,
      pendingDraw: 0,
      unoWindowOpenFor: null,
      currentPlayerId: nextPlayerId(state.turnOrder, current.id, state.direction || 1),
      lastMove: { id: uniqueId(), by: current.id, type: 'draw', card: null, chosenColor: null, finished: false },
      log: [...state.log, { ts: Date.now(), message: `${current.name} pioche ${count} carte${count > 1 ? 's' : ''} (pile) et passe son tour.` }].slice(-40)
    };
  }

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
    unoWindowOpenFor: null,
    currentPlayerId: nextPlayerId(state.turnOrder, current.id, state.direction || 1),
    lastMove: { id: uniqueId(), by: current.id, type: 'draw', card: null, chosenColor: null, finished: false },
    log: [...state.log, { ts: Date.now(), message: `${current.name} pioche une carte.` }].slice(-40)
  };
}

/** Un joueur à 1 carte se signale ("UNO !") avant d'être pris en défaut. */
export function applyCallUno(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.unoWindowOpenFor !== playerId) throw new Error('Rien à signaler pour le moment.');
  const player = state.players.find((p) => p.id === playerId);
  return {
    ...state,
    unoWindowOpenFor: null,
    log: [...state.log, { ts: Date.now(), message: `${player?.name || '?'} annonce UNO !` }].slice(-40)
  };
}

/** Un autre joueur contre-signale un joueur à 1 carte qui ne s'est pas annoncé à temps : +2 cartes de pénalité. */
export function applyCatchUno(state, playerId, targetPlayerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (playerId === targetPlayerId) throw new Error('Tu ne peux pas te contre-signaler toi-même.');
  if (state.unoWindowOpenFor !== targetPlayerId) throw new Error('Rien à signaler pour ce joueur.');

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const catcher = players.find((p) => p.id === playerId);
  const target = players.find((p) => p.id === targetPlayerId);
  if (!catcher || !target) throw new Error('Joueur introuvable.');

  const drawn = drawFromStock(state.stock, state.discard, UNO_CATCH_PENALTY);
  target.hand.push(...drawn.cards);

  return {
    ...state,
    players,
    stock: drawn.stock,
    discard: drawn.discard,
    unoWindowOpenFor: null,
    log: [...state.log, { ts: Date.now(), message: `${catcher.name} contre-signale ${target.name} : +${UNO_CATCH_PENALTY} cartes de pénalité !` }].slice(-40)
  };
}

/** Pose une carte à Uno (`chosenColor` uniquement pour un Joker/Joker +4). */
export async function playUnoCard(room, playerId, cardId, chosenColor) {
  const newState = applyPlay(room.state, playerId, cardId, chosenColor);
  return updateRoomState(room.id, room.version, newState);
}

/** Pioche à Uno — la pile en attente si elle existe, sinon une carte simple. */
export async function drawUnoCard(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Se signale "UNO !" à 1 carte, avant d'être pris en défaut. */
export async function callUno(room, playerId) {
  const newState = applyCallUno(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Contre-signale un autre joueur resté à 1 carte sans s'être annoncé. */
export async function catchUno(room, playerId, targetPlayerId) {
  const newState = applyCatchUno(room.state, playerId, targetPlayerId);
  return updateRoomState(room.id, room.version, newState);
}
