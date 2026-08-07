import './style.css';
import { renderNamePrompt, renderLeftTable, renderRoomList } from './ui/lobby.js';
import { renderGame, renderSpectatorGame } from './ui/game.js';
import { applySettings, mountSettingsButton, setPlayerNameController } from './ui/settings.js';
import {
  getLocalProfile,
  listActiveRooms,
  createNewRoom,
  createLocalIdentity,
  ensureMembership,
  renameLocalPlayer,
  leaveTable,
  kickPlayer,
  drawForCurrentPlayer,
  playCards,
  passTurn,
  playAmericainCard,
  drawAmericainCard,
  hitBlackjack,
  standBlackjack,
  hitFlip7,
  stayFlip7,
  drawSkyjoFromDeck,
  drawSkyjoFromDiscard,
  placeSkyjoCard,
  discardSkyjoAndReveal,
  drawSuiteInfernale,
  playSuiteInfernaleSequenceCard,
  playSuiteInfernaleRejouer,
  playSuiteInfernaleAttack,
  respondToSuiteInfernaleAttack,
  discardSuiteInfernale,
  drawCinqRoisFromStock,
  drawCinqRoisFromDiscard,
  discardCinqRois,
  drawLuckyNumbersFromStock,
  takeLuckyNumbersFromDiscard,
  placeLuckyNumbersDrawn,
  discardLuckyNumbersDrawn,
  submitExchangeGift,
  reclaimStaleHost,
  pingHostPresence,
  pingPlayerPresence,
  reclaimStalePlayers,
  reportRelayStatus,
  playAgain,
  fetchRoomById,
  watchRoom,
  initRelay,
  isRelayActive,
  stopRelay
} from './game/engine.js';
import { playerToDrawFrom } from './game/pouilleux.js';
import { rankValue as trouducRankValue } from './game/trouduc.js';
import { handTotal as blackjackHandTotal } from './game/blackjack.js';
import { isLegalCard as americainIsLegalCard } from './game/americain.js';
import { canGoOut as cinqRoisCanGoOut, cardPenalty as cinqRoisCardPenalty } from './game/cinqrois.js';

const app = document.getElementById('app');
let unsubscribe = null;
let currentPlayer = null;
let currentRoomId = null;
let hasLeftTable = false;
// `undefined` = liaison directe jamais armée (distinct de `null`, qui
// signifie "armée pour une table sans hôte"). Ré-arme `initRelay` (et donc
// reconnecte tout le monde) seulement quand `hostId` change réellement.
let lastRelayHostId = undefined;
// Dernière valeur de `isRelayActive()` effectivement poussée dans
// `room.state.connections`, pour ne pousser une mise à jour que lors d'un
// vrai changement (voir le battement de cœur dédié en bas de fichier).
let lastReportedRelayActive = null;
// Pourquoi on affiche l'écran "pas à la table" : un départ volontaire, ou juste
// une attente pendant qu'une partie tournait sans nous. Fixé une fois à l'entrée
// sur cet écran, pour ne pas changer de message à chaque re-rendu.
let leftScreenIsWaiting = false;
// Rafraîchissement périodique de l'écran des salons (pas d'abonnement Realtime
// large sur toute la table, juste un sondage léger — voir showRoomList).
let roomListPollHandle = null;

// Évite que ce même appareil ne programme deux fois le coup d'un bot pour le
// même état de partie (plusieurs appareils peuvent chacun tenter le coup ;
// le verrou optimiste de Supabase ne laisse passer que le premier).
let scheduledBotMove = null;

function maybeScheduleBotMove(room) {
  if (room.game !== 'pouilleux' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledBotMove === signature) return;
  scheduledBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const targetId = playerToDrawFrom(fresh.state);
      const target = fresh.state.players.find((p) => p.id === targetId);
      if (!target || target.hand.length === 0) return;

      const cardIndex = Math.floor(Math.random() * target.hand.length);
      await drawForCurrentPlayer(fresh, currentId, cardIndex);
    } catch (err) {
      // Un autre appareil a probablement déjà joué le coup, ou la partie a changé
      // entre temps — la resynchro realtime prendra le relais normalement.
    }
  }, 1000 + Math.random() * 700);
}

// Politique du bot au Trou du Cul (passe 2) :
// - finit sa main dès que possible
// - brûle (8/2) pour se débarrasser ou relancer si utile
// - sinon égalise le pli / joue le plus petit surplus
// - pli libre : vide le plus gros paquet du rang le plus faible
function chooseTrouducMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'pass' };
  const groups = new Map();
  for (const card of bot.hand) {
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push(card);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => trouducRankValue(a[0]) - trouducRankValue(b[0]));
  const handSize = bot.hand.length;

  // Finir la main : si un groupe légal vide exactement la main, le jouer
  if (state.pileCount === 0) {
    for (const [, cards] of sortedGroups) {
      if (cards.length === handSize) return { type: 'play', cardIds: cards.map((c) => c.id) };
    }
    // Brûler pour relancer si on a 8 ou 2 et encore beaucoup de cartes
    for (const rank of ['8', '2']) {
      if (groups.has(rank) && handSize > groups.get(rank).length) {
        // seulement si le rang faible restant est gênant — préfère d'abord vider le plus faible
      }
    }
    const [, cards] = sortedGroups[0];
    return { type: 'play', cardIds: cards.map((c) => c.id) };
  }

  const pileRankValue = trouducRankValue(state.pileRank);
  const need = state.pileCount;

  // Finir exactement
  for (const [rank, cards] of sortedGroups) {
    if (cards.length !== need) continue;
    if (cards.length !== handSize) continue;
    const rv = trouducRankValue(rank);
    const legal = state.rankLocked ? rv === pileRankValue : rv >= pileRankValue;
    if (legal) return { type: 'play', cardIds: cards.map((c) => c.id) };
  }

  let best = null;
  let bestScore = Infinity;
  for (const [rank, cards] of sortedGroups) {
    if (cards.length < need) continue;
    const rv = trouducRankValue(rank);
    const legal = state.rankLocked ? rv === pileRankValue : rv >= pileRankValue;
    if (!legal) continue;
    const isBurn = rank === '8' || rank === '2';
    const equals = rv === pileRankValue;
    // Score : finir > égaliser > petit surplus > brûler (utile si main encore longue)
    let score = (rv - pileRankValue) + (equals ? 0 : 8);
    if (isBurn) score += handSize <= need + 2 ? -5 : 3; // brûler pour finir bientôt, sinon garder
    if (cards.length === handSize) score -= 50;
    if (score < bestScore) {
      bestScore = score;
      best = cards.slice(0, need).map((c) => c.id);
    }
  }
  return best ? { type: 'play', cardIds: best } : { type: 'pass' };
}

let scheduledTrouducBotMove = null;

function maybeScheduleTrouducBotMove(room) {
  if (room.game !== 'trouduc' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledTrouducBotMove === signature) return;
  scheduledTrouducBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseTrouducMove(fresh.state, currentId);
      if (move.type === 'play') {
        await playCards(fresh, currentId, move.cardIds);
      } else {
        await passTurn(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

// Politique du bot au 8 américain (passe 2) :
// - priorise vider la main (1 carte légale = jouer)
// - garde les 8 comme jokers de sortie
// - dump les hautes cartes, privilégie la couleur dominante restante
// - en jouant un 8, annonce la couleur la plus représentée
function chooseAmericainMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'draw' };

  const rankWeight = (r) => {
    if (r === 'A') return 14;
    if (r === 'K') return 13;
    if (r === 'Q') return 12;
    if (r === 'J') return 11;
    if (r === '8') return -5;
    return parseInt(r, 10) || 0;
  };

  const legalCards = bot.hand.filter((c) => americainIsLegalCard(state, c));
  if (!legalCards.length) return { type: 'draw' };

  // Une seule carte en main et légale → jouer pour finir
  if (bot.hand.length === 1) {
    const card = legalCards[0];
    if (card.rank === '8') {
      return { type: 'play', cardId: card.id, chosenSuit: card.suit || 'S' };
    }
    return { type: 'play', cardId: card.id };
  }

  const suitCounts = { S: 0, H: 0, D: 0, C: 0 };
  bot.hand.forEach((c) => { if (c.suit) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1; });

  const nonEights = legalCards.filter((c) => c.rank !== '8');
  const pool = nonEights.length ? nonEights : legalCards;

  // Score : haut rang + bonus si on réduit une couleur minoritaire (diversifie moins)
  pool.sort((a, b) => {
    const sa = rankWeight(a.rank) + (suitCounts[a.suit] <= 1 ? 3 : 0);
    const sb = rankWeight(b.rank) + (suitCounts[b.suit] <= 1 ? 3 : 0);
    return sb - sa;
  });
  const card = pool[0];

  if (card.rank !== '8') return { type: 'play', cardId: card.id };

  const remaining = bot.hand.filter((c) => c.id !== card.id);
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  remaining.forEach((c) => { if (c.suit) counts[c.suit] = (counts[c.suit] || 0) + 1; });
  const bestSuit = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return { type: 'play', cardId: card.id, chosenSuit: bestSuit };
}

let scheduledAmericainBotMove = null;

function maybeScheduleAmericainBotMove(room) {
  if (room.game !== 'americain' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledAmericainBotMove === signature) return;
  scheduledAmericainBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseAmericainMove(fresh.state, currentId);
      if (move.type === 'play') {
        await playAmericainCard(fresh, currentId, move.cardId, move.chosenSuit);
      } else {
        await drawAmericainCard(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

// Politique du bot au Blackjack (passe 2) — stratégie de base plus fine :
// distingue mains dures / soft (As compté 11), et affine les seuils selon la banque.
function chooseBlackjackMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stand' };
  const hand = bot.hand;
  const total = blackjackHandTotal(hand);
  if (total >= 21) return { type: 'stand' };

  // Soft = au moins un As encore compté pour 11
  let raw = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces += 1; raw += 11; }
    else if (c.rank === 'J' || c.rank === 'Q' || c.rank === 'K') raw += 10;
    else raw += parseInt(c.rank, 10) || 0;
  }
  let softAces = aces;
  let softTotal = raw;
  while (softTotal > 21 && softAces > 0) { softTotal -= 10; softAces -= 1; }
  const isSoft = softAces > 0 && total <= 21;

  const dealerUp = state.dealer?.hand?.[0];
  let dealerVal = 10;
  if (dealerUp) {
    if (dealerUp.rank === 'A') dealerVal = 11;
    else if (dealerUp.rank === 'J' || dealerUp.rank === 'Q' || dealerUp.rank === 'K') dealerVal = 10;
    else dealerVal = parseInt(dealerUp.rank, 10) || 10;
  }

  if (isSoft) {
    // Soft 18 : reste vs 2-8, tire vs 9-A ; soft ≤17 : tire toujours
    if (total <= 17) return { type: 'hit' };
    if (total === 18) return dealerVal >= 9 ? { type: 'hit' } : { type: 'stand' };
    return { type: 'stand' };
  }

  // Main dure
  if (total <= 11) return { type: 'hit' };
  if (total === 12) return dealerVal >= 4 && dealerVal <= 6 ? { type: 'stand' } : { type: 'hit' };
  if (total >= 13 && total <= 16) return dealerVal >= 2 && dealerVal <= 6 ? { type: 'stand' } : { type: 'hit' };
  return { type: 'stand' }; // 17+
}

let scheduledBlackjackBotMove = null;

function maybeScheduleBlackjackBotMove(room) {
  if (room.game !== 'blackjack' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledBlackjackBotMove === signature) return;
  scheduledBlackjackBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseBlackjackMove(fresh.state, currentId);
      if (move.type === 'hit') {
        await hitBlackjack(fresh, currentId);
      } else {
        await standBlackjack(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

// Politique du bot à Flip 7 (passe 2) :
// - estime le risque de doublon (plus de uniques = plus risqué)
// - tient compte du score de manche potentiel (somme des numéros) vs adversaires encore en jeu
// - plus agressif en retard, prudent en avance ou si d'autres ont déjà stay avec un bon score
function chooseFlip7Move(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stay' };
  if (bot.status && bot.status !== 'playing') return { type: 'stay' };

  const numbers = bot.display.filter((c) => c.kind === 'number');
  const uniqueCount = numbers.length;
  if (uniqueCount >= 7) return { type: 'stay' }; // Flip 7 = bonus, on s'arrête

  const roundSum = numbers.reduce((s, c) => s + (c.value || 0), 0);
  const myScore = bot.score ?? 0;
  const others = state.players.filter((p) => p.id !== botId);
  const bestOther = Math.max(0, ...others.map((p) => p.score ?? 0));
  const behind = bestOther - myScore;

  // Meilleur score de manche déjà « stay » chez les autres (pression)
  const stayedScores = others
    .filter((p) => p.status === 'stayed' || p.status === 'done')
    .map((p) => (p.display || []).filter((c) => c.kind === 'number').reduce((s, c) => s + (c.value || 0), 0));
  const bestStayedRound = stayedScores.length ? Math.max(...stayedScores) : 0;

  let stayAt = 5;
  if (behind > 20) stayAt = 6;
  else if (behind > 8) stayAt = 5;
  else if (behind < -25) stayAt = 3;
  else if (behind < -10) stayAt = 4;

  // Si on bat déjà le meilleur stay adverse avec 4+ cartes, sécuriser
  if (uniqueCount >= 4 && roundSum >= bestStayedRound + 5 && behind <= 10) stayAt = Math.min(stayAt, uniqueCount);

  if (uniqueCount >= stayAt) return { type: 'stay' };
  return { type: 'hit' };
}

let scheduledFlip7BotMove = null;

function maybeScheduleFlip7BotMove(room) {
  if (room.game !== 'flip7' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledFlip7BotMove === signature) return;
  scheduledFlip7BotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseFlip7Move(fresh.state, currentId);
      if (move.type === 'hit') {
        await hitFlip7(fresh, currentId);
      } else {
        await stayFlip7(fresh, currentId);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

// Politique du bot à Skyjo (passe 2) :
// - défausse si ≤4, si bat une visible, ou si complète une colonne
// - placement : priorité annulation de colonne, puis max de gain de points
// - révèle les cases d'une colonne déjà « engagée » (1–2 visibles)
function skyjoColumnInfo(grid, col) {
  const idxs = [col, col + 4, col + 8];
  const cells = idxs.map((i) => grid[i]);
  const faceUp = cells.filter((c) => c && c.faceUp);
  const hidden = idxs.filter((i) => grid[i] && !grid[i].faceUp);
  const vals = faceUp.map((c) => c.card.value);
  return { idxs, faceUp, hidden, vals };
}

function chooseSkyjoDrawSource(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const topDiscard = state.discard[state.discard.length - 1];
  if (!topDiscard || !bot) return 'deck';
  const v = topDiscard.value;

  // Complète une colonne de 2 identiques ?
  for (let col = 0; col < 4; col++) {
    const { vals } = skyjoColumnInfo(bot.grid, col);
    if (vals.length === 2 && vals[0] === vals[1] && v === vals[0]) return 'discard';
  }

  let worstVisible = -Infinity;
  for (const cell of bot.grid) {
    if (cell?.faceUp) worstVisible = Math.max(worstVisible, cell.card.value);
  }
  if (v <= 4) return 'discard';
  if (worstVisible > -Infinity && v < worstVisible - 1) return 'discard'; // gain net ≥ 2
  if (v <= 6 && worstVisible >= 9) return 'discard';
  return 'deck';
}

function chooseSkyjoPlacement(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const drawnValue = state.drawnCard.card.value;
  const grid = bot.grid;

  // 1) Compléter / préparer une colonne identique
  for (let col = 0; col < 4; col++) {
    const { vals, hidden, idxs } = skyjoColumnInfo(grid, col);
    if (vals.length === 2 && vals[0] === vals[1] && drawnValue === vals[0]) {
      if (hidden.length) return { type: 'place', index: hidden[0] };
      const replaceable = idxs.find((i) => grid[i] && grid[i].faceUp);
      if (replaceable !== undefined) return { type: 'place', index: replaceable };
    }
    // 1 visible + draw égale → placer sur une cachée de la colonne pour viser l'annulation
    if (vals.length === 1 && vals[0] === drawnValue && hidden.length) {
      return { type: 'place', index: hidden[0] };
    }
  }

  // 2) Meilleur remplacement visible (gain de points max)
  let bestReplace = null;
  let bestGain = 0;
  grid.forEach((cell, i) => {
    if (!cell || !cell.faceUp) return;
    const gain = cell.card.value - drawnValue;
    if (gain > bestGain) {
      bestGain = gain;
      bestReplace = i;
    }
  });
  if (bestReplace !== null && bestGain >= 2) return { type: 'place', index: bestReplace };

  const hiddenIndexes = grid.map((c, i) => (c && !c.faceUp ? i : -1)).filter((i) => i !== -1);

  // 3) Pioche sabot : révéler une case dans une colonne déjà engagée
  if (state.drawnCard.source === 'deck' && hiddenIndexes.length) {
    if (drawnValue >= 8 && bestReplace !== null) {
      // Carte pourrie de la pioche : défausser + révéler
    } else if (drawnValue <= 3 && bestReplace !== null && bestGain > 0) {
      return { type: 'place', index: bestReplace };
    }

    // Préfère révéler dans colonne avec 1–2 visibles (info / annulation)
    const scored = hiddenIndexes.map((i) => {
      const col = i % 4;
      const { vals } = skyjoColumnInfo(grid, col);
      let s = vals.length * 3;
      s -= Math.abs((i % 4) - 1.5); // léger biais centre
      return { i, s };
    });
    scored.sort((a, b) => b.s - a.s);
    return { type: 'reveal', index: scored[0].i };
  }

  // 4) Défausse forcée à placer
  if (bestReplace !== null && bestGain > 0) return { type: 'place', index: bestReplace };
  if (hiddenIndexes.length) return { type: 'place', index: hiddenIndexes[0] };
  if (bestReplace !== null) return { type: 'place', index: bestReplace };
  return { type: 'place', index: grid.findIndex((c) => c) };
}

let scheduledSkyjoBotMove = null;

function maybeScheduleSkyjoBotMove(room) {
  if (room.game !== 'skyjo' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledSkyjoBotMove === signature) return;
  scheduledSkyjoBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      if (!fresh.state.drawnCard) {
        const source = chooseSkyjoDrawSource(fresh.state, currentId);
        if (source === 'discard') await drawSkyjoFromDiscard(fresh, currentId);
        else await drawSkyjoFromDeck(fresh, currentId);
      } else {
        const move = chooseSkyjoPlacement(fresh.state, currentId);
        if (move.type === 'place') await placeSkyjoCard(fresh, currentId, move.index);
        else await discardSkyjoAndReveal(fresh, currentId, move.index);
      }
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

const SUITE_INFERNALE_ATTACK_TYPES = ['volerDerniere', 'volerUne', 'retirerUne', 'retirerDeux', 'echangerJeu', 'changerPlace'];

function suiteInfernaleHighestFilledIndex(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i]) return i;
  }
  return -1;
}

function suiteInfernaleFilledIndexes(sequence) {
  return sequence.map((c, i) => (c ? i : -1)).filter((i) => i !== -1);
}

// Politique du bot à la Suite Infernale (passe 2) :
// - avancer sa suite en priorité (nombre exact > joker+1 > joker+2)
// - n'attaquer que si un adversaire est devant ou à égalité
// - préférer voler/retirer sur le leader ; rejouer seulement si utile
// - garder STOP et les numéros futurs ; défausser le moins utile
function chooseSuiteInfernaleMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return null;
  const neededIndex = bot.sequence.findIndex((c) => !c);
  const filledCount = bot.sequence.filter(Boolean).length;
  const myProgress = suiteInfernaleHighestFilledIndex(bot.sequence);

  const opponents = state.players.filter((p) => p.id !== botId);
  const leaderProgress = Math.max(-1, ...opponents.map((o) => suiteInfernaleHighestFilledIndex(o.sequence)));
  const behindLeader = leaderProgress - myProgress;

  // 1) Avancer la suite
  if (neededIndex !== -1) {
    const numberCard = bot.hand.find((c) => c.kind === 'number' && c.value === neededIndex + 1);
    if (numberCard) return { type: 'sequence', cardId: numberCard.id };

    const joker1 = bot.hand.find((c) => c.kind === 'special' && c.type === 'jokerPlus1');
    if (joker1) return { type: 'sequence', cardId: joker1.id };

    // joker+2 seulement si on n'est pas sur le 9 (règle) et déjà démarré
    const joker2 = bot.hand.find((c) => c.kind === 'special' && c.type === 'jokerPlus2');
    if (joker2 && filledCount > 0 && neededIndex + 1 < 9) return { type: 'sequence', cardId: joker2.id };
  }

  // 2) Attaques : seulement si un adversaire est menaçant (devant ou proche de finir)
  const attackPriority = ['volerDerniere', 'retirerDeux', 'volerUne', 'retirerUne', 'echangerJeu', 'changerPlace'];
  const attackCards = bot.hand
    .filter((c) => c.kind === 'special' && SUITE_INFERNALE_ATTACK_TYPES.includes(c.type))
    .sort((a, b) => attackPriority.indexOf(a.type) - attackPriority.indexOf(b.type));

  if (behindLeader >= 0 || leaderProgress >= 5) {
    for (const card of attackCards) {
      const validTargets = opponents.filter((o) => {
        if (card.type === 'volerDerniere') return suiteInfernaleHighestFilledIndex(o.sequence) !== -1;
        if (card.type === 'retirerDeux') {
          const h = suiteInfernaleHighestFilledIndex(o.sequence);
          return h >= 1 && o.sequence[h] && o.sequence[h - 1];
        }
        if (card.type === 'volerUne' || card.type === 'retirerUne') return o.sequence.some(Boolean);
        if (card.type === 'echangerJeu') {
          // Échanger la main seulement si la nôtre est mauvaise (peu de numéros utiles)
          const useful = bot.hand.filter((c) => c.kind === 'number' && c.value === (neededIndex === -1 ? 99 : neededIndex + 1)).length;
          return useful === 0;
        }
        return true;
      });
      if (!validTargets.length) continue;
      validTargets.sort(
        (a, b) => suiteInfernaleHighestFilledIndex(b.sequence) - suiteInfernaleHighestFilledIndex(a.sequence)
      );
      const target = validTargets[0];
      // Ne pas attaquer quelqu'un très derrière soi (sauf si on n'a rien d'autre)
      if (suiteInfernaleHighestFilledIndex(target.sequence) < myProgress - 2 && attackCards.length > 1) continue;
      let slotIndex = null;
      if (card.type === 'volerUne' || card.type === 'retirerUne') {
        const indexes = suiteInfernaleFilledIndexes(target.sequence);
        slotIndex = indexes[indexes.length - 1]; // case la plus avancée
      }
      return { type: 'attack', cardId: card.id, targetId: target.id, slotIndex };
    }
  }

  // 3) Rejouer si on a encore un numéro utile en main après, ou main pauvre
  const rejouer = bot.hand.find((c) => c.kind === 'special' && c.type === 'rejouer');
  if (rejouer) {
    const hasFutureNumber = bot.hand.some(
      (c) => c.kind === 'number' && neededIndex !== -1 && c.value >= neededIndex + 1 && c.value <= neededIndex + 3
    );
    if (hasFutureNumber || bot.hand.length <= 4) return { type: 'rejouer', cardId: rejouer.id };
  }

  // 4) Défausse : éviter STOP, numéros proches de la suite, jokers
  const discardCandidates = bot.hand.filter((c) => !(c.kind === 'special' && c.type === 'stop'));
  const pool = discardCandidates.length ? discardCandidates : bot.hand;
  const scoreDiscard = (c) => {
    if (c.kind === 'special' && c.type === 'stop') return 100;
    if (c.kind === 'special' && (c.type === 'jokerPlus1' || c.type === 'jokerPlus2')) return 80;
    if (c.kind === 'number' && neededIndex !== -1) {
      const dist = c.value - (neededIndex + 1);
      if (dist === 0) return 90;
      if (dist > 0 && dist <= 2) return 50 - dist;
      if (dist < 0) return 10; // numéro déjà passé = inutile
    }
    if (c.kind === 'special') return 30;
    return 20;
  };
  pool.sort((a, b) => scoreDiscard(a) - scoreDiscard(b));
  return { type: 'discard', cardId: pool[0].id };
}


function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Réaction du bot face à une attaque (passe 2) : bloque si l'attaque fait mal, sinon économise le STOP. */
function chooseSuiteInfernaleReaction(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { block: false };
  const stopCard = bot.hand.find((c) => c.kind === 'special' && c.type === 'stop');
  if (!stopCard) return { block: false };

  const attackType = state.pendingAttack?.type;
  const filled = suiteInfernaleHighestFilledIndex(bot.sequence) + 1;
  // Toujours bloquer les vols / échanges de suite ou de main
  const mustBlock = ['volerDerniere', 'volerUne', 'echangerJeu', 'changerPlace'].includes(attackType);
  // Bloquer un retrait si on a déjà bien avancé
  const blockSoft = ['retirerUne', 'retirerDeux'].includes(attackType) && filled >= 3;
  // En fin de course (7+), bloquer presque tout
  const endgame = filled >= 7;
  if (mustBlock || blockSoft || endgame) return { block: true, stopCardId: stopCard.id };
  return { block: false };
}


let scheduledSuiteInfernaleBotMove = null;
let scheduledSuiteInfernaleBotReaction = null;

function maybeScheduleSuiteInfernaleBotMove(room) {
  if (room.game !== 'suiteinfernale' || room.state.status !== 'playing') return;

  if (room.state.pendingAttack) {
    const targetId = room.state.pendingAttack.targetId;
    const targetBot = room.state.players.find((p) => p.id === targetId && p.isBot);
    if (!targetBot) return;

    const signature = `${room.id}:${room.version}:reaction`;
    if (scheduledSuiteInfernaleBotReaction === signature) return;
    scheduledSuiteInfernaleBotReaction = signature;

    window.setTimeout(async () => {
      try {
        const fresh = await fetchRoomById(room.id);
        if (!fresh.state.pendingAttack || fresh.state.pendingAttack.targetId !== targetId) return;
        const reaction = chooseSuiteInfernaleReaction(fresh.state, targetId);
        await respondToSuiteInfernaleAttack(fresh, targetId, reaction);
      } catch (err) {
        // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
      }
    }, 900 + Math.random() * 700);
    return;
  }

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}:turn`;
  if (scheduledSuiteInfernaleBotMove === signature) return;
  scheduledSuiteInfernaleBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId || fresh.state.pendingAttack) return;

      if (!fresh.state.hasDrawnThisTurn) {
        await drawSuiteInfernale(fresh, currentId);
        return;
      }

      const move = chooseSuiteInfernaleMove(fresh.state, currentId);
      if (move.type === 'sequence') await playSuiteInfernaleSequenceCard(fresh, currentId, move.cardId);
      else if (move.type === 'rejouer') await playSuiteInfernaleRejouer(fresh, currentId, move.cardId);
      else if (move.type === 'attack') await playSuiteInfernaleAttack(fresh, currentId, move.cardId, move.targetId, move.slotIndex);
      else await discardSuiteInfernale(fresh, currentId, move.cardId);
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

let scheduledTrouducExchangeBot = null;

/** Pendant la phase d'échange, un bot Président/Vice-Président rend toujours ses cartes les plus faibles. */
function maybeScheduleTrouducExchangeBot(room) {
  if (room.game !== 'trouduc' || room.state.status !== 'exchange') return;

  const ex = room.state.exchange;
  const pendingGivers = [];
  if (!ex.presidentGiven) pendingGivers.push({ id: ex.presidentId, count: ex.presidentGiftCount });
  if (!ex.vicePresidentGiven) pendingGivers.push({ id: ex.vicePresidentId, count: ex.vicePresidentGiftCount });

  const botsPending = pendingGivers.filter(({ id }) => room.state.players.find((p) => p.id === id)?.isBot);
  if (!botsPending.length) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledTrouducExchangeBot === signature) return;
  scheduledTrouducExchangeBot = signature;

  botsPending.forEach(({ id, count }) => {
    window.setTimeout(async () => {
      try {
        const fresh = await fetchRoomById(room.id);
        if (fresh.state.status !== 'exchange') return;
        const freshEx = fresh.state.exchange;
        const alreadyGiven = id === freshEx.presidentId ? freshEx.presidentGiven : freshEx.vicePresidentGiven;
        if (alreadyGiven) return;

        const bot = fresh.state.players.find((p) => p.id === id);
        if (!bot) return;
        const worstCardIds = bot.hand
          .slice()
          .sort((a, b) => trouducRankValue(a.rank) - trouducRankValue(b.rank))
          .slice(0, count)
          .map((c) => c.id);

        await submitExchangeGift(fresh, id, worstCardIds);
      } catch (err) {
        // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
      }
    }, 900 + Math.random() * 700);
  });
}

// Politique du bot aux Cinq Rois (améliorée) :
// - pioche la défausse seulement si elle renforce vraiment la main
//   (famille, suite, wild utile), pas juste parce qu'elle est « petite » ;
// - à la défausse, cherche d'abord une carte dont le reste de la main est
//   posable (go-out), en se débarrassant de la plus chère possible ;
// - sinon défausse la carte la moins utile aux combinaisons, en préservant
//   paires, suites et wilds ; plus agressif en last_turns.
function cinqRoisIsWild(card, trumpRank) {
  return card.isJoker || card.rank === trumpRank;
}

/** Combien de naturelles du même rang (hors wilds) dans la main. */
function cinqRoisRankCount(hand, rank, trumpRank) {
  return hand.filter((c) => !cinqRoisIsWild(c, trumpRank) && c.rank === rank).length;
}

/** Rangs naturels d'une couleur, triés. */
function cinqRoisSuitRanks(hand, suit, trumpRank) {
  return hand
    .filter((c) => !cinqRoisIsWild(c, trumpRank) && c.suit === suit)
    .map((c) => c.rank)
    .sort((a, b) => a - b);
}

/**
 * Score d'intérêt d'ajouter `card` à `hand` (sans l'y mettre).
 * Plus c'est haut, plus la défausse vaut le coup d'être prise.
 */
function cinqRoisDrawInterest(hand, card, trumpRank) {
  if (!card) return -1;
  // Joker visible : excellent (wild universel), sauf si on en a déjà trop
  // par rapport à la taille de main (éviter 50 pts collés pour rien).
  if (card.isJoker) {
    const wilds = hand.filter((c) => cinqRoisIsWild(c, trumpRank)).length;
    return wilds >= Math.max(2, Math.floor(hand.length / 3)) ? 4 : 18;
  }
  if (card.rank === trumpRank) {
    const wilds = hand.filter((c) => cinqRoisIsWild(c, trumpRank)).length;
    return wilds >= Math.max(2, Math.floor(hand.length / 3)) ? 3 : 14;
  }

  const sameRank = cinqRoisRankCount(hand, card.rank, trumpRank);
  // Famille en construction
  let score = 0;
  if (sameRank >= 2) score += 20; // 3e+ carte de famille
  else if (sameRank === 1) score += 10; // paire → potentiel famille

  // Suite : proximité avec d'autres rangs de la même couleur
  const ranks = cinqRoisSuitRanks(hand, card.suit, trumpRank);
  if (ranks.length) {
    let bestGap = 99;
    for (const r of ranks) {
      const gap = Math.abs(r - card.rank);
      if (gap === 0) continue; // doublon de rang dans la couleur : peu utile en suite
      if (gap < bestGap) bestGap = gap;
    }
    if (bestGap === 1) score += 16; // adjacent → suite directe
    else if (bestGap === 2) score += 8; // un trou comblable par un wild
    else if (bestGap <= 3) score += 3;
  }

  // Carte isolée à faible pénalité : léger intérêt seulement
  if (score === 0) {
    const pen = cinqRoisCardPenalty(card, trumpRank);
    if (pen <= 4) score = 2;
    else if (pen <= 6) score = 1;
  }
  return score;
}

/**
 * Utilité d'une carte DANS la main : plus c'est haut, plus on veut la garder.
 * On défausse en priorité les cartes à faible utilité (et forte pénalité).
 */
function cinqRoisKeepValue(hand, card, trumpRank) {
  if (cinqRoisIsWild(card, trumpRank)) {
    // Garder les wilds sauf s'il y en a beaucoup
    const wilds = hand.filter((c) => cinqRoisIsWild(c, trumpRank)).length;
    return card.isJoker ? 40 - wilds * 3 : 28 - wilds * 2;
  }
  let value = 0;
  const sameRank = cinqRoisRankCount(hand, card.rank, trumpRank);
  if (sameRank >= 3) value += 25;
  else if (sameRank === 2) value += 16;
  else if (sameRank === 1) value += 4;

  const ranks = cinqRoisSuitRanks(hand, card.suit, trumpRank);
  // Densité de voisins dans la couleur
  let neighbors = 0;
  for (const r of ranks) {
    if (r === card.rank) continue;
    const gap = Math.abs(r - card.rank);
    if (gap === 1) neighbors += 2;
    else if (gap === 2) neighbors += 1;
  }
  value += neighbors * 5;

  // Pénalité : une carte chère isolée se défausse plus volontiers
  const pen = cinqRoisCardPenalty(card, trumpRank);
  value -= pen * 0.35;
  return value;
}

function chooseCinqRoisMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return null;
  const trump = state.trumpRank;
  const inLastTurns = state.status === 'last_turns';

  if (state.phase === 'draw') {
    const top = state.discard[state.discard.length - 1];
    const interest = cinqRoisDrawInterest(bot.hand, top, trump);
    // Proche d'une pose possible → plus gourmand sur la défausse
    let nearGoOut = false;
    if (bot.hand.length >= 3) {
      for (const c of bot.hand) {
        const rem = bot.hand.filter((x) => x.id !== c.id);
        // Si en ajoutant top on pourrait être encore plus proche — heuristique simple
        if (rem.length >= 3 && cinqRoisCanGoOut(rem, trump)) { nearGoOut = true; break; }
      }
    }
    let threshold = inLastTurns ? 5 : 9;
    if (nearGoOut) threshold = Math.min(threshold, 4);
    if (top && interest >= threshold) return { type: 'draw_discard' };
    if (top && (top.isJoker || top.rank === trump) && interest >= 8) return { type: 'draw_discard' };
    return { type: 'draw_stock' };
  }

  // Phase défausse — d'abord chercher un go-out
  const hand = bot.hand.slice();
  let bestGoOut = null;
  let bestGoOutPenalty = -1;
  for (const card of hand) {
    const remaining = hand.filter((c) => c.id !== card.id);
    if (remaining.length >= 3 && cinqRoisCanGoOut(remaining, trump)) {
      const pen = cinqRoisCardPenalty(card, trump);
      // En go-out on se débarrasse de la carte la plus chère possible
      if (pen > bestGoOutPenalty) {
        bestGoOutPenalty = pen;
        bestGoOut = card;
      }
    }
  }
  if (bestGoOut) return { type: 'discard', cardId: bestGoOut.id, goOut: true };

  // Pas de pose : défausser la carte la moins utile
  // Score = keepValue ; on jette le minimum. En last_turns, pondérer plus la pénalité.
  let bestDiscard = hand[0];
  let bestScore = Infinity;
  for (const card of hand) {
    const keep = cinqRoisKeepValue(hand, card, trump);
    const pen = cinqRoisCardPenalty(card, trump);
    // Moins on veut garder + plus c'est cher → meilleur candidat à jeter
    const score = inLastTurns ? keep - pen * 1.2 : keep - pen * 0.5;
    if (score < bestScore) {
      bestScore = score;
      bestDiscard = card;
    }
  }
  return { type: 'discard', cardId: bestDiscard.id, goOut: false };
}

let scheduledCinqRoisBotMove = null;


// Politique du bot à Lucky Numbers :
// - ne place jamais une valeur qui rend des cases vides impossibles à remplir
//   (ex. un 1 en bas à droite bloque toute la rangée / colonne) ;
// - préfère la case dont la valeur « idéale » (bas-droite = grands nombres)
//   est la plus proche de la tuile ;
// - privilégie les cases vides ; n'échange que si le gain de position est net ;
// - défausse si aucun placement n'est raisonnable.
const LN_DIM = 4;

function lnValidPlacements(board, value) {
  const out = [];
  for (let index = 0; index < 16; index++) {
    if (lnCanPlace(board, index, value)) out.push(index);
  }
  return out;
}

function lnCanPlace(board, index, value) {
  const row = Math.floor(index / LN_DIM);
  const col = index % LN_DIM;
  for (let c = 0; c < LN_DIM; c++) {
    const i = row * LN_DIM + c;
    if (i === index || !board[i]) continue;
    if (c < col && board[i].value >= value) return false;
    if (c > col && board[i].value <= value) return false;
  }
  for (let r = 0; r < LN_DIM; r++) {
    const i = r * LN_DIM + col;
    if (i === index || !board[i]) continue;
    if (r < row && board[i].value >= value) return false;
    if (r > row && board[i].value <= value) return false;
  }
  return true;
}

/** Intervalle [min, max] encore possible pour une case vide, vu le plateau. */
function lnCellBounds(board, index) {
  const row = Math.floor(index / LN_DIM);
  const col = index % LN_DIM;
  let min = 1;
  let max = 20;
  for (let c = 0; c < LN_DIM; c++) {
    const i = row * LN_DIM + c;
    if (i === index || !board[i]) continue;
    if (c < col) min = Math.max(min, board[i].value + 1);
    if (c > col) max = Math.min(max, board[i].value - 1);
  }
  for (let r = 0; r < LN_DIM; r++) {
    const i = r * LN_DIM + col;
    if (i === index || !board[i]) continue;
    if (r < row) min = Math.max(min, board[i].value + 1);
    if (r > row) max = Math.min(max, board[i].value - 1);
  }
  return { min, max };
}

/**
 * Après avoir posé `value` en `index`, toutes les cases encore vides doivent
 * conserver un intervalle non vide — sinon la pose condamne le jardin.
 */
function lnPlacementKeepsBoardViable(board, index, value) {
  const next = board.slice();
  next[index] = { id: 'tmp', value };
  for (let i = 0; i < 16; i++) {
    if (next[i]) continue;
    const { min, max } = lnCellBounds(next, i);
    if (min > max) return false;
  }
  return true;
}

/** Valeur « idéale » pour une case : petits nombres en haut-gauche, grands en bas-droite. */
function lnIdealValue(index) {
  const row = Math.floor(index / LN_DIM);
  const col = index % LN_DIM;
  return 1 + Math.round(((row + col) / 6) * 19);
}

/**
 * Score d'une pose : plus c'est haut, mieux c'est.
 * −∞ si illégal ou si ça bloque des cases vides.
 */
function lnScorePlacement(board, index, value) {
  if (!lnCanPlace(board, index, value)) return -Infinity;
  if (!lnPlacementKeepsBoardViable(board, index, value)) return -Infinity;

  const ideal = lnIdealValue(index);
  const fit = -Math.abs(value - ideal); // 0 = parfait
  const emptyBonus = board[index] ? 0 : 30;
  // Échange : seulement intéressant si l'ancienne valeur collait moins bien
  let swapBonus = 0;
  if (board[index]) {
    const oldFit = -Math.abs(board[index].value - ideal);
    swapBonus = fit - oldFit;
    if (swapBonus <= 0) return -Infinity;
  }
  const row = Math.floor(index / LN_DIM);
  const col = index % LN_DIM;
  const progressAlign = -Math.abs(row - col) * 0.5;

  // Flexibilité : après pose, somme des largeurs d'intervalle des cases vues restantes
  const next = board.slice();
  next[index] = { id: 'tmp', value };
  let flex = 0;
  let emptyLeft = 0;
  for (let i = 0; i < 16; i++) {
    if (next[i]) continue;
    emptyLeft += 1;
    const { min, max } = lnCellBounds(next, i);
    flex += Math.max(0, max - min + 1);
  }
  // Bonus si on est proche de remplir (moins de cases vides)
  const completionBonus = (16 - emptyLeft) * 0.8;

  return emptyBonus + fit * 3 + swapBonus * 2 + progressAlign + flex * 0.15 + completionBonus;
}

function lnBestPlacement(board, value) {
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const score = lnScorePlacement(board, i, value);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // Seuil : un score très bas (ex. mauvais fit sans case vide) → plutôt défausser
  if (best === null || bestScore < -25) return null;
  return best;
}

function chooseLuckyNumbersMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'discard' };

  if (state.drawnTile) {
    const index = lnBestPlacement(bot.board, state.drawnTile.value);
    if (index === null) return { type: 'discard' };
    return { type: 'place', index };
  }

  // Défausse : prendre la tuile dont le meilleur placement est le plus prometteur
  let bestTake = null;
  let bestTakeScore = -Infinity;
  for (const tile of state.discard) {
    const index = lnBestPlacement(bot.board, tile.value);
    if (index === null) continue;
    const score = lnScorePlacement(bot.board, index, tile.value);
    if (score > bestTakeScore) {
      bestTakeScore = score;
      bestTake = { type: 'take', tileId: tile.id, index };
    }
  }
  // Exige un vrai intérêt (au moins une case vide bien placée, score ≥ 0)
  if (bestTake && bestTakeScore >= 0) return bestTake;

  if (state.stock.length > 0) return { type: 'draw' };
  // Pioche vide : tenter quand même le meilleur take, même médiocre
  if (bestTake) return bestTake;
  return { type: 'discard' };
}

let scheduledLuckyNumbersBotMove = null;

function maybeScheduleLuckyNumbersBotMove(room) {
  if (room.game !== 'luckynumbers' || room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledLuckyNumbersBotMove === signature) return;
  scheduledLuckyNumbersBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseLuckyNumbersMove(fresh.state, currentId);
      if (move.type === 'draw') {
        await drawLuckyNumbersFromStock(fresh, currentId);
      } else if (move.type === 'take') {
        await takeLuckyNumbersFromDiscard(fresh, currentId, move.tileId, move.index);
      } else if (move.type === 'place') {
        await placeLuckyNumbersDrawn(fresh, currentId, move.index);
      } else if (fresh.state.drawnTile) {
        await discardLuckyNumbersDrawn(fresh, currentId);
      }
    } catch (err) {
      // Autre appareil a probablement déjà joué.
    }
  }, 900 + Math.random() * 700);
}

function maybeScheduleCinqRoisBotMove(room) {
  if (room.game !== 'cinqrois') return;
  if (room.state.status !== 'playing' && room.state.status !== 'last_turns') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduledCinqRoisBotMove === signature) return;
  scheduledCinqRoisBotMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.currentPlayerId !== currentId) return;
      if (fresh.state.status !== 'playing' && fresh.state.status !== 'last_turns') return;

      const move = chooseCinqRoisMove(fresh.state, currentId);
      if (!move) return;
      if (move.type === 'draw_stock') await drawCinqRoisFromStock(fresh, currentId);
      else if (move.type === 'draw_discard') await drawCinqRoisFromDiscard(fresh, currentId);
      else if (move.type === 'discard') await discardCinqRois(fresh, currentId, move.cardId, move.goOut);
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}

const GAME_TITLES = { pouilleux: 'Le Pouilleux', trouduc: 'Le Trou du Cul', americain: 'Le 8 américain', blackjack: 'Blackjack', flip7: 'Flip 7', skyjo: 'Skyjo', suiteinfernale: 'La Suite Infernale', cinqrois: 'Les Cinq Rois', luckynumbers: 'Lucky Numbers' };

function updateDocumentTitle(room) {
  const gameLabel = GAME_TITLES[room.game];
  document.title = gameLabel ? `${gameLabel} — Cartes en famille` : 'Cartes en famille';
}

let currentRoomRef = null;

setPlayerNameController({
  getName: () => currentPlayer?.name || '',
  onChange: async (newName) => {
    if (!currentPlayer || !currentRoomRef) throw new Error("Pas encore rejoint la table, réessaie dans un instant.");
    const { room: updatedRoom, player: updatedProfile } = await renameLocalPlayer(currentRoomRef, currentPlayer, newName);
    currentPlayer = updatedProfile;
    draw(updatedRoom);
  }
});

function renderCrashRecovery(container, { onReset }) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Petit accroc</h1>
        <p class="lobby-card__intro">
          Quelque chose s'est mal passé avec cette partie (probablement un état incohérent
          après un départ au mauvais moment). Tu peux réinitialiser la table sans perdre les joueurs.
        </p>
        <button id="btn-crash-reset" class="btn btn--primary">Réinitialiser la table</button>
      </div>
    </div>
  `;
  container.querySelector('#btn-crash-reset').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await onReset();
    } catch (err) {
      e.target.disabled = false;
      alert("Impossible de réinitialiser — essaie de recharger complètement la page.");
    }
  });
}

/**
 * (Ré)arme la liaison directe vers l'hôte courant si `hostId` a changé
 * depuis la dernière fois (nouvelle table, changement d'hôte...). Pas
 * d'attente du résultat : si la signalisation échoue (ex: connexion
 * momentanément indisponible), on reste simplement sur Supabase — la
 * prochaine mise à jour de la table retentera automatiquement.
 */
function maybeReinitRelay(room) {
  const hostId = room.state.hostId ?? null;
  lastRelayHostId = hostId;
  // initRelay est idempotent : si hôte/table inchangés, il ne refait que
  // retenter une liaison invité manquante (sans tout détruire).
  initRelay(room, currentPlayer).catch(() => {});
}

function draw(room) {
  currentRoomRef = room;
  updateDocumentTitle(room);
  maybeReinitRelay(room);
  maybeScheduleBotMove(room);
  maybeScheduleTrouducExchangeBot(room);
  maybeScheduleTrouducBotMove(room);
  maybeScheduleAmericainBotMove(room);
  maybeScheduleBlackjackBotMove(room);
  maybeScheduleFlip7BotMove(room);
  maybeScheduleSkyjoBotMove(room);
  maybeScheduleSuiteInfernaleBotMove(room);
  maybeScheduleCinqRoisBotMove(room);
  maybeScheduleLuckyNumbersBotMove(room);

  const stillMember = room.state.players.some((p) => p.id === currentPlayer.id);

  // Une partie est en cours et je n'en fais pas partie (ex: quelqu'un d'autre a lancé
  // une manche avant que je ne rejoigne) : on affiche un écran d'attente qui se
  // met à jour tout seul, plutôt que de tomber dans le rendu normal (qui suppose
  // toujours que le joueur local fait partie de la partie, et plante sinon).
  // Spectateur pour toute partie démarrée (playing / last_turns / finished)
  // tant que le joueur local n'est pas dans state.players.
  if (!stillMember && room.state.status !== 'lobby') {
    renderSpectatorGame(app, {
      room,
      gameLabel: GAME_TITLES[room.game],
      onBackToRooms: () => backToRoomList({ leaveFirst: false })
    });
    return;
  }

  const shouldShowLeftScreen = hasLeftTable || (!stillMember && room.state.status !== 'playing');

  if (shouldShowLeftScreen) {
    if (!hasLeftTable) leftScreenIsWaiting = true; // première entrée sur cet écran sans départ explicite
    hasLeftTable = true;
    renderLeftTable(app, {
      name: currentPlayer.name,
      wasWaiting: leftScreenIsWaiting,
      onRejoin: async () => {
        const rejoined = await ensureMembership(room, currentPlayer);
        const reclaimed = await reclaimStaleHost(rejoined, currentPlayer);
        hasLeftTable = false;
        leftScreenIsWaiting = false;
        draw(reclaimed);
      }
    });
    return;
  }

  try {
    renderGame(app, {
      room,
      player: currentPlayer,
      onLeave: async () => {
        try {
          // Quitter une partie (en cours ou en salle d'attente) ramène toujours
          // directement à la liste des salons — que le salon ait été fermé
          // (dernier humain) ou non (bot-remplacement, ou retrait simple).
          await leaveTable(room, currentPlayer);
          await resetRoomSessionAndShowList();
        } catch (err) {
          alert(err.message || 'Impossible de quitter la table.');
        }
      },
      onKick: async (targetId) => {
        try {
          await kickPlayer(room, targetId);
        } catch (err) {
          alert(err.message || 'Impossible de retirer ce joueur.');
        }
      }
    });
  } catch (err) {
    console.error('Erreur de rendu, affichage de l\'écran de récupération :', err);
    renderCrashRecovery(app, {
      onReset: async () => {
        const reset = await playAgain(room);
        draw(reset);
      }
    });
  }
}

function enterRoom(room, player) {
  currentPlayer = player;

  if (unsubscribe && currentRoomId === room.id) {
    draw(room);
    return;
  }

  if (unsubscribe) unsubscribe();
  currentRoomId = room.id;
  draw(room);
  unsubscribe = watchRoom(room.id, (freshRow) => draw(freshRow));
}

function stopRoomListPolling() {
  if (roomListPollHandle) {
    window.clearInterval(roomListPollHandle);
    roomListPollHandle = null;
  }
}

/**
 * Écran "salons" : liste les tables actives et laisse `profile` en rejoindre
 * une ou en créer une nouvelle. Rafraîchi par un simple sondage (pas
 * d'abonnement Realtime large sur toute la table `game_rooms`), cohérent
 * avec les battements de cœur déjà utilisés ailleurs dans ce fichier.
 */
async function showRoomList(profile) {
  currentPlayer = profile;
  document.title = 'Cartes en famille';
  stopRoomListPolling();

  const renderList = async () => {
    const rooms = await listActiveRooms();
    renderRoomList(app, {
      rooms,
      onJoinRoom: async (roomId) => {
        const room = await fetchRoomById(roomId);
        if (!room) throw new Error('Ce salon n\'existe plus — réessaie.');
        const joined = await ensureMembership(room, profile);
        const reclaimed = await reclaimStaleHost(joined, profile);
        stopRoomListPolling();
        enterRoom(reclaimed, profile);
      },
      onCreateRoom: async () => {
        const created = await createNewRoom();
        const joined = await ensureMembership(created, profile);
        stopRoomListPolling();
        enterRoom(joined, profile);
      }
    });
  };

  await renderList();
  roomListPollHandle = window.setInterval(() => {
    renderList().catch(() => {
      // Pas grave, on retentera au prochain sondage.
    });
  }, 5000);
}

/**
 * Quitte le salon courant (désabonnement Realtime + remise à zéro de tout
 * l'état de session propre à une table) et revient à l'écran des salons.
 * `leaveFirst` : true si le joueur était bien dans `state.players` de ce
 * salon (salle d'attente) — il faut alors appeler `leaveTable` pour que le
 * compteur de joueurs reste juste pour les autres. false pour un
 * spectateur, jamais ajouté à `state.players`, donc rien à annuler côté
 * serveur.
 */
async function backToRoomList({ leaveFirst }) {
  if (leaveFirst && currentRoomRef && currentPlayer) {
    try {
      await leaveTable(currentRoomRef, currentPlayer);
    } catch (err) {
      // Pas grave si ça échoue (ex: déjà retiré) — on quitte l'écran quand même.
    }
  }
  await resetRoomSessionAndShowList();
}

/**
 * Remise à zéro de tout l'état de session propre à une table (désabonnement
 * Realtime compris) puis retour à l'écran des salons. Ne s'occupe PAS de
 * quitter le salon côté serveur — c'est à l'appelant de le faire avant, si
 * besoin (voir `backToRoomList` et le `onLeave` de `draw()`, qui appellent
 * `leaveTable` chacun à leur façon avant d'arriver ici).
 */
async function resetRoomSessionAndShowList() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  stopRelay();
  currentRoomId = null;
  currentRoomRef = null;
  hasLeftTable = false;
  leftScreenIsWaiting = false;
  lastRelayHostId = undefined;
  lastReportedRelayActive = null;
  await showRoomList(currentPlayer);
}

applySettings();
mountSettingsButton();

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const profile = getLocalProfile();

  if (!profile) {
    renderNamePrompt(app, {
      onSubmit: async (name) => {
        const newProfile = createLocalIdentity(name);
        await showRoomList(newProfile);
      }
    });
    return;
  }

  await showRoomList(profile);
}

// Battement de cœur : tant que cet appareil est ouvert et que son utilisateur
// est hôte d'une table en salle d'attente, on signale régulièrement sa présence
// pour éviter qu'un autre appareil ne le remplace par erreur au bout de 2 minutes.
// Doublé d'un battement plus général (n'importe quel joueur, n'importe quel
// statut) qui alimente `reclaimStalePlayers` : un appareil actif dans le salon
// remplace automatiquement par un bot (ou ferme le salon, ou interrompt la
// partie côté hôte — voir `computeLeaveOutcome`) toute personne qui n'a plus
// donné signe de vie depuis 2 minutes, sans qu'elle ait cliqué sur "quitter"
// (onglet fermé, téléphone verrouillé, réseau perdu…).
window.setInterval(async () => {
  if (!currentRoomRef || !currentPlayer) return;
  try {
    currentRoomRef = await pingHostPresence(currentRoomRef, currentPlayer);
    currentRoomRef = await pingPlayerPresence(currentRoomRef, currentPlayer);
    const afterSweep = await reclaimStalePlayers(currentRoomRef, currentPlayer);
    if (afterSweep === null) {
      await resetRoomSessionAndShowList();
      return;
    }
    currentRoomRef = afterSweep;
  } catch (err) {
    // Pas grave, on retentera au prochain battement.
  }
}, 45000);

// Pousse dans `room.state.connections` le statut de liaison directe, pour que
// le 🔌 à côté du prénom soit visible par tout le monde. Déclenché dès qu'une
// liaison s'ouvre/se ferme (événement) et en secours toutes les 3 s.
async function pushRelayStatusIfChanged() {
  if (!currentRoomRef || !currentPlayer) return;
  const active = isRelayActive();
  if (active === lastReportedRelayActive) return;
  try {
    currentRoomRef = await reportRelayStatus(currentRoomRef, currentPlayer.id, active);
    lastReportedRelayActive = active;
  } catch (err) {
    // Pas grave, on retentera au prochain battement / événement.
  }
}

window.addEventListener('cartes-relay-status', () => {
  pushRelayStatusIfChanged();
});

window.setInterval(() => {
  pushRelayStatusIfChanged();
}, 3000);

boot();
