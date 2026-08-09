import { shuffle } from './deck.js';
import { commitGameAction } from './core.js';

export const meta = { id: 'trio', label: 'Trio', hint: '3 à 6 joueurs — mémoire et bluff, forme des trios de cartes', minPlayers: 3, maxPlayers: 6 };

/**
 * Trio (Kaya Miyano, Cocktail Games) — Mode Simple uniquement pour l'instant
 * (le mode Piquant nécessite les paires de numéros "liés" imprimées carte
 * par carte, données non disponibles ; le mode équipes n'est pas non plus
 * implémenté). 36 cartes numérotées 1 à 12, 3 exemplaires de chaque.
 *
 * Règles clés (vérifiées sur regledujeu.fr) :
 * - Chaque joueur reçoit des cartes qu'il trie face cachée du plus petit au
 *   plus grand ; seules les DEUX EXTRÉMITÉS (plus petit / plus grand numéro
 *   encore caché) sont accessibles, sur sa propre main ou celle d'un
 *   adversaire. Le reste part au centre, étalé face cachée (choix libre).
 * - À son tour, le joueur révèle des cartes une à une (centre au choix, ou
 *   extrémité d'une main) : il doit s'arrêter dès que 2 numéros diffèrent,
 *   sinon il continue jusqu'à 3 numéros identiques (trio gagné).
 * - Qu'il gagne un trio ou échoue, le tour passe ensuite au joueur suivant
 *   (jamais de rejeu immédiat).
 * - Victoire : 3 trios (n'importe lesquels) OU le trio de 7 seul suffit.
 */

const VALUES = Array.from({ length: 12 }, (_, i) => i + 1);
const COPIES_PER_VALUE = 3;
const DEAL_BY_PLAYER_COUNT = { 3: 9, 4: 7, 5: 6, 6: 5 };

function buildTiles() {
  const tiles = [];
  for (const v of VALUES) {
    for (let i = 0; i < COPIES_PER_VALUE; i++) tiles.push({ id: `${v}-${i}`, value: v });
  }
  return tiles; // 36 cartes
}

function nextPlayerId(turnOrder, fromId) {
  const idx = turnOrder.indexOf(fromId);
  return turnOrder[(idx + 1) % turnOrder.length];
}

/** Carte accessible à une extrémité de rangée (`'low'` ou `'high'`), ou `null` si vide de ce côté. */
function rowEndCard(row, end) {
  if (!row.length) return null;
  return end === 'low' ? row[0] : row[row.length - 1];
}

function noCardsLeft(state) {
  return state.center.every((c) => c.taken) && state.players.every((p) => p.row.length === 0);
}

export function initGame(players) {
  if (players.length < 3 || players.length > 6) {
    throw new Error('Trio se joue de 3 à 6 joueurs.');
  }
  const perPlayer = DEAL_BY_PLAYER_COUNT[players.length];
  const deck = shuffle(buildTiles());
  // Ordre de jeu aléatoire, fixé pour toute la partie (pas l'ordre d'arrivée en salle).
  const turnOrder = shuffle(players.map((p) => p.id));

  const resolvedPlayers = players.map((p) => {
    const row = deck.splice(0, perPlayer).sort((a, b) => a.value - b.value);
    return { id: p.id, name: p.name, isBot: Boolean(p.isBot), row, trios: [] };
  });

  // Le reste (deck déjà amputé des mains) forme le centre, étalé face cachée.
  const center = deck.map((t) => ({ ...t, taken: false }));

  return {
    status: 'playing',
    players: resolvedPlayers,
    center,
    turnOrder,
    currentPlayerId: turnOrder[0],
    // Cartes révélées dans la tentative en cours (visibles de tous, tant
    // qu'elles ne sont pas remises en place / gagnées via applyConfirmTurn).
    pendingReveals: [],
    // null tant que la tentative continue ; {type:'fail'} ou
    // {type:'success', trioValue, winnerId} une fois qu'elle est jouée,
    // en attente que le joueur actif confirme (`applyConfirmTurn`) pour que
    // tout le monde ait le temps de voir le résultat avant que ça disparaisse.
    turnOutcome: null,
    winnerId: null,
    log: [{ ts: Date.now(), message: 'Trio — à vous de jouer !' }]
  };
}

function resolveReveal(state, entry) {
  const pendingReveals = [...state.pendingReveals, entry];

  if (pendingReveals.length === 1) {
    return {
      ...state,
      pendingReveals,
      log: [...state.log, { ts: Date.now(), message: `Révèle un ${entry.value}.` }].slice(-40)
    };
  }

  const mismatch = pendingReveals.some((r) => r.value !== pendingReveals[0].value);
  if (mismatch) {
    return {
      ...state,
      pendingReveals,
      turnOutcome: { type: 'fail' },
      log: [
        ...state.log,
        { ts: Date.now(), message: `${pendingReveals.map((r) => r.value).join(' puis ')} — pas de correspondance, le tour s'arrête.` }
      ].slice(-40)
    };
  }

  if (pendingReveals.length === 2) {
    return {
      ...state,
      pendingReveals,
      log: [...state.log, { ts: Date.now(), message: `Deux ${pendingReveals[0].value} révélés — encore une carte à tenter !` }].slice(-40)
    };
  }

  return {
    ...state,
    pendingReveals,
    turnOutcome: { type: 'success', trioValue: pendingReveals[0].value, winnerId: state.currentPlayerId },
    log: [...state.log, { ts: Date.now(), message: `Trio de ${pendingReveals[0].value} !` }].slice(-40)
  };
}

/** Révèle une carte du centre, au choix (identifiée par son id). */
export function applyRevealCenter(state, playerId, cardId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (state.turnOutcome) throw new Error('Confirmez le résultat précédent avant de continuer.');
  if (state.pendingReveals.length >= 3) throw new Error('Trois cartes déjà révélées.');
  if (state.pendingReveals.some((r) => r.source.cardId === cardId)) {
    throw new Error('Cette carte est déjà révélée dans cette tentative.');
  }

  const card = state.center.find((c) => c.id === cardId && !c.taken);
  if (!card) throw new Error("Cette carte du centre n'est plus disponible.");

  return resolveReveal(state, { value: card.value, source: { type: 'center', cardId: card.id } });
}

/** Révèle l'extrémité (`'low'` ou `'high'`) de la main d'un joueur — la sienne ou celle d'un adversaire. */
export function applyRevealRow(state, playerId, targetPlayerId, end) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (state.turnOutcome) throw new Error('Confirmez le résultat précédent avant de continuer.');
  if (state.pendingReveals.length >= 3) throw new Error('Trois cartes déjà révélées.');
  if (end !== 'low' && end !== 'high') throw new Error('Extrémité invalide.');

  const target = state.players.find((p) => p.id === targetPlayerId);
  if (!target) throw new Error('Joueur introuvable.');
  const card = rowEndCard(target.row, end);
  if (!card) throw new Error("Cette main n'a plus de carte de ce côté.");
  if (state.pendingReveals.some((r) => r.source.cardId === card.id)) {
    throw new Error('Cette carte est déjà révélée dans cette tentative.');
  }

  return resolveReveal(state, { value: card.value, source: { type: 'row', playerId: targetPlayerId, end, cardId: card.id } });
}

/**
 * Confirme le résultat de la tentative en cours (bouton "Continuer" côté
 * joueur actif) : remet les cartes en place sur échec, ou les retire
 * définitivement (centre / rangées) et les attribue au gagnant sur succès.
 * Fait toujours passer le tour au joueur suivant (jamais de rejeu, même en
 * cas de trio réussi — vérifié sur regledujeu.fr).
 */
export function applyConfirmTurn(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas votre tour.");
  if (!state.turnOutcome) throw new Error('Rien à confirmer.');

  const { pendingReveals, turnOutcome } = state;

  if (turnOutcome.type === 'fail') {
    return {
      ...state,
      pendingReveals: [],
      turnOutcome: null,
      currentPlayerId: nextPlayerId(state.turnOrder, playerId),
      log: [...state.log, { ts: Date.now(), message: 'Cartes remises en place.' }].slice(-40)
    };
  }

  let center = state.center;
  const players = state.players.map((p) => ({ ...p, row: p.row.slice(), trios: p.trios.slice() }));

  for (const reveal of pendingReveals) {
    if (reveal.source.type === 'center') {
      center = center.map((c) => (c.id === reveal.source.cardId ? { ...c, taken: true } : c));
    } else {
      const target = players.find((p) => p.id === reveal.source.playerId);
      target.row = target.row.filter((c) => c.id !== reveal.source.cardId);
    }
  }

  const winner = players.find((p) => p.id === playerId);
  winner.trios.push(turnOutcome.trioValue);
  const hasWonGame = winner.trios.length >= 3 || turnOutcome.trioValue === 7;

  let newState = {
    ...state,
    center,
    players,
    pendingReveals: [],
    turnOutcome: null,
    currentPlayerId: nextPlayerId(state.turnOrder, playerId),
    log: [
      ...state.log,
      {
        ts: Date.now(),
        message: `${winner.name} remporte le trio de ${turnOutcome.trioValue}${turnOutcome.trioValue === 7 ? ' — trio de 7, victoire immédiate !' : ''}.`
      }
    ].slice(-40)
  };

  if (hasWonGame) {
    newState = {
      ...newState,
      status: 'finished',
      winnerId: playerId,
      log: [...newState.log, { ts: Date.now(), message: `${winner.name} gagne la partie !` }].slice(-40)
    };
  } else if (noCardsLeft(newState)) {
    // Cas limite non couvert par les règles officielles (n'arrive qu'avec
    // beaucoup de joueurs et une répartition très égale des trios) : plus
    // aucune carte nulle part sans que personne n'ait atteint 3 trios —
    // on termine sur le nombre de trios remportés plutôt que de rester
    // bloqué sans coup légal possible.
    const maxTrios = Math.max(...newState.players.map((p) => p.trios.length));
    const winners = newState.players.filter((p) => p.trios.length === maxTrios);
    newState = {
      ...newState,
      status: 'finished',
      winnerId: winners.length === 1 ? winners[0].id : null,
      log: [
        ...newState.log,
        {
          ts: Date.now(),
          message:
            winners.length === 1
              ? `Plus aucune carte disponible — ${winners[0].name} gagne avec le plus de trios.`
              : `Plus aucune carte disponible — égalité entre ${winners.map((w) => w.name).join(', ')}.`
        }
      ].slice(-40)
    };
  }

  return newState;
}

/** Trio — révèle une carte du centre (identifiée par son id). */
export async function revealTrioCenter(room, playerId, cardId) {
  return commitGameAction(room, (state) => applyRevealCenter(state, playerId, cardId));
}

/** Trio — révèle l'extrémité ('low'/'high') de la main d'un joueur (soi-même ou un adversaire). */
export async function revealTrioRow(room, playerId, targetPlayerId, end) {
  return commitGameAction(room, (state) => applyRevealRow(state, playerId, targetPlayerId, end));
}

/** Trio — confirme le résultat de la tentative en cours (remet en place, ou attribue le trio) et passe le tour. */
export async function confirmTrioTurn(room, playerId) {
  return commitGameAction(room, (state) => applyConfirmTurn(state, playerId));
}
