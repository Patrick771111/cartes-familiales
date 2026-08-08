import { fetchRoomById, updateRoomState } from './core.js';
import {
  applyDraw as applySuiteInfernaleDraw,
  applyPlaySequenceCard as applySuiteInfernalePlaySequenceCard,
  applyPlayRejouer as applySuiteInfernalePlayRejouer,
  applyPlayAttack as applySuiteInfernalePlayAttack,
  applyRespondToAttack as applySuiteInfernaleRespondToAttack,
  applyDiscard as applySuiteInfernaleDiscard
} from './suiteinfernale.js';

function drawSuiteInfernale(room, playerId) {
  const newState = applySuiteInfernaleDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}
function playSuiteInfernaleSequenceCard(room, playerId, cardId) {
  const newState = applySuiteInfernalePlaySequenceCard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}
function playSuiteInfernaleRejouer(room, playerId, cardId) {
  const newState = applySuiteInfernalePlayRejouer(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}
function playSuiteInfernaleAttack(room, playerId, cardId, targetPlayerId, slotIndex = null) {
  const newState = applySuiteInfernalePlayAttack(room.state, playerId, cardId, targetPlayerId, slotIndex);
  return updateRoomState(room.id, room.version, newState);
}
function respondToSuiteInfernaleAttack(room, playerId, { block = false, stopCardId = null } = {}) {
  const newState = applySuiteInfernaleRespondToAttack(room.state, playerId, { block, stopCardId });
  return updateRoomState(room.id, room.version, newState);
}
function discardSuiteInfernale(room, playerId, cardId) {
  const newState = applySuiteInfernaleDiscard(room.state, playerId, cardId);
  return updateRoomState(room.id, room.version, newState);
}

const ATTACK_TYPES = ['volerDerniere', 'volerUne', 'retirerUne', 'retirerDeux', 'echangerJeu', 'changerPlace'];

function highestFilledIndex(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i]) return i;
  }
  return -1;
}

function filledIndexes(sequence) {
  return sequence.map((c, i) => (c ? i : -1)).filter((i) => i !== -1);
}

// Politique du bot à la Suite Infernale (passe 3) :
// - avancer sa suite en priorité (nombre exact > joker+1 > joker+2)
// - n'attaquer que si un adversaire est devant ou à égalité
// - préférer voler/retirer sur le leader ; rejouer seulement si utile
// - garder STOP et les numéros futurs ; défausser le moins utile
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return null;
  const neededIndex = bot.sequence.findIndex((c) => !c);
  const filledCount = bot.sequence.filter(Boolean).length;
  const myProgress = highestFilledIndex(bot.sequence);

  const opponents = state.players.filter((p) => p.id !== botId);
  const leaderProgress = Math.max(-1, ...opponents.map((o) => highestFilledIndex(o.sequence)));
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
    .filter((c) => c.kind === 'special' && ATTACK_TYPES.includes(c.type))
    .sort((a, b) => attackPriority.indexOf(a.type) - attackPriority.indexOf(b.type));

  if (behindLeader >= -1 || leaderProgress >= 4 || myProgress >= 6) {
    for (const card of attackCards) {
      const validTargets = opponents.filter((o) => {
        if (card.type === 'volerDerniere') return highestFilledIndex(o.sequence) !== -1;
        if (card.type === 'retirerDeux') {
          const h = highestFilledIndex(o.sequence);
          return h >= 1 && o.sequence[h] && o.sequence[h - 1];
        }
        if (card.type === 'volerUne' || card.type === 'retirerUne') return o.sequence.some(Boolean);
        if (card.type === 'echangerJeu') {
          const useful = bot.hand.filter(
            (c) => c.kind === 'number' && neededIndex !== -1 && c.value === neededIndex + 1
          ).length;
          return useful === 0 && (o.hand?.length || 0) >= 3;
        }
        return true;
      });
      if (!validTargets.length) continue;
      validTargets.sort(
        (a, b) => highestFilledIndex(b.sequence) - highestFilledIndex(a.sequence)
      );
      const target = validTargets[0];
      if (highestFilledIndex(target.sequence) < myProgress - 3 && attackCards.length > 1) continue;
      let slotIndex = null;
      if (card.type === 'volerUne' || card.type === 'retirerUne') {
        const indexes = filledIndexes(target.sequence);
        // Si on vole : préférer une carte égale à notre prochain numéro
        if (card.type === 'volerUne' && neededIndex !== -1) {
          const needVal = neededIndex + 1;
          const match = indexes.find((i) => target.sequence[i]?.value === needVal);
          slotIndex = match !== undefined ? match : indexes[indexes.length - 1];
        } else {
          slotIndex = indexes[indexes.length - 1];
        }
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

/** Réaction du bot face à une attaque (passe 2) : bloque si l'attaque fait mal, sinon économise le STOP. */
export function chooseReaction(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { block: false };
  const stopCard = bot.hand.find((c) => c.kind === 'special' && c.type === 'stop');
  if (!stopCard) return { block: false };

  const attackType = state.pendingAttack?.type;
  const filled = highestFilledIndex(bot.sequence) + 1;
  // Toujours bloquer les vols / échanges de suite ou de main
  const mustBlock = ['volerDerniere', 'volerUne', 'echangerJeu', 'changerPlace'].includes(attackType);
  // Bloquer un retrait si on a déjà bien avancé
  const blockSoft = ['retirerUne', 'retirerDeux'].includes(attackType) && filled >= 3;
  // En fin de course (7+), bloquer presque tout
  const endgame = filled >= 7;
  if (mustBlock || blockSoft || endgame) return { block: true, stopCardId: stopCard.id };
  return { block: false };
}

let scheduledMove = null;
let scheduledReaction = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  if (room.state.pendingAttack) {
    const targetId = room.state.pendingAttack.targetId;
    const targetBot = room.state.players.find((p) => p.id === targetId && p.isBot);
    if (!targetBot) return;

    const signature = `${room.id}:${room.version}:reaction`;
    if (scheduledReaction === signature) return;
    scheduledReaction = signature;

    window.setTimeout(async () => {
      try {
        const fresh = await fetchRoomById(room.id);
        if (!fresh.state.pendingAttack || fresh.state.pendingAttack.targetId !== targetId) return;
        const reaction = chooseReaction(fresh.state, targetId);
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
  if (scheduledMove === signature) return;
  scheduledMove = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId || fresh.state.pendingAttack) return;

      if (!fresh.state.hasDrawnThisTurn) {
        await drawSuiteInfernale(fresh, currentId);
        return;
      }

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'sequence') await playSuiteInfernaleSequenceCard(fresh, currentId, move.cardId);
      else if (move.type === 'rejouer') await playSuiteInfernaleRejouer(fresh, currentId, move.cardId);
      else if (move.type === 'attack') await playSuiteInfernaleAttack(fresh, currentId, move.cardId, move.targetId, move.slotIndex);
      else await discardSuiteInfernale(fresh, currentId, move.cardId);
    } catch (err) {
      // Idem : un autre appareil a probablement déjà joué, la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
