import { shuffle } from './deck.js';

/**
 * La Suite Infernale *(hypothèse : les infos publiques du jeu physique ne détaillent
 * pas le déroulé exact d'un tour ni l'effet précis de chacune des 45 cartes spéciales
 * — règles reconstituées ici de façon simplifiée et cohérente ; à ajuster dans ce
 * fichier si votre exemplaire diffère)*.
 *
 * But : être le premier à construire, dans sa suite personnelle, les nombres 1 à 10
 * dans l'ordre (1, puis 2, puis 3, ...). 65 cartes numéros (1 à 10) et 45 cartes
 * spéciales (attaques et perturbations) forment le paquet commun.
 */
export const SEQUENCE_TARGET = 10;
const STARTING_HAND_SIZE = 8;

export const SPECIAL_TYPES = {
  vol: { label: '🫳 Vol', description: "Vole la dernière carte de la suite d'un adversaire." },
  sabotage: { label: '💣 Sabotage', description: "Détruit la dernière carte de la suite d'un adversaire." },
  echange: { label: '🔀 Échange', description: 'Échange ta suite entière avec celle d\'un adversaire.' },
  piocheForcee: { label: '📥 Pioche forcée', description: 'Un adversaire pioche 2 cartes.' },
  rejoue: { label: '⚡ Rejoue', description: 'Tu piocheras et rejoueras aussitôt.' }
};

function buildDeck() {
  const cards = [];
  let cursor = 0;
  // 65 cartes numéros : un peu plus de petits numéros (tout le monde doit
  // démarrer par un 1) que de grands.
  const countFor = (n) => (n <= 5 ? 7 : 6);
  for (let n = 1; n <= 10; n++) {
    for (let i = 0; i < countFor(n); i++) {
      cards.push({ id: `num-${cursor++}`, kind: 'number', value: n });
    }
  }
  // 45 cartes spéciales : 9 de chaque type.
  for (const type of Object.keys(SPECIAL_TYPES)) {
    for (let i = 0; i < 9; i++) {
      cards.push({ id: `spec-${type}-${cursor++}`, kind: 'special', type });
    }
  }
  return shuffle(cards);
}

function drawOne(state) {
  let deck = state.deck.slice();
  let discard = state.discard;
  if (deck.length === 0) {
    if (state.discard.length === 0) return { deck, discard, card: null };
    deck = shuffle(state.discard);
    discard = [];
  }
  const card = deck.shift();
  return { deck, discard, card };
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

function specialLabel(type) {
  return SPECIAL_TYPES[type]?.label || type;
}

/**
 * `previousContext` (optionnel) : rien à conserver d'une partie à l'autre pour ce
 * jeu (contrairement au Blackjack/Flip7/Skyjo) — la victoire est immédiate et
 * définitive, `continueGame` (engine.js) relance donc toujours une suite neuve.
 */
export function initGame(players) {
  if (players.length < 2) {
    throw new Error('Il faut au moins 2 joueurs pour la Suite Infernale.');
  }

  const deck0 = buildDeck();
  let cursor = 0;
  const gamePlayers = players.map((p) => {
    const hand = deck0.slice(cursor, cursor + STARTING_HAND_SIZE);
    cursor += STARTING_HAND_SIZE;
    return { id: p.id, name: p.name, isBot: p.isBot || false, hand, sequence: [] };
  });

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: players[0].id,
    hasDrawnThisTurn: false,
    deck: deck0.slice(cursor),
    discard: [],
    winnerId: null,
    log: [{ ts: Date.now(), message: `${gamePlayers[0].name} commence, à 1 carte de sa suite !` }]
  };
}

export function applyDraw(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.hasDrawnThisTurn) throw new Error('Tu as déjà pioché ce tour-ci.');

  const { deck, discard, card } = drawOne(state);
  if (!card) {
    return { ...state, deck, discard, hasDrawnThisTurn: true, log: [...state.log, { ts: Date.now(), message: 'Plus aucune carte à piocher.' }].slice(-40) };
  }

  const players = state.players.map((p) => (p.id === playerId ? { ...p, hand: [...p.hand, card] } : p));
  return { ...state, players, deck, discard, hasDrawnThisTurn: true };
}

/** Joue une carte numéro : doit prolonger d'exactement 1 la suite personnelle du joueur. */
export function applyPlayNumber(state, playerId, cardId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice(), sequence: p.sequence.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card || card.kind !== 'number') throw new Error('Carte numéro invalide.');
  if (card.value !== current.sequence.length + 1) {
    throw new Error(`Il te faut le ${current.sequence.length + 1} pour continuer ta suite.`);
  }

  current.hand = current.hand.filter((c) => c.id !== cardId);
  current.sequence.push(card.value);

  const discard = [...state.discard, card];
  let logMessage = `${current.name} pose le ${card.value} (${current.sequence.length}/${SEQUENCE_TARGET}).`;
  let nextState = { ...state, players, discard, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) };

  if (current.sequence.length === SEQUENCE_TARGET) {
    nextState = {
      ...nextState,
      status: 'finished',
      winnerId: current.id,
      currentPlayerId: null,
      log: [...nextState.log, { ts: Date.now(), message: `🏆 ${current.name} termine sa suite et gagne !` }].slice(-40)
    };
    return nextState;
  }

  return endTurnAfterAction(nextState, playerId);
}

/** Joue une carte spéciale : effet immédiat sur soi ou sur `targetPlayerId`. */
export function applyPlaySpecial(state, playerId, cardId, targetPlayerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice(), sequence: p.sequence.slice() }));
  const current = players.find((p) => p.id === playerId);
  const card = current.hand.find((c) => c.id === cardId);
  if (!card || card.kind !== 'special') throw new Error('Carte spéciale invalide.');

  const needsTarget = card.type !== 'rejoue';
  const target = needsTarget ? players.find((p) => p.id === targetPlayerId) : null;
  if (needsTarget && (!target || target.id === current.id)) {
    throw new Error('Choisis un adversaire cible.');
  }

  current.hand = current.hand.filter((c) => c.id !== cardId);
  let discard = [...state.discard, card];
  let deck = state.deck;
  let logMessage = `${current.name} joue ${specialLabel(card.type)}`;
  let rejoue = false;

  switch (card.type) {
    case 'vol': {
      const stolen = target.sequence.pop();
      if (stolen != null) {
        current.hand.push({ id: `num-stolen-${stolen}-${Date.now()}`, kind: 'number', value: stolen });
        logMessage += ` et vole le ${stolen} de la suite de ${target.name}.`;
      } else {
        logMessage += ` mais la suite de ${target.name} est vide — sans effet.`;
      }
      break;
    }
    case 'sabotage': {
      const removed = target.sequence.pop();
      if (removed != null) {
        discard = [...discard, { id: `num-sabotaged-${removed}-${Date.now()}`, kind: 'number', value: removed }];
        logMessage += ` et détruit le ${removed} de la suite de ${target.name}.`;
      } else {
        logMessage += ` mais la suite de ${target.name} est vide — sans effet.`;
      }
      break;
    }
    case 'echange': {
      const mySeq = current.sequence;
      current.sequence = target.sequence;
      target.sequence = mySeq;
      logMessage += ` et échange sa suite avec celle de ${target.name}.`;
      break;
    }
    case 'piocheForcee': {
      for (let i = 0; i < 2; i++) {
        const drawn = drawOne({ deck, discard });
        deck = drawn.deck;
        discard = drawn.discard;
        if (drawn.card) target.hand.push(drawn.card);
      }
      logMessage += ` : ${target.name} pioche 2 cartes.`;
      break;
    }
    case 'rejoue': {
      rejoue = true;
      logMessage += ' et va rejouer aussitôt !';
      break;
    }
    default:
      throw new Error('Carte spéciale inconnue.');
  }

  let nextState = { ...state, players, deck, discard, log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40) };

  if (rejoue) {
    return { ...nextState, hasDrawnThisTurn: false };
  }
  return endTurnAfterAction(nextState, playerId);
}

/** Passe son tour sans jouer de carte (après avoir pioché). */
export function applyPass(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (!state.hasDrawnThisTurn) throw new Error("Pioche d'abord.");

  const current = state.players.find((p) => p.id === playerId);
  const nextState = { ...state, log: [...state.log, { ts: Date.now(), message: `${current.name} passe son tour.` }].slice(-40) };
  return endTurnAfterAction(nextState, playerId);
}

function endTurnAfterAction(state, playerId) {
  return { ...state, currentPlayerId: nextPlayerId(state.turnOrder, playerId), hasDrawnThisTurn: false };
}
