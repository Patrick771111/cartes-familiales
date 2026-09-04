import { fetchRoomById, commitGameAction } from './core.js';
import {
  applyDrawFromDeck as applySkyjoDrawDeck,
  applyDrawFromDiscard as applySkyjoDrawDiscard,
  applyPlaceCard as applySkyjoPlaceCard,
  applyDiscardAndReveal as applySkyjoDiscardAndReveal
} from './skyjo.js';

function drawSkyjoFromDeck(room, playerId) {
  return commitGameAction(room, (state) => applySkyjoDrawDeck(state, playerId));
}

function drawSkyjoFromDiscard(room, playerId) {
  return commitGameAction(room, (state) => applySkyjoDrawDiscard(state, playerId));
}

function placeSkyjoCard(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applySkyjoPlaceCard(state, playerId, gridIndex));
}

function discardSkyjoAndReveal(room, playerId, gridIndex) {
  return commitGameAction(room, (state) => applySkyjoDiscardAndReveal(state, playerId, gridIndex));
}

// Politique du bot à Skyjo (passe 3) :
// - course : si un adversaire a presque tout révélé, accélère
// - colonnes : priorité annulation, évite de casser une colonne prometteuse
// - défausse / placement selon gain de points net
function skyjoColumnInfo(grid, col) {
  const idxs = [col, col + 4, col + 8];
  const cells = idxs.map((i) => grid[i]);
  const faceUp = cells.filter((c) => c && c.faceUp);
  const hidden = idxs.filter((i) => grid[i] && !grid[i].faceUp);
  const vals = faceUp.map((c) => c.card.value);
  return { idxs, faceUp, hidden, vals };
}

function skyjoHiddenCount(grid) {
  return grid.filter((c) => c && !c.faceUp).length;
}

export function chooseDrawSource(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const topDiscard = state.discard[state.discard.length - 1];
  if (!topDiscard || !bot) return 'deck';
  const v = topDiscard.value;

  for (let col = 0; col < 4; col++) {
    const { vals } = skyjoColumnInfo(bot.grid, col);
    if (vals.length === 2 && vals[0] === vals[1] && v === vals[0]) return 'discard';
    if (vals.length === 1 && vals[0] === v) return 'discard';
  }

  let worstVisible = -Infinity;
  for (const cell of bot.grid) {
    if (cell?.faceUp) worstVisible = Math.max(worstVisible, cell.card.value);
  }
  if (v <= 3) return 'discard';
  if (v <= 5 && worstVisible >= 8) return 'discard';
  if (worstVisible > -Infinity && v <= worstVisible - 2) return 'discard';

  // Fin de manche imminente chez un adversaire : accepter des cartes moyennes
  const minOppHidden = Math.min(
    12,
    ...state.players.filter((p) => p.id !== botId).map((p) => skyjoHiddenCount(p.grid || []))
  );
  if (minOppHidden <= 2 && v <= 7 && worstVisible >= v + 1) return 'discard';
  return 'deck';
}

export function choosePlacement(state, botId) {
  const bot = state.players.find((p) => p.id === botId);
  const drawnValue = state.drawnCard.card.value;
  const grid = bot.grid;
  const fromDeck = state.drawnCard.source === 'deck';

  // 1) Annulation / construction de colonne
  for (let col = 0; col < 4; col++) {
    const { vals, hidden, idxs } = skyjoColumnInfo(grid, col);
    if (vals.length === 2 && vals[0] === vals[1] && drawnValue === vals[0]) {
      if (hidden.length) return { type: 'place', index: hidden[0] };
      const rep = idxs.find((i) => grid[i]?.faceUp);
      if (rep !== undefined) return { type: 'place', index: rep };
    }
    if (vals.length === 1 && vals[0] === drawnValue && hidden.length) {
      return { type: 'place', index: hidden[0] };
    }
  }

  // 2) Meilleur remplacement visible (sans casser une paire de colonne)
  let bestReplace = null;
  let bestGain = 0;
  grid.forEach((cell, i) => {
    if (!cell?.faceUp) return;
    const col = i % 4;
    const { vals } = skyjoColumnInfo(grid, col);
    // Ne pas casser une double identique sauf gain énorme
    if (vals.length === 2 && vals[0] === vals[1] && cell.card.value === vals[0] && drawnValue !== vals[0]) {
      if (cell.card.value - drawnValue < 8) return;
    }
    const gain = cell.card.value - drawnValue;
    if (gain > bestGain) {
      bestGain = gain;
      bestReplace = i;
    }
  });
  if (bestReplace !== null && bestGain >= 2) return { type: 'place', index: bestReplace };

  const hiddenIndexes = grid.map((c, i) => (c && !c.faceUp ? i : -1)).filter((i) => i !== -1);
  const minOppHidden = Math.min(
    12,
    ...state.players.filter((p) => p.id !== botId).map((p) => skyjoHiddenCount(p.grid || []))
  );

  // 3) Pioche sabot : révéler (surtout en course) plutôt que poser une carte moyenne
  if (fromDeck && hiddenIndexes.length) {
    if (drawnValue <= 2 && bestReplace !== null && bestGain > 0) {
      return { type: 'place', index: bestReplace };
    }
    // En course adverse, révéler pour finir
    const scored = hiddenIndexes.map((i) => {
      const col = i % 4;
      const { vals } = skyjoColumnInfo(grid, col);
      let s = vals.length * 4;
      if (minOppHidden <= 3) s += 5;
      s -= Math.abs(col - 1.5);
      return { i, s };
    });
    scored.sort((a, b) => b.s - a.s);
    if (drawnValue >= 7 || bestGain < 2) return { type: 'reveal', index: scored[0].i };
    if (bestReplace !== null && bestGain >= 1) return { type: 'place', index: bestReplace };
    return { type: 'reveal', index: scored[0].i };
  }

  if (bestReplace !== null && bestGain > 0) return { type: 'place', index: bestReplace };
  if (hiddenIndexes.length) return { type: 'place', index: hiddenIndexes[0] };
  if (bestReplace !== null) return { type: 'place', index: bestReplace };
  return { type: 'place', index: grid.findIndex((c) => c) };
}

let scheduled = null;
let turnLock = null;

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function playDrawnCard(fresh, currentId) {
  if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;
  if (!fresh.state.drawnCard) return;

  const move = choosePlacement(fresh.state, currentId);
  const grid = fresh.state.players.find((p) => p.id === currentId)?.grid || [];
  const index = move?.index;
  const cell = Number.isInteger(index) ? grid[index] : null;
  if (!cell) {
    const fallback = grid.findIndex((c) => c);
    if (fallback < 0) return;
    await placeSkyjoCard(fresh, currentId, fallback);
    return;
  }

  if (move.type === 'reveal' && fresh.state.drawnCard.source === 'deck' && !cell.faceUp) {
    await discardSkyjoAndReveal(fresh, currentId, index);
  } else {
    await placeSkyjoCard(fresh, currentId, index);
  }
}

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const lock = `${room.id}:${currentId}`;
  if (turnLock === lock) return;

  const step = room.state.drawnCard ? 'place' : 'draw';
  const signature = `${room.id}:${room.version}:${currentId}:${step}`;
  if (scheduled === signature) return;
  scheduled = signature;

  const delay = step === 'draw' ? 550 + Math.random() * 350 : 1100 + Math.random() * 400;

  window.setTimeout(async () => {
    try {
      let fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      if (!fresh.state.drawnCard) {
        turnLock = lock;
        try {
          const source = chooseDrawSource(fresh.state, currentId);
          if (source === 'discard' && fresh.state.discard?.length) {
            fresh = await drawSkyjoFromDiscard(fresh, currentId);
          } else {
            fresh = await drawSkyjoFromDeck(fresh, currentId);
          }
          await wait(1100 + Math.random() * 400);
          fresh = await fetchRoomById(room.id);
          await playDrawnCard(fresh, currentId);
        } finally {
          turnLock = null;
        }
        return;
      }

      await playDrawnCard(fresh, currentId);
    } catch (err) {
      scheduled = null;
      turnLock = null;
    }
  }, delay);
}
