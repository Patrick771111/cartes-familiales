import { buildStandardDeck, shuffle, deal } from './deck.js';

/**
 * Ordre des rangs pour le Trou du Cul (du plus faible au plus fort) : le 2 est la
 * carte la plus forte de tout le jeu. Différent de l'ordre "naturel" utilisé au Pouilleux.
 */
export const RANK_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];

// Règle "8 brûle" : poser un 8 vide immédiatement le pli en cours, et la main continue
// au même joueur (qui peut relancer sur n'importe quel rang). Le 2 fait de même,
// puisque c'est la carte la plus forte du jeu : personne ne peut de toute façon
// jamais le battre, autant vider le pli tout de suite plutôt que d'attendre que
// tout le monde passe.
const BURN_RANKS = new Set(['8', '2']);

// Jeu à 4 exactement : Président / Vice-Président / Secrétaire / Trou du Cul,
// avec échange forcé de cartes entre les deux extrêmes (2 cartes) et le binôme
// du milieu (1 carte) avant chaque donne.
export const REQUIRED_PLAYERS = 4;
const ROLE_LABELS = ['Président', 'Vice-Président', 'Secrétaire', 'Trou du Cul'];

export function rankValue(rank) {
  return RANK_ORDER.indexOf(rank);
}

export function rankLabel(rank) {
  return ROLE_LABELS[rank - 1] || `Rang ${rank}`;
}

function sortHand(hand) {
  return hand.slice().sort((a, b) => rankValue(a.rank) - rankValue(b.rank) || a.suit.localeCompare(b.suit));
}

function activePlayers(players) {
  return players.filter((p) => !p.finished);
}

function nextActivePlayerId(turnOrder, players, fromId) {
  const idx = turnOrder.indexOf(fromId);
  for (let step = 1; step <= turnOrder.length; step++) {
    const candidateId = turnOrder[(idx + step) % turnOrder.length];
    const candidate = players.find((p) => p.id === candidateId);
    if (candidate && !candidate.finished) return candidateId;
  }
  return null;
}

/**
 * Détermine l'ordre des rôles [Président, Vice-Président, Secrétaire, Trou du Cul]
 * pour cette manche : reprend le classement de la manche précédente si on en a un
 * et que les 4 mêmes joueurs sont toujours là, sinon tirage au sort (première manche).
 */
function assignRoleOrder(players, previousRanking) {
  const ids = players.map((p) => p.id);
  const previousValid =
    Array.isArray(previousRanking) &&
    previousRanking.length === REQUIRED_PLAYERS &&
    previousRanking.every((id) => ids.includes(id));

  return previousValid ? previousRanking : shuffle(ids);
}

/**
 * Déplace les `count` meilleures cartes de la main de `fromId` vers celle de
 * `toId` (don forcé, automatique — c'est la seule partie de l'échange qui ne
 * demande pas de choix). Retourne les cartes données, pour le journal.
 */
function takeBestCards(hands, fromId, toId, count) {
  const fromHand = sortHand(hands[fromId]);
  const given = fromHand.slice(fromHand.length - count);
  hands[fromId] = fromHand.slice(0, fromHand.length - count);
  hands[toId] = sortHand([...hands[toId], ...given]);
  return given;
}

/** Garde-fou : le compte total de cartes ne doit jamais dériver de 52 pendant la distribution/l'échange. */
function assertCardIntegrity(players, context) {
  const total = players.reduce((sum, p) => sum + p.hand.length, 0);
  if (total !== 52) {
    throw new Error(`Incohérence détectée (${context} : ${total}/52 cartes). Abandonne la partie et relance une manche.`);
  }
}

/**
 * Crée l'état initial d'une manche à 4 joueurs : rôles (aléatoires ou hérités du
 * classement précédent via `previousRanking`), distribution, puis don forcé
 * (Trou du Cul → Président, Secrétaire → Vice-Président). Le retour de cartes
 * n'est PAS automatique : c'est un choix privé du Président/Vice-Président,
 * fait via `applyExchangeChoice`. Personne d'autre ne voit les cartes précises
 * qui circulent — seul le fait qu'un don a eu lieu apparaît dans le journal.
 */
export function initGame(players, previousRanking = null) {
  if (players.length !== REQUIRED_PLAYERS) {
    throw new Error('Le Trou du Cul se joue à 4 joueurs exactement.');
  }

  const [presidentId, vicePresidentId, secretaireId, trouDuCulId] = assignRoleOrder(players, previousRanking);

  const deck = shuffle(buildStandardDeck());
  const hands = deal(deck, players.map((p) => p.id));

  const givenToPresident = takeBestCards(hands, trouDuCulId, presidentId, 2);
  const givenToVicePresident = takeBestCards(hands, secretaireId, vicePresidentId, 1);

  const roleById = {
    [presidentId]: 'Président',
    [vicePresidentId]: 'Vice-Président',
    [secretaireId]: 'Secrétaire',
    [trouDuCulId]: 'Trou du Cul'
  };

  const gamePlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: sortHand(hands[p.id]),
    finished: false,
    rank: null,
    role: roleById[p.id],
    isBot: p.isBot || false
  }));

  assertCardIntegrity(gamePlayers, 'après distribution et don forcé');

  const nameOf = (id) => players.find((p) => p.id === id)?.name || '?';

  return {
    status: 'exchange',
    players: gamePlayers,
    turnOrder: players.map((p) => p.id),
    currentPlayerId: null,
    pile: [],
    pileRank: null,
    pileCount: 0,
    rankLocked: false,
    // Historique complet des poses du pli en cours (une entrée par joueur qui a
    // posé depuis le dernier "pli neuf"), pour un affichage empilé côté UI — vidé
    // dès que le pli brûle ou est ramassé (voir applyPlay / applyPass).
    pileHistory: [],
    pileClearedId: null,
    lastPlayerToPlay: null,
    passedSinceLastPlay: [],
    finishedOrder: [],
    loserId: null,
    lastMove: null,
    lastPlayedByPlayer: {},
    exchange: {
      presidentId,
      vicePresidentId,
      secretaireId,
      trouDuCulId,
      presidentGiftCount: 2,
      vicePresidentGiftCount: 1,
      presidentGiven: false,
      vicePresidentGiven: false,
      // Ids des cartes reçues d'office (Trou du Cul → Président, Secrétaire →
      // Vice-Président), pour pouvoir les entourer dans l'UI pendant que le
      // Président/Vice-Président choisit ce qu'il rend en retour.
      receivedByPresident: givenToPresident.map((c) => c.id),
      receivedByVicePresident: givenToVicePresident.map((c) => c.id)
    },
    // Ids des cartes reçues en retour (Président → Trou du Cul, Vice-Président →
    // Secrétaire), pour les entourer dans la main du destinataire pendant le
    // tout premier pli de la manche. Rempli par applyExchangeChoice.
    returnGiftIds: {},
    firstTrickPending: false,
    log: [
      { ts: Date.now(), message: 'Nouvelle manche : les rôles sont distribués.' },
      { ts: Date.now(), message: `${nameOf(trouDuCulId)} (Trou du Cul) donne ses 2 meilleures cartes à ${nameOf(presidentId)} (Président).` },
      { ts: Date.now(), message: `${nameOf(secretaireId)} (Secrétaire) donne sa meilleure carte à ${nameOf(vicePresidentId)} (Vice-Président).` }
    ]
  };
}

/**
 * Le Président (2 cartes) ou le Vice-Président (1 carte) choisit ce qu'il rend
 * en retour. Dès que les deux retours ont eu lieu, la partie démarre vraiment
 * (le Trou du Cul entame le premier pli).
 */
export function applyExchangeChoice(state, playerId, cardIds) {
  if (state.status !== 'exchange') throw new Error("Ce n'est pas le moment de choisir.");
  const ex = state.exchange;

  let role;
  let expectedCount;
  let recipientId;
  if (playerId === ex.presidentId) {
    role = 'president';
    expectedCount = ex.presidentGiftCount;
    recipientId = ex.trouDuCulId;
  } else if (playerId === ex.vicePresidentId) {
    role = 'vicePresident';
    expectedCount = ex.vicePresidentGiftCount;
    recipientId = ex.secretaireId;
  } else {
    throw new Error("Tu n'as rien à donner pour cet échange.");
  }

  const alreadyGiven = role === 'president' ? ex.presidentGiven : ex.vicePresidentGiven;
  if (alreadyGiven) throw new Error('Tu as déjà fait ton choix pour cet échange.');

  if (!Array.isArray(cardIds) || cardIds.length !== expectedCount) {
    throw new Error(`Choisis exactement ${expectedCount} carte${expectedCount > 1 ? 's' : ''}.`);
  }

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const giver = players.find((p) => p.id === playerId);
  const recipient = players.find((p) => p.id === recipientId);

  const cards = cardIds.map((id) => giver.hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== expectedCount) throw new Error('Sélection invalide.');

  giver.hand = giver.hand.filter((c) => !cardIds.includes(c.id));
  recipient.hand = sortHand([...recipient.hand, ...cards]);

  assertCardIntegrity(players, `après retour d'échange (${role})`);

  const newExchange = {
    ...ex,
    presidentGiven: role === 'president' ? true : ex.presidentGiven,
    vicePresidentGiven: role === 'vicePresident' ? true : ex.vicePresidentGiven
  };

  const returnGiftIds = { ...state.returnGiftIds, [recipientId]: cards.map((c) => c.id) };

  const logMessage = { ts: Date.now(), message: `${giver.name} rend ${expectedCount} carte${expectedCount > 1 ? 's' : ''} à ${recipient.name}.` };

  const bothDone = newExchange.presidentGiven && newExchange.vicePresidentGiven;

  if (bothDone) {
    return {
      ...state,
      players,
      exchange: newExchange,
      returnGiftIds,
      firstTrickPending: true,
      status: 'playing',
      currentPlayerId: ex.trouDuCulId,
      log: [...state.log, logMessage, { ts: Date.now(), message: `${players.find((p) => p.id === ex.trouDuCulId)?.name} entame le premier pli.` }].slice(-40)
    };
  }

  return { ...state, players, exchange: newExchange, returnGiftIds, log: [...state.log, logMessage].slice(-40) };
}

function finishRoundIfNeeded(state, players) {
  const remaining = activePlayers(players);
  if (remaining.length > 1) return null;

  const finishedOrder = [...state.finishedOrder];
  if (remaining.length === 1) finishedOrder.push(remaining[0].id);

  const withRanks = players.map((p) => ({
    ...p,
    rank: finishedOrder.indexOf(p.id) + 1
  }));

  return {
    status: 'finished',
    players: withRanks,
    currentPlayerId: null,
    finishedOrder,
    loserId: finishedOrder[finishedOrder.length - 1] || null
  };
}

/**
 * Vérifie si un ensemble de cartes (même rang) peut être posé sur le pli courant :
 * même nombre de cartes, et un rang supérieur OU ÉGAL au pli (le pli est vide =
 * tout est permis). Si `state.rankLocked` est vrai, c'est que le joueur PRÉCÉDENT
 * vient de copier le rang du pli : ce tour-ci (un seul tour, pas plus), seul ce
 * rang exact reste jouable — impossible de relancer plus haut. Le verrou se lève
 * dès qu'un pass a lieu, ou si ce joueur copie à son tour (ce qui reverrouille
 * alors le joueur suivant, et ainsi de suite tant que la chaîne de copies continue).
 */
export function isLegalPlay(state, hand, cardIds) {
  if (!cardIds.length) return false;
  const cards = cardIds.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
  if (cards.length !== cardIds.length) return false;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return false;

  if (state.pileCount === 0) return true;
  if (cards.length !== state.pileCount) return false;

  if (state.rankLocked) return rankValue(rank) === rankValue(state.pileRank);
  return rankValue(rank) >= rankValue(state.pileRank);
}

export function applyPlay(state, playerId, cardIds) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");

  const players = state.players.map((p) => ({ ...p, hand: p.hand.slice() }));
  const current = players.find((p) => p.id === playerId);

  if (!isLegalPlay(state, current.hand, cardIds)) {
    throw new Error('Coup invalide.');
  }

  const rank = current.hand.find((c) => c.id === cardIds[0]).rank;
  const playedCards = cardIds.map((id) => current.hand.find((c) => c.id === id));
  current.hand = current.hand.filter((c) => !cardIds.includes(c.id));

  const finishedNow = current.hand.length === 0;
  if (finishedNow) current.finished = true;

  const finishedOrder = finishedNow ? [...state.finishedOrder, current.id] : state.finishedOrder;
  const willBurn = BURN_RANKS.has(rank);
  const isMatch = !willBurn && state.pileCount > 0 && rankValue(rank) === rankValue(state.pileRank);

  const logMessage = `${current.name} pose ${playedCards.length} × ${rank}${willBurn ? ' — le pli brûle !' : isMatch ? ' — même niveau, le pli se verrouille sur ce rang !' : ''}${finishedNow ? ` — ${current.name} a fini !` : ''}`;

  // Le pli en cours démarre "propre" si le pli précédent était déjà libre
  // (pileCount 0 : soit c'est la toute première pose, soit on relance juste
  // après avoir brûlé) ; sinon la pose s'ajoute à l'historique déjà en cours.
  // Le pli est TOUJOURS ajouté à l'historique, même s'il brûle : c'est ce qui
  // permet à l'UI de montrer un instant la carte qui vient de brûler le pli,
  // au lieu qu'elle disparaisse instantanément.
  const startingFreshPli = state.pileCount === 0;
  const pileHistory = startingFreshPli
    ? [{ by: current.id, cards: playedCards }]
    : [...(state.pileHistory || []), { by: current.id, cards: playedCards }];

  let nextState = {
    ...state,
    players,
    pile: playedCards,
    pileRank: willBurn ? null : rank,
    pileCount: willBurn ? 0 : playedCards.length,
    pileHistory,
    // Change à chaque fois qu'un pli se termine (brûlé ici, ou ramassé dans
    // applyPass) : signale à l'UI de laisser le pli affiché un instant avant
    // de basculer visuellement sur "pli libre".
    pileClearedId: willBurn ? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : state.pileClearedId,
    rankLocked: willBurn ? false : isMatch,
    lastPlayerToPlay: willBurn ? null : current.id,
    passedSinceLastPlay: [],
    // Le premier pli de la manche se termine dès qu'il brûle (le décompte de
    // cartes reçues à l'échange n'a plus lieu d'être affiché après ça).
    firstTrickPending: willBurn ? false : state.firstTrickPending,
    finishedOrder,
    lastMove: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      by: current.id,
      cards: playedCards,
      burned: willBurn,
      finished: finishedNow
    },
    lastPlayedByPlayer: { ...state.lastPlayedByPlayer, [current.id]: { cards: playedCards, burned: willBurn } },
    log: [...state.log, { ts: Date.now(), message: logMessage }].slice(-40)
  };

  const roundEnd = finishRoundIfNeeded(nextState, players);
  if (roundEnd) {
    return { ...nextState, ...roundEnd };
  }

  if (willBurn && !finishedNow) {
    nextState.currentPlayerId = current.id;
  } else {
    nextState.currentPlayerId = nextActivePlayerId(nextState.turnOrder, players, current.id);
  }

  return nextState;
}

export function applyPass(state, playerId) {
  if (state.status !== 'playing') throw new Error('La partie est terminée.');
  if (state.currentPlayerId !== playerId) throw new Error("Ce n'est pas ton tour.");
  if (state.pileCount === 0) throw new Error('Impossible de passer : à toi de relancer.');

  const player = state.players.find((p) => p.id === playerId);
  const passedSinceLastPlay = [...new Set([...state.passedSinceLastPlay, playerId])];
  const remaining = activePlayers(state.players).filter((p) => p.id !== state.lastPlayerToPlay);

  let nextState = {
    ...state,
    passedSinceLastPlay,
    log: [...state.log, { ts: Date.now(), message: `${player.name} passe.` }].slice(-40)
  };

  const everyoneElsePassed = remaining.every((p) => passedSinceLastPlay.includes(p.id));

  if (everyoneElsePassed) {
    const leaderStillIn = state.players.find((p) => p.id === state.lastPlayerToPlay && !p.finished);
    const leaderId = leaderStillIn ? leaderStillIn.id : nextActivePlayerId(state.turnOrder, state.players, state.lastPlayerToPlay);
    nextState = {
      ...nextState,
      // pile/pileHistory ne sont volontairement PAS vidés ici : l'UI les
      // affiche encore un court instant (voir pileClearedId) avant de montrer
      // "pli libre" — le prochain applyPlay les remettra à zéro proprement.
      pileRank: null,
      pileCount: 0,
      pileClearedId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      rankLocked: false,
      lastPlayerToPlay: null,
      passedSinceLastPlay: [],
      firstTrickPending: false,
      currentPlayerId: leaderId,
      log: [...nextState.log, { ts: Date.now(), message: `Le pli est ramassé, ${state.players.find((p) => p.id === leaderId)?.name || '?'} relance.` }].slice(-40)
    };
  } else {
    nextState.currentPlayerId = nextActivePlayerId(state.turnOrder, state.players, playerId);
    nextState.rankLocked = false;
  }

  return nextState;
}
