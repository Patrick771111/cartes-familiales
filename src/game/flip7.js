import { shuffle } from './deck.js';
import { commitGameAction } from './core.js';

export const meta = { id: 'flip7', label: 'Flip 7', hint: '2 à 6 joueurs, score cumulé', minPlayers: 2 };

// Reconstitution du jeu physique Flip 7 à partir de mémoire — les décomptes
// exacts (nombre de cartes par valeur, bonus Flip 7, score cible) sont une
// approximation raisonnable *(hypothèse — à ajuster ici si votre exemplaire
// physique diffère)*. Chaque carte numéro N apparaît N fois dans le paquet
// (sauf le 0, une seule fois), plus 6 cartes bonus (+2/+4/+6/+8/+10/×2) et
// 9 cartes action (3× Freeze, 3× Flip Three, 3× Seconde Chance).
const NUMBER_COUNTS = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 11, 12: 12 };
const FLAT_MODIFIERS = [2, 4, 6, 8, 10];
export const FLIP7_BONUS = 15;
export const TARGET_SCORE = 200;

function buildDeck() {
  const cards = [];
  for (const [value, count] of Object.entries(NUMBER_COUNTS)) {
    for (let i = 0; i < count; i++) {
      cards.push({ id: `n${value}-${i}`, kind: 'number', value: Number(value) });
    }
  }
  FLAT_MODIFIERS.forEach((amount) => {
    cards.push({ id: `mod+${amount}`, kind: 'modifier', modType: 'flat', amount, label: `+${amount}` });
  });
  cards.push({ id: 'modx2', kind: 'modifier', modType: 'x2', amount: 0, label: '×2' });
  for (let i = 0; i < 3; i++) cards.push({ id: `freeze${i}`, kind: 'freeze', label: 'Freeze' });
  for (let i = 0; i < 3; i++) cards.push({ id: `flip3-${i}`, kind: 'flipThree', label: 'Flip Three' });
  for (let i = 0; i < 3; i++) cards.push({ id: `sc${i}`, kind: 'secondChance', label: '2e chance' });
  return cards;
}

/** Score d'une manche pour un joueur : 0 net s'il a sauté, sinon somme des numéros
 * (×2 si une carte ×2 est en jeu) + bonus fixes + bonus Flip 7. */
export function computeRoundScore(player) {
  if (player.status === 'busted') return 0;
  const numbers = player.display.filter((c) => c.kind === 'number');
  const numberSum = numbers.reduce((s, c) => s + c.value, 0);
  const flatBonus = player.display
    .filter((c) => c.kind === 'modifier' && c.modType === 'flat')
    .reduce((s, c) => s + c.amount, 0);
  const hasX2 = player.display.some((c) => c.kind === 'modifier' && c.modType === 'x2');
  return numberSum * (hasX2 ? 2 : 1) + flatBonus + (player.flip7 ? FLIP7_BONUS : 0);
}

/** Règle le score de manche d'un joueur dès qu'il a fini son tour (passé,
 * planté, ou Flip 7) — sans attendre que toute la table ait terminé, son
 * `display` ne bougera plus. Sans effet si déjà réglé (`roundScore` non nul). */
function settlePlayerScore(player) {
  if (player.roundScore !== null) return player;
  const roundScore = computeRoundScore(player);
  return { ...player, roundScore, score: player.score + roundScore };
}

function nextActivePlayerId(turnOrder, players, fromId) {
  const idx = turnOrder.indexOf(fromId);
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidateId = turnOrder[(idx + step) % turnOrder.length];
    const candidate = players.find((p) => p.id === candidateId);
    if (candidate && candidate.status === 'active') return candidateId;
  }
  return null;
}

/** Résout la manche : score de chacun ajouté au score cumulé, victoire de partie si quelqu'un atteint TARGET_SCORE. */
function finishRound(state, players, flip7PlayerId, logMessages) {
  // La plupart des joueurs sont déjà réglés au fil de la manche (voir
  // settlePlayerScore, appelé dès que chacun termine son tour) — il ne reste
  // ici qu'à régler ceux encore actifs quand un Flip 7 a clos la manche pour
  // tout le monde d'un coup.
  const resolvedPlayers = players.map(settlePlayerScore);

  const winners = resolvedPlayers.filter((p) => p.score >= TARGET_SCORE);
  const gameWinnerId = winners.length
    ? winners.reduce((best, p) => (p.score > best.score ? p : best), winners[0]).id
    : null;

  return {
    ...state,
    players: resolvedPlayers,
    status: 'finished',
    currentPlayerId: null,
    flip7PlayerId,
    gameWinnerId,
    log: [...state.log, ...logMessages.map((message) => ({ ts: Date.now(), message }))].slice(-40)
  };
}

/**
 * Crée l'état initial d'une manche : personne n'a encore de carte, chacun
 * démarre avec un affichage vide. `previousScores` (optionnel) = `{ [playerId]:
 * score }` de la manche précédente, fourni par `continueGame` (engine.js) pour
 * enchaîner sans repasser par le lobby — sinon tout le monde repart de 0.
 */
export function initGame(players, previousScores = null) {
  if (players.length < 2) {
    throw new Error('Il faut au moins 2 joueurs pour Flip 7.');
  }

  const deck = shuffle(buildDeck());

  const gamePlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot || false,
    display: [],
    hasSecondChance: false,
    status: 'active',
    flip7: false,
    roundScore: null,
    score: previousScores?.[p.id] ?? 0
  }));

  // Ordre de jeu aléatoire, fixé pour toute la partie (pas l'ordre d'arrivée en salle).
  const turnOrder = shuffle(players.map((p) => p.id));

  return {
    status: 'playing',
    players: gamePlayers,
    turnOrder,
    currentPlayerId: turnOrder[0],
    deck,
    discard: [],
    flip7PlayerId: null,
    gameWinnerId: null,
    log: [{ ts: Date.now(), message: 'Nouvelle manche : chacun flippe à son tour !' }]
  };
}

/**
 * Enchaîne une manche en reconduisant les scores cumulés — sauf si la PARTIE
 * (pas juste la manche) vient d'être gagnée, auquel cas on repart à 0.
 */
export function continueRound(room, playersList) {
  const previousScores = room.state.gameWinnerId
    ? null
    : Object.fromEntries(room.state.players.map((p) => [p.id, p.score]));
  return initGame(playersList, previousScores);
}

/**
 * Flippe une carte pour le joueur courant. Si elle déclenche un Flip Three, les
 * flips forcés qui suivent sont résolus automatiquement dans le même appel (le
 * joueur n'a aucun choix pendant cette séquence) — la main ne lui revient que
 * si aucun tirage forcé n'est plus en attente. Un Freeze arrête tout net, même
 * en pleine séquence forcée.
 */
export function applyHit(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, display: p.display.slice() }));
  const current = players.find((p) => p.id === playerId);

  let deck = state.deck.slice();
  let discard = state.discard.slice();
  const logMessages = [];
  let flip7PlayerId = state.flip7PlayerId;

  let remaining = 1; // le flip volontaire, puis potentiellement rallongé par un Flip Three
  while (remaining > 0 && current.status === 'active') {
    remaining -= 1;

    if (!deck.length) {
      if (!discard.length) break; // plus aucune carte nulle part (improbable)
      deck = shuffle(discard);
      discard = [];
    }
    const card = deck.shift();

    if (card.kind === 'secondChance') {
      if (current.hasSecondChance) {
        discard.push(card);
        logMessages.push(`${current.name} pioche une 2e chance en trop, défaussée.`);
      } else {
        current.hasSecondChance = true;
        current.display.push(card);
        logMessages.push(`${current.name} pioche une Seconde Chance.`);
      }
      continue;
    }

    if (card.kind === 'freeze') {
      current.display.push(card);
      current.status = 'stayed';
      Object.assign(current, settlePlayerScore(current));
      logMessages.push(`${current.name} pioche Freeze et s'arrête aussitôt.`);
      break;
    }

    if (card.kind === 'flipThree') {
      current.display.push(card);
      remaining += 3;
      logMessages.push(`${current.name} pioche Flip Three : 3 tirages forcés de plus !`);
      continue;
    }

    if (card.kind === 'modifier') {
      current.display.push(card);
      logMessages.push(`${current.name} pioche ${card.label}.`);
      continue;
    }

    // Carte numéro : doublon = perdu pour la manche (sauf Seconde Chance en réserve).
    const isDuplicate = current.display.some((c) => c.kind === 'number' && c.value === card.value);
    if (isDuplicate) {
      if (current.hasSecondChance) {
        current.hasSecondChance = false;
        discard.push(card);
        const scIndex = current.display.findIndex((c) => c.kind === 'secondChance');
        if (scIndex !== -1) discard.push(...current.display.splice(scIndex, 1));
        logMessages.push(`${current.name} pioche un ${card.value} en double, sauvé par sa Seconde Chance !`);
      } else {
        current.display.push(card);
        current.status = 'busted';
        Object.assign(current, settlePlayerScore(current));
        logMessages.push(`${current.name} pioche un ${card.value} en double — perdu pour cette manche !`);
        break;
      }
    } else {
      current.display.push(card);
      const uniqueNumbers = current.display.filter((c) => c.kind === 'number').length;
      if (uniqueNumbers === 7) {
        current.status = 'stayed';
        current.flip7 = true;
        flip7PlayerId = current.id;
        Object.assign(current, settlePlayerScore(current));
        logMessages.push(`${current.name} réalise un FLIP 7 !!`);
        break;
      }
    }
  }

  let nextState = { ...state, players, deck, discard };

  if (flip7PlayerId && flip7PlayerId !== state.flip7PlayerId) {
    // Un Flip 7 vient d'être réalisé : la manche s'arrête immédiatement pour tout le monde.
    return finishRound(nextState, players, flip7PlayerId, logMessages);
  }

  nextState.log = [...state.log, ...logMessages.map((message) => ({ ts: Date.now(), message }))].slice(-40);

  if (current.status === 'active') {
    // Il a encore le choix (tirage(s) réussi(s), aucun blocage) : la main lui reste.
    nextState.currentPlayerId = current.id;
    return nextState;
  }

  // Passé ou arrêté (Freeze compris) : on passe au prochain joueur encore actif.
  const nextId = nextActivePlayerId(state.turnOrder, players, current.id);
  if (!nextId) {
    return finishRound(nextState, players, state.flip7PlayerId, []);
  }
  nextState.currentPlayerId = nextId;
  return nextState;
}

export function applyStay(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => (p.id === playerId ? settlePlayerScore({ ...p, status: 'stayed' }) : p));
  const current = players.find((p) => p.id === playerId);

  const logMessage = { ts: Date.now(), message: `${current.name} reste sur ${current.display.filter((c) => c.kind === 'number').length} numéro(s).` };
  let nextState = { ...state, players, log: [...state.log, logMessage].slice(-40) };

  const nextId = nextActivePlayerId(state.turnOrder, players, playerId);
  if (!nextId) {
    return finishRound(nextState, players, state.flip7PlayerId, []);
  }
  nextState.currentPlayerId = nextId;
  return nextState;
}

/** Flippe une carte à Flip 7 (résout aussi, dans le même appel, tout Flip Three déclenché). */
export async function hitFlip7(room, playerId) {
  return commitGameAction(room, (state) => applyHit(state, playerId));
}

/** Reste sur sa main à Flip 7. */
export async function stayFlip7(room, playerId) {
  return commitGameAction(room, (state) => applyStay(state, playerId));
}
