import { shuffle } from './deck.js';
import { updateRoomState } from './core.js';

export const meta = { id: 'suiteinfernale', label: 'La Suite Infernale', hint: '2 à 4 joueurs, construis ta suite de 1 à 10', minPlayers: 2 };

/**
 * La Suite Infernale, mode **individuel** (2 à 4 joueurs) — le mode équipe
 * (4 joueurs 2v2 ou 6 joueurs 3v3, avec sièges alternés et suites partagées
 * entre partenaires) n'est pas implémenté ici, pour rester dans le même
 * modèle "un joueur = un siège = un état" que les autres jeux de cette appli.
 *
 * But : être le premier à compléter, dans sa suite personnelle (`p.sequence`,
 * 10 cases pour les valeurs 1 à 10), tous les nombres de 1 à 10 posés face
 * visible. Chaque joueur a toujours 8 cartes en main. À son tour : piocher 1
 * carte, puis jouer une carte (ou la défausser si aucune ne convient).
 */
export const SEQUENCE_TARGET = 10;
const STARTING_HAND_SIZE = 8;

const NUMBER_COUNTS = { 1: 9, 2: 9, 3: 8, 4: 7, 5: 7, 6: 6, 7: 6, 8: 5, 9: 4, 10: 4 };

export const SPECIAL_TYPES = {
  jokerPlus1: { label: '🃏 Joker +1', description: 'Remplace un nombre au choix de ta suite (peut la démarrer).', count: 8 },
  jokerPlus2: { label: '🃏🃏 Joker +2', description: "Remplace 2 nombres d'affilée (jamais pour démarrer, ni sur le 9)." , count: 5 },
  retirerUne: { label: '🗑️ Retirer 1 carte', description: "Retire une carte au choix de la suite d'un adversaire.", count: 5 },
  retirerDeux: { label: '🗑️🗑️ Retirer 2 cartes', description: "Retire les 2 dernières cartes (consécutives) de la suite d'un adversaire.", count: 4 },
  rejouer: { label: '⚡ Rejouer 2 coups', description: 'Pioche 2 cartes et joue 2 fois de suite.', count: 4 },
  echangerJeu: { label: '🔀 Échanger les mains', description: 'Échange ta main entière avec un adversaire (les suites ne bougent pas).', count: 2 },
  volerDerniere: { label: '🫳 Voler la dernière', description: "Vole la dernière carte de la suite d'un adversaire.", count: 6 },
  volerUne: { label: '🫳 Voler une carte', description: "Vole une carte au choix de la suite d'un adversaire.", count: 5 },
  changerPlace: { label: '💺 Changer de place', description: "Échange ta place (ordre de jeu) ET ta suite avec un adversaire — vous gardez chacun votre main.", count: 2 },
  stop: { label: '🛑 STOP', description: "Contre l'attaque d'un adversaire dirigée contre toi.", count: 4 }
};

// Cartes dont l'effet cible un adversaire précis, et qui peuvent donc être
// contrées par un STOP de la personne visée (une fois jouées, l'effet reste
// en attente le temps que la cible réponde — voir `pendingAttack`).
const TARGETED_TYPES = ['retirerUne', 'retirerDeux', 'volerDerniere', 'volerUne', 'echangerJeu', 'changerPlace'];

function buildDeck() {
  const cards = [];
  let cursor = 0;
  for (const [value, count] of Object.entries(NUMBER_COUNTS)) {
    for (let i = 0; i < count; i++) cards.push({ id: `num-${cursor++}`, kind: 'number', value: Number(value) });
  }
  for (const [type, info] of Object.entries(SPECIAL_TYPES)) {
    for (let i = 0; i < info.count; i++) cards.push({ id: `spec-${type}-${cursor++}`, kind: 'special', type });
  }
  return shuffle(cards);
}

function drawOne({ deck, discard }) {
  let d = deck.slice();
  let disc = discard;
  if (d.length === 0) {
    if (discard.length === 0) return { deck: d, discard: disc, card: null };
    d = shuffle(discard);
    disc = [];
  }
  const card = d.shift();
  return { deck: d, discard: disc, card };
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function swapPositions(turnOrder, idA, idB) {
  const order = turnOrder.slice();
  const iA = order.indexOf(idA);
  const iB = order.indexOf(idB);
  [order[iA], order[iB]] = [order[iB], order[iA]];
  return order;
}

/** Index (0-based) de la première case vide de la suite, ou -1 si elle est complète. */
function nextEmptyIndex(sequence) {
  return sequence.findIndex((c) => !c);
}

/** Index (0-based) de la case remplie la plus haute, ou -1 si la suite est vide. */
function highestFilledIndex(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i]) return i;
  }
  return -1;
}

function endPlayAfterAction(state, playerId) {
  const remaining = (state.playsRemaining ?? 1) - 1;
  if (remaining > 0) {
    return { ...state, playsRemaining: remaining };
  }
  return {
    ...state,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    hasDrawnThisTurn: false,
    playsRemaining: 1
  };
}

export function initGame(players) {
  if (players.length < 2 || players.length > 4) {
    throw new Error('La Suite Infernale (mode individuel) se joue de 2 à 4 joueurs.');
  }

  const deck0 = buildDeck();
  let cursor = 0;
  const gamePlayers = players.map((p) => {
    const hand = deck0.slice(cursor, cursor + STARTING_HAND_SIZE);
    cursor += STARTING_HAND_SIZE;
    return { id: p.id, name: p.name, isBot: p.isBot || false, hand, sequence: Array(SEQUENCE_TARGET).fill(null) };
  });

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: players[0].id,
    hasDrawnThisTurn: false,
    playsRemaining: 1,
    pendingAttack: null,
    deck: deck0.slice(cursor),
    discard: [],
    winnerId: null,
    log: [{ ts: Date.now(), message: `${gamePlayers[0].name} commence, à toi de piocher !` }]
  };
}

/** Pioche 1 carte (obligatoire en début de tour, une seule fois). */
export function applyDraw(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.pendingAttack) throw new Error("Une réponse à une attaque est en attente.");
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.hasDrawnThisTurn) throw new Error('Tu as déjà pioché ce tour-ci.');

  const { deck, discard, card } = drawOne(state);
  if (!card) {
    return { ...state, deck, discard, hasDrawnThisTurn: true, playsRemaining: 1 };
  }
  const players = state.players.map((p) => (p.id === playerId ? { ...p, hand: [...p.hand, card] } : p));
  return { ...state, players, deck, discard, hasDrawnThisTurn: true, playsRemaining: 1 };
}

/** Joue une carte numéro, Joker +1 ou Joker +2 dans sa propre suite. */
export function applyPlaySequenceCard(state, playerId, cardId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.pendingAttack) throw new Error('Une réponse à une attaque est en attente.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice(), sequence: p.sequence.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card) throw new Error('Carte introuvable.');

  const neededIndex = nextEmptyIndex(current.sequence);
  if (neededIndex === -1) throw new Error('Ta suite est déjà complète.');
  const filledCount = current.sequence.filter(Boolean).length;

  if (card.kind === 'number') {
    if (card.value !== neededIndex + 1) throw new Error(`Il te faut le ${neededIndex + 1} pour continuer ta suite.`);
    current.sequence[neededIndex] = card;
  } else if (card.kind === 'special' && card.type === 'jokerPlus1') {
    current.sequence[neededIndex] = card;
  } else if (card.kind === 'special' && card.type === 'jokerPlus2') {
    if (filledCount === 0) throw new Error('Le Joker +2 ne peut pas démarrer une suite.');
    if (neededIndex + 1 >= SEQUENCE_TARGET - 1) throw new Error('Le Joker +2 ne peut plus être joué à ce stade de ta suite.');
    current.sequence[neededIndex] = card;
    current.sequence[neededIndex + 1] = card;
  } else {
    throw new Error('Cette carte ne peut pas être posée dans ta suite.');
  }

  current.hand = current.hand.filter((c) => c.id !== cardId);
  const discard = [...state.discard, card];
  const logMessage = `${current.name} pose ${card.kind === 'number' ? `le ${card.value}` : SPECIAL_TYPES[card.type].label} (${current.sequence.filter(Boolean).length}/${SEQUENCE_TARGET}).`;
  const nextState = { ...state, players, discard, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) };

  if (current.sequence.every(Boolean)) {
    return {
      ...nextState,
      status: 'finished',
      winnerId: current.id,
      currentPlayerId: null,
      log: [...nextState.log, { ts: Date.now(), message: `🏆 ${current.name} termine sa suite et gagne !` }].slice(-40)
    };
  }

  return endPlayAfterAction(nextState, playerId);
}

/** Joue "Rejouer 2 coups" : pioche 2 cartes et accorde 2 actions supplémentaires ce tour-ci. */
export function applyPlayRejouer(state, playerId, cardId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.pendingAttack) throw new Error('Une réponse à une attaque est en attente.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId && c.kind === 'special' && c.type === 'rejouer');
  if (!card) throw new Error('Carte invalide.');

  current.hand = current.hand.filter((c) => c.id !== cardId);
  let deck = state.deck;
  let discard = [...state.discard, card];
  for (let i = 0; i < 2; i++) {
    const drawn = drawOne({ deck, discard });
    deck = drawn.deck;
    discard = drawn.discard;
    if (drawn.card) current.hand.push(drawn.card);
  }

  const playsRemaining = (state.playsRemaining ?? 1) - 1 + 2;
  return {
    ...state,
    players,
    deck,
    discard,
    playsRemaining,
    log: [...state.log, { ts: Date.now(), message: `${current.name} joue Rejouer 2 coups : pioche 2 cartes et va rejouer aussitôt !` }].slice(-40)
  };
}

/**
 * Joue une carte ciblant un adversaire (les 6 types de `TARGETED_TYPES`).
 * L'effet n'est **pas** résolu tout de suite : il reste en attente
 * (`state.pendingAttack`) le temps que la cible réponde via
 * `applyRespondToAttack` (bloque avec un STOP, ou laisse passer).
 * `slotIndex` (0-based) précise la carte de la suite adverse concernée,
 * pour `retirerUne` et `volerUne` uniquement.
 */
export function applyPlayAttack(state, playerId, cardId, targetPlayerId, slotIndex = null) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.pendingAttack) throw new Error('Une réponse à une attaque est en attente.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card || card.kind !== 'special' || !TARGETED_TYPES.includes(card.type)) throw new Error('Carte invalide.');

  const target = players.find((p) => p.id === targetPlayerId);
  if (!target || target.id === playerId) throw new Error('Choisis un adversaire cible.');

  if (card.type === 'retirerUne' || card.type === 'volerUne') {
    if (slotIndex == null || !target.sequence[slotIndex]) {
      throw new Error("Choisis une carte de la suite adverse.");
    }
  }
  if (card.type === 'retirerDeux') {
    const h = highestFilledIndex(target.sequence);
    if (h < 1 || !target.sequence[h] || !target.sequence[h - 1]) {
      throw new Error("Il faut 2 dernières cartes consécutives dans la suite adverse.");
    }
  }
  if (card.type === 'volerDerniere') {
    if (highestFilledIndex(target.sequence) === -1) throw new Error('La suite adverse est vide.');
  }

  current.hand = current.hand.filter((c) => c.id !== cardId);
  const discard = [...state.discard, card];
  const pendingAttack = { type: card.type, byId: playerId, targetId: targetPlayerId, slotIndex };

  return {
    ...state,
    players,
    discard,
    pendingAttack,
    log: [...state.log, { ts: Date.now(), message: `${current.name} tente ${SPECIAL_TYPES[card.type].label} sur ${target.name}...` }].slice(-40)
  };
}

function resolveAttackEffect(players, discardIn, attack) {
  const attacker = players.find((p) => p.id === attack.byId);
  const target = players.find((p) => p.id === attack.targetId);
  let discard = discardIn;
  let message = '';

  switch (attack.type) {
    case 'retirerUne': {
      const removed = target.sequence[attack.slotIndex];
      // Un Joker +2 occupe 2 cases avec la même carte physique : le retirer libère les deux.
      target.sequence = target.sequence.map((c) => (c && removed && c.id === removed.id ? null : c));
      discard = [...discard, removed];
      message = `${attacker.name} retire une carte de la suite de ${target.name}.`;
      break;
    }
    case 'retirerDeux': {
      const h = highestFilledIndex(target.sequence);
      const removed = [target.sequence[h], target.sequence[h - 1]];
      target.sequence[h] = null;
      target.sequence[h - 1] = null;
      discard = [...discard, ...removed];
      message = `${attacker.name} retire les 2 dernières cartes de la suite de ${target.name}.`;
      break;
    }
    case 'volerDerniere': {
      const h = highestFilledIndex(target.sequence);
      const card = target.sequence[h];
      // Un Joker +2 occupe 2 cases avec la même carte physique (voir
      // `retirerUne` ci-dessus) : le voler libère les deux, pas seulement
      // celle visée — la suite recule alors de 2 cases, pas d'une.
      target.sequence = target.sequence.map((c) => (c && card && c.id === card.id ? null : c));
      attacker.hand.push(card);
      message = `${attacker.name} vole la dernière carte de la suite de ${target.name}.`;
      break;
    }
    case 'volerUne': {
      const card = target.sequence[attack.slotIndex];
      target.sequence = target.sequence.map((c) => (c && card && c.id === card.id ? null : c));
      attacker.hand.push(card);
      message = `${attacker.name} vole une carte de la suite de ${target.name}.`;
      break;
    }
    case 'echangerJeu': {
      const tmp = attacker.hand;
      attacker.hand = target.hand;
      target.hand = tmp;
      message = `${attacker.name} échange sa main avec ${target.name}.`;
      break;
    }
    case 'changerPlace': {
      // Change de place ET de suite (chacun garde sa propre main) : la suite
      // reste attachée à la place occupée à la table, pas au joueur.
      const tmpSeq = attacker.sequence;
      attacker.sequence = target.sequence;
      target.sequence = tmpSeq;
      message = `${attacker.name} échange sa place (et sa suite) avec ${target.name}.`;
      break;
    }
    default:
      throw new Error('Attaque inconnue.');
  }

  return { discard, message };
}

/**
 * Réponse de la cible à une attaque en attente : `block: true` (avec
 * `stopCardId`, une carte STOP de sa main) l'annule ; `block: false` la laisse
 * se résoudre normalement. Dans les deux cas, l'action de l'attaquant est
 * alors définitivement consommée (fin de tour, ou action suivante s'il avait
 * des actions en réserve grâce à "Rejouer").
 */
export function applyRespondToAttack(state, playerId, { block = false, stopCardId = null } = {}) {
  if (!state.pendingAttack) throw new Error('Aucune attaque en attente.');
  const attack = state.pendingAttack;
  if (attack.targetId !== playerId) throw new Error("Tu n'es pas visé par cette attaque.");

  let players = state.players.map((p) => ({ ...p, hand: p.hand.slice(), sequence: p.sequence.slice() }));
  let discard = state.discard;
  let deck = state.deck;
  let message;

  if (block) {
    const target = players.find((p) => p.id === playerId);
    const stopCard = target.hand.find((c) => c.id === stopCardId && c.kind === 'special' && c.type === 'stop');
    if (!stopCard) throw new Error("Tu n'as pas de carte STOP.");
    target.hand = target.hand.filter((c) => c.id !== stopCard.id);
    discard = [...discard, stopCard];
    const drawn = drawOne({ deck, discard });
    deck = drawn.deck;
    discard = drawn.discard;
    if (drawn.card) target.hand.push(drawn.card);
    message = `${target.name} bloque l'attaque avec un STOP !`;
  } else {
    const effect = resolveAttackEffect(players, discard, attack);
    discard = effect.discard;
    message = effect.message;
  }

  let turnOrder = state.turnOrder;
  if (!block && attack.type === 'changerPlace') {
    turnOrder = swapPositions(state.turnOrder, attack.byId, attack.targetId);
  }

  const nextState = {
    ...state,
    players,
    discard,
    deck,
    turnOrder,
    pendingAttack: null,
    log: [...state.log, { ts: Date.now(), message }].slice(-40)
  };

  return endPlayAfterAction(nextState, attack.byId);
}

/** Défausse une carte de sa main quand aucune des cartes en main ne convient (ou par choix). */
export function applyDiscard(state, playerId, cardId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.pendingAttack) throw new Error('Une réponse à une attaque est en attente.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card) throw new Error('Carte introuvable.');

  current.hand = current.hand.filter((c) => c.id !== cardId);
  const discard = [...state.discard, card];
  const nextState = { ...state, players, discard, log: [...state.log, { ts: Date.now(), message: `${current.name} défausse une carte.` }].slice(-40) };
  return endPlayAfterAction(nextState, playerId);
}

/** Pioche 1 carte à la Suite Infernale (obligatoire avant de jouer ou de défausser). */
export async function drawSuiteInfernale(room, playerId) {
  const newState = applyDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

/** Pose une carte numéro, Joker +1 ou Joker +2 à la Suite Infernale, dans sa propre suite. */
export async function playSuiteInfernaleSequenceCard(room, playerId, cardId) {
  const newState = applyPlaySequenceCard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

/** Joue "Rejouer 2 coups" à la Suite Infernale : pioche 2 cartes et rejoue aussitôt. */
export async function playSuiteInfernaleRejouer(room, playerId, cardId) {
  const newState = applyPlayRejouer(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

/**
 * Joue une carte ciblant un adversaire à la Suite Infernale (vol, sabotage,
 * échange de mains ou de place) — reste en attente d'une éventuelle réponse
 * STOP de la cible, voir `respondToSuiteInfernaleAttack`. `slotIndex`
 * uniquement pour "retirer 1 carte" / "voler 1 carte".
 */
export async function playSuiteInfernaleAttack(room, playerId, cardId, targetPlayerId, slotIndex = null) {
  const newState = applyPlayAttack(room.state, playerId, cardId, targetPlayerId, slotIndex);
  return updateRoomState(room.id, room.version, newState);
}

/** Réponse de la cible à une attaque en attente à la Suite Infernale : bloque avec un STOP, ou laisse passer. */
export async function respondToSuiteInfernaleAttack(room, playerId, { block = false, stopCardId = null } = {}) {
  const newState = applyRespondToAttack(room.state, playerId, { block, stopCardId });
  return updateRoomState(room.id, room.version, newState);
}

/** Défausse une carte de sa main à la Suite Infernale (quand aucune carte en main ne convient). */
export async function discardSuiteInfernale(room, playerId, cardId) {
  const newState = applyDiscard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}
