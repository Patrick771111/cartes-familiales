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
  isRelayActive
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

// Politique du bot au Trou du Cul : toujours jouer l'ensemble le plus faible
// possible (pour relancer un pli libre comme pour battre — ou copier — le pli
// en cours), sinon passer. Respecte le verrouillage de rang (rankLocked) une
// fois qu'une copie a eu lieu. Aucune anticipation plus poussée — basique assumé.
function chooseTrouducMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'pass' };
  const groups = new Map();
  for (const card of bot.hand) {
    if (!groups.has(card.rank)) groups.set(card.rank, []);
    groups.get(card.rank).push(card);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => trouducRankValue(a[0]) - trouducRankValue(b[0]));

  if (state.pileCount === 0) {
    const [, cards] = sortedGroups[0];
    return { type: 'play', cardIds: cards.map((c) => c.id) };
  }

  const pileRankValue = trouducRankValue(state.pileRank);
  for (const [rank, cards] of sortedGroups) {
    if (cards.length < state.pileCount) continue;
    const rv = trouducRankValue(rank);
    const legal = state.rankLocked ? rv === pileRankValue : rv >= pileRankValue;
    if (legal) {
      return { type: 'play', cardIds: cards.slice(0, state.pileCount).map((c) => c.id) };
    }
  }
  return { type: 'pass' };
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

// Politique du bot au 8 américain : joue la première carte légale trouvée en
// main (en gardant les 8 pour la fin s'il a mieux à jouer), sinon pioche. En
// jouant un 8, choisit la couleur la plus représentée dans le reste de sa main
// pour maximiser ses coups suivants. Aucune anticipation plus poussée.
function chooseAmericainMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'draw' };

  const legalCards = bot.hand.filter((c) => americainIsLegalCard(state, c));
  if (!legalCards.length) return { type: 'draw' };

  const card = legalCards.find((c) => c.rank !== '8') || legalCards[0];
  if (card.rank !== '8') return { type: 'play', cardId: card.id };

  const remaining = bot.hand.filter((c) => c.id !== card.id);
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  remaining.forEach((c) => { counts[c.suit] = (counts[c.suit] || 0) + 1; });
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

// Politique du bot au Blackjack : tire tant que son total est inférieur à 17,
// sinon reste — même seuil que la banque, aucune stratégie plus fine (ne
// compte pas les cartes, ne tient pas compte de la carte visible de la
// banque). La banque elle-même n'a pas besoin d'être planifiée ici : elle
// n'est pas un "joueur", elle joue automatiquement et de façon synchrone dans
// `blackjack.js` dès que le dernier joueur a fini son tour.
function chooseBlackjackMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stand' };
  return blackjackHandTotal(bot.hand) < 17 ? { type: 'hit' } : { type: 'stand' };
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

// Politique du bot à Flip 7 : flippe tant qu'il a moins de 5 numéros uniques
// en main, reste au-delà — aucune stratégie plus fine (ne tient pas compte des
// cartes déjà sorties, ni de son score cumulé par rapport aux autres).
function chooseFlip7Move(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'stay' };
  const uniqueCount = bot.display.filter((c) => c.kind === 'number').length;
  return uniqueCount < 5 ? { type: 'hit' } : { type: 'stay' };
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

// Politique du bot à Skyjo : prend la défausse si elle vaut 3 ou moins (bonne
// carte connue), sinon pioche à l'aveugle. Pour placer : remplace sa pire
// carte visible si la carte en main est meilleure ; sinon défausse et
// retourne une case cachée au hasard (une pioche du sabot seulement — une
// carte prise à la défausse doit être placée) ; sinon, faute de case cachée,
// place quand même sur sa pire carte visible. Aucune anticipation plus fine
// (ne compte pas les cartes déjà vues, ne réagit pas aux grilles adverses).
function chooseSkyjoDrawSource(state, botId) {
  const topDiscard = state.discard[state.discard.length - 1];
  return topDiscard && topDiscard.value <= 3 ? 'discard' : 'deck';
}

function chooseSkyjoPlacement(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const drawnValue = state.drawnCard.card.value;
  const grid = bot.grid;

  let worstIndex = -1;
  let worstValue = -Infinity;
  grid.forEach((cell, i) => {
    if (cell && cell.faceUp && cell.card.value > worstValue) {
      worstValue = cell.card.value;
      worstIndex = i;
    }
  });
  const hiddenIndexes = grid.map((c, i) => (c && !c.faceUp ? i : -1)).filter((i) => i !== -1);

  if (worstIndex !== -1 && drawnValue < worstValue) {
    return { type: 'place', index: worstIndex };
  }
  if (state.drawnCard.source === 'deck' && hiddenIndexes.length) {
    return { type: 'reveal', index: hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)] };
  }
  if (hiddenIndexes.length) {
    return { type: 'place', index: hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)] };
  }
  if (worstIndex !== -1) return { type: 'place', index: worstIndex };
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

// Politique du bot à la Suite Infernale : pose son numéro/joker suivant dès
// qu'il l'a en main ; sinon "Rejouer" s'il en a une ; sinon une carte
// d'attaque au hasard contre un adversaire choisi au hasard parmi les cibles
// valides (case au hasard pour "retirer/voler 1 carte") ; sinon défausse une
// carte qui n'est pas un STOP (gardé pour se défendre) si possible. Ne
// priorise pas un type d'attaque plutôt qu'un autre, ne calcule pas l'impact
// de ses coups sur les autres joueurs.
function chooseSuiteInfernaleMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const neededIndex = bot.sequence.findIndex((c) => !c);
  const filledCount = bot.sequence.filter(Boolean).length;

  if (neededIndex !== -1) {
    const numberCard = bot.hand.find((c) => c.kind === 'number' && c.value === neededIndex + 1);
    if (numberCard) return { type: 'sequence', cardId: numberCard.id };

    const joker1 = bot.hand.find((c) => c.kind === 'special' && c.type === 'jokerPlus1');
    if (joker1) return { type: 'sequence', cardId: joker1.id };

    const joker2 = bot.hand.find((c) => c.kind === 'special' && c.type === 'jokerPlus2');
    if (joker2 && filledCount > 0 && neededIndex + 1 < 8) return { type: 'sequence', cardId: joker2.id };
  }

  const rejouer = bot.hand.find((c) => c.kind === 'special' && c.type === 'rejouer');
  if (rejouer) return { type: 'rejouer', cardId: rejouer.id };

  const attackCards = bot.hand.filter((c) => c.kind === 'special' && SUITE_INFERNALE_ATTACK_TYPES.includes(c.type));
  for (const card of shuffleCopy(attackCards)) {
    const opponents = state.players.filter((p) => p.id !== botId);
    const validTargets = opponents.filter((o) => {
      if (card.type === 'volerDerniere') return suiteInfernaleHighestFilledIndex(o.sequence) !== -1;
      if (card.type === 'retirerDeux') {
        const h = suiteInfernaleHighestFilledIndex(o.sequence);
        return h >= 1 && o.sequence[h] && o.sequence[h - 1];
      }
      if (card.type === 'volerUne' || card.type === 'retirerUne') return o.sequence.some(Boolean);
      return true; // echangerJeu, changerPlace
    });
    if (!validTargets.length) continue;
    const target = validTargets[Math.floor(Math.random() * validTargets.length)];
    let slotIndex = null;
    if (card.type === 'volerUne' || card.type === 'retirerUne') {
      const indexes = suiteInfernaleFilledIndexes(target.sequence);
      slotIndex = indexes[Math.floor(Math.random() * indexes.length)];
    }
    return { type: 'attack', cardId: card.id, targetId: target.id, slotIndex };
  }

  const discardCard = bot.hand.find((c) => !(c.kind === 'special' && c.type === 'stop')) || bot.hand[0];
  return { type: 'discard', cardId: discardCard.id };
}

function shuffleCopy(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Réaction du bot face à une attaque en attente : bloque avec un STOP s'il en a un, sinon laisse passer. */
function chooseSuiteInfernaleReaction(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const stopCard = bot.hand.find((c) => c.kind === 'special' && c.type === 'stop');
  return stopCard ? { block: true, stopCardId: stopCard.id } : { block: false };
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

// Politique du bot aux Cinq Rois : à la pioche, prend la défausse si elle est
// utile (même rang en main, atout, ou faible pénalité), sinon pioche à
// l'aveugle dans le talon. À la défausse : pose sa main entière dès que
// c'est possible, sinon se débarrasse de la carte la plus coûteuse en
// pénalité. Aucune anticipation plus fine (ne calcule pas les combinaisons
// optimales, ne tient pas compte des mains adverses).
function chooseCinqRoisMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return null;
  if (state.phase === 'draw') {
    const top = state.discard[state.discard.length - 1];
    if (top) {
      const ranksInHand = new Set(bot.hand.filter((c) => !c.isJoker).map((c) => c.rank));
      const useful =
        !top.isJoker &&
        (ranksInHand.has(top.rank) || top.rank === state.trumpRank || cinqRoisCardPenalty(top, state.trumpRank) <= 5);
      if (useful) return { type: 'draw_discard' };
    }
    return { type: 'draw_stock' };
  }

  const hand = bot.hand.slice();
  let bestGoOut = null;
  let bestDiscard = hand[0];
  let bestPenalty = -1;
  for (const card of hand) {
    const remaining = hand.filter((c) => c.id !== card.id);
    if (state.status === 'playing' && remaining.length >= 3 && cinqRoisCanGoOut(remaining, state.trumpRank)) {
      bestGoOut = card;
      break;
    }
    const pen = cinqRoisCardPenalty(card, state.trumpRank);
    if (pen > bestPenalty) { bestPenalty = pen; bestDiscard = card; }
  }
  if (bestGoOut) return { type: 'discard', cardId: bestGoOut.id, goOut: true };
  return { type: 'discard', cardId: bestDiscard.id, goOut: false };
}

let scheduledCinqRoisBotMove = null;


// Politique du bot à Lucky Numbers : défausse utile → pioche → place / défausse.
function lnValidPlacements(board, value) {
  const DIM = 4;
  const out = [];
  for (let index = 0; index < 16; index++) {
    const row = Math.floor(index / DIM);
    const col = index % DIM;
    let ok = true;
    for (let c = 0; c < DIM && ok; c++) {
      const i = row * DIM + c;
      if (i === index || !board[i]) continue;
      if (c < col && board[i].value >= value) ok = false;
      if (c > col && board[i].value <= value) ok = false;
    }
    for (let r = 0; r < DIM && ok; r++) {
      const i = r * DIM + col;
      if (i === index || !board[i]) continue;
      if (r < row && board[i].value >= value) ok = false;
      if (r > row && board[i].value <= value) ok = false;
    }
    if (ok) out.push(index);
  }
  return out;
}

function chooseLuckyNumbersMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'discard' };

  if (state.drawnTile) {
    const tile = state.drawnTile;
    const placements = lnValidPlacements(bot.board, tile.value);
    if (!placements.length) return { type: 'discard' };
    placements.sort((a, b) => {
      const emptyA = bot.board[a] ? 1 : 0;
      const emptyB = bot.board[b] ? 1 : 0;
      if (emptyA !== emptyB) return emptyA - emptyB;
      return (bot.board[b]?.value || 0) - (bot.board[a]?.value || 0);
    });
    return { type: 'place', index: placements[0] };
  }

  for (const tile of state.discard.slice().reverse()) {
    const empties = lnValidPlacements(bot.board, tile.value).filter((i) => !bot.board[i]);
    if (empties.length) return { type: 'take', tileId: tile.id, index: empties[0] };
  }
  for (const tile of state.discard.slice().reverse()) {
    const swaps = lnValidPlacements(bot.board, tile.value).filter((i) => bot.board[i]);
    if (swaps.length) {
      swaps.sort((a, b) => (bot.board[b]?.value || 0) - (bot.board[a]?.value || 0));
      return { type: 'take', tileId: tile.id, index: swaps[0] };
    }
  }
  if (state.stock.length > 0) return { type: 'draw' };
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
  if (hostId === lastRelayHostId) return;
  lastRelayHostId = hostId;
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
  if (!stillMember && room.state.status === 'playing') {
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

// Battement de cœur dédié, plus rapproché : pousse dans `room.state.connections`
// tout changement de `isRelayActive()` (liaison directe armée/coupée), pour que
// le 🔌 à côté du prénom soit visible par tout le monde, pas seulement sur
// l'appareil concerné. Ne pousse que sur un vrai changement de valeur.
window.setInterval(async () => {
  if (!currentRoomRef || !currentPlayer) return;
  const active = isRelayActive();
  if (active === lastReportedRelayActive) return;
  try {
    currentRoomRef = await reportRelayStatus(currentRoomRef, currentPlayer.id, active);
    lastReportedRelayActive = active;
  } catch (err) {
    // Pas grave, on retentera au prochain battement.
  }
}, 3000);

boot();
