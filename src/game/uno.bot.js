import { fetchRoomById, updateRoomState } from './core.js';
import {
  applyPlay as applyUnoPlay,
  applyDraw as applyUnoDraw,
  applyCallUno as applyUnoCallUno,
  applyCatchUno as applyUnoCatchUno,
  isLegalCard as unoIsLegalCard,
  COLORS
} from './uno.js';

function playUnoCard(room, playerId, cardId, chosenColor) {
  const newState = applyUnoPlay(room.state, playerId, cardId, chosenColor);
  return updateRoomState(room.id, room.version, newState);
}

function drawUnoCard(room, playerId) {
  const newState = applyUnoDraw(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

function callUno(room, playerId) {
  const newState = applyUnoCallUno(room.state, playerId);
  return updateRoomState(room.id, room.version, newState);
}

function catchUno(room, playerId, targetPlayerId) {
  const newState = applyUnoCatchUno(room.state, playerId, targetPlayerId);
  return updateRoomState(room.id, room.version, newState);
}

function bestColorFor(hand, excludeCardId) {
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
  hand.forEach((c) => {
    if (c.id !== excludeCardId && c.color) counts[c.color] += 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] > 0 ? sorted[0][0] : COLORS[Math.floor(Math.random() * COLORS.length)];
}

// Politique du bot à Uno :
// - finir dès que possible (une carte jouable en fin de main vaut toujours le coup)
// - garde les Jokers/Joker+4 en réserve (plus utiles tard) sauf urgence
// - privilégie +2/Passer contre l'adversaire le plus proche de gagner
// - Inverser peu utile à 2 joueurs (équivaut à Passer), pénalisé à 3+
// - sous une pile de pioche en attente, `legalCards` ne contient déjà plus
//   que des +2/+4 (voir isLegalCard) : le bot empile s'il peut, pioche sinon
export function chooseMove(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  if (!bot) return { type: 'draw' };

  const legalCards = bot.hand.filter((c) => unoIsLegalCard(state, c));
  if (!legalCards.length) return { type: 'draw' };

  if (bot.hand.length === 1) {
    const card = legalCards[0];
    if (card.kind === 'wild' || card.kind === 'wildDrawFour') {
      return { type: 'play', cardId: card.id, chosenColor: bestColorFor(bot.hand, card.id) };
    }
    return { type: 'play', cardId: card.id };
  }

  const order = state.turnOrder || state.players.map((p) => p.id);
  const dir = state.direction || 1;
  const myIdx = order.indexOf(botId);
  const nextId = order[(myIdx + dir + order.length * 10) % order.length];
  const nextPlayer = state.players.find((p) => p.id === nextId);
  const nextHandSize = nextPlayer?.hand?.length ?? 7;
  const leader = state.players
    .filter((p) => p.id !== botId && !p.finished)
    .sort((a, b) => (a.hand?.length ?? 99) - (b.hand?.length ?? 99))[0];
  const leaderIsNext = leader && leader.id === nextId;

  const kindWeight = (c) => {
    if (c.kind === 'wildDrawFour') return -6; // gardé en réserve, sauf fin de main gérée plus haut
    if (c.kind === 'wild') return -4;
    if (c.kind === 'drawTwo') return (leaderIsNext || nextHandSize <= 3) ? 10 : 2;
    if (c.kind === 'skip') return (leaderIsNext || nextHandSize <= 3) ? 8 : 1;
    if (c.kind === 'reverse') return order.length <= 2 ? -2 : 2;
    return 0;
  };

  const nonWilds = legalCards.filter((c) => c.kind !== 'wild' && c.kind !== 'wildDrawFour');
  const pool = (bot.hand.length <= 2 ? legalCards : nonWilds.length ? nonWilds : legalCards).slice();

  pool.sort((a, b) => kindWeight(b) - kindWeight(a));
  const card = pool[0];

  if (card.kind === 'wild' || card.kind === 'wildDrawFour') {
    return { type: 'play', cardId: card.id, chosenColor: bestColorFor(bot.hand, card.id) };
  }
  return { type: 'play', cardId: card.id };
}

let scheduled = null;
let scheduledSelfUno = null;
let scheduledCatch = null;

/**
 * Signalement/contre-signalement UNO : indépendant du tour de jeu (n'importe
 * quel joueur peut y réagir à tout moment tant que la fenêtre est ouverte),
 * donc évalué à chaque appel de `schedule`, pas seulement quand c'est au bot
 * de jouer.
 * - Un bot qui se retrouve lui-même exposé se signale quasi aussitôt (un
 *   bot ne "triche" jamais sciemment pour lui-même).
 * - Un bot repère un AUTRE joueur (humain ou bot) resté exposé et tente de
 *   le contre-signaler après un court délai, pour donner un peu de tension
 *   plutôt que de laisser la fenêtre filer sans réaction.
 */
function scheduleUnoWindow(room) {
  const exposedId = room.state.unoWindowOpenFor;
  if (!exposedId) return;

  const exposedIsBot = room.state.players.find((p) => p.id === exposedId)?.isBot;
  if (exposedIsBot) {
    const signature = `${room.id}:${room.version}:self:${exposedId}`;
    if (scheduledSelfUno === signature) return;
    scheduledSelfUno = signature;
    window.setTimeout(async () => {
      try {
        const fresh = await fetchRoomById(room.id);
        if (fresh.state.unoWindowOpenFor === exposedId) await callUno(fresh, exposedId);
      } catch (err) {
        // Fenêtre déjà refermée (quelqu'un a joué, ou déjà signalé) — rien à faire.
      }
    }, 250 + Math.random() * 250);
    return;
  }

  const catchers = room.state.players.filter((p) => p.isBot && p.id !== exposedId);
  if (!catchers.length) return;
  const signature = `${room.id}:${room.version}:catch:${exposedId}`;
  if (scheduledCatch === signature) return;
  scheduledCatch = signature;
  const catcher = catchers[Math.floor(Math.random() * catchers.length)];
  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.unoWindowOpenFor === exposedId) await catchUno(fresh, catcher.id, exposedId);
    } catch (err) {
      // Fenêtre déjà refermée (le joueur visé s'est signalé entre-temps, ou quelqu'un a déjà joué).
    }
  }, 1200 + Math.random() * 1500);
}

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  scheduleUnoWindow(room);

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'play') {
        await playUnoCard(fresh, currentId, move.cardId, move.chosenColor);
      } else {
        await drawUnoCard(fresh, currentId);
      }
    } catch (err) {
      // Conflit optimiste attendu si un autre appareil a joué en même temps — la resynchro realtime prend le relais.
    }
  }, 900 + Math.random() * 700);
}
