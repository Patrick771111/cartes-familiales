import { fetchRoomById, commitGameAction } from './core.js';
import {
  applyRevealCenter as applyTrioRevealCenter,
  applyRevealRow as applyTrioRevealRow,
  applyConfirmTurn as applyTrioConfirmTurn
} from './trio.js';

function revealTrioCenter(room, playerId, cardId) {
  return commitGameAction(room, (state) => applyTrioRevealCenter(state, playerId, cardId));
}
function revealTrioRow(room, playerId, targetPlayerId, end) {
  return commitGameAction(room, (state) => applyTrioRevealRow(state, playerId, targetPlayerId, end));
}
function confirmTrioTurn(room, playerId) {
  return commitGameAction(room, (state) => applyTrioConfirmTurn(state, playerId));
}

/**
 * Politique du bot à Trio : aucune "mémoire" entre les tours (chaque appel
 * ne voit que l'état courant, pas l'historique) — choisit une source de
 * révélation légale au hasard, comme un joueur humain sans entraînement
 * particulier. Ne triche pas en comparant des valeurs cachées entre elles
 * avant de révéler.
 */
function legalReveals(state) {
  const options = [];
  for (const c of state.center) {
    if (!c.taken && !state.pendingReveals.some((r) => r.source.cardId === c.id)) {
      options.push({ type: 'center', cardId: c.id });
    }
  }
  for (const p of state.players) {
    if (!p.row.length) continue;
    const low = p.row[0];
    const high = p.row[p.row.length - 1];
    if (!state.pendingReveals.some((r) => r.source.cardId === low.id)) {
      options.push({ type: 'row', targetPlayerId: p.id, end: 'low' });
    }
    if (high.id !== low.id && !state.pendingReveals.some((r) => r.source.cardId === high.id)) {
      options.push({ type: 'row', targetPlayerId: p.id, end: 'high' });
    }
  }
  return options;
}

export function chooseMove(state, botId) {
  if (state.turnOutcome) return { type: 'confirm' };
  const options = legalReveals(state);
  if (!options.length) return { type: 'confirm' }; // filet de sécurité, ne devrait pas arriver en cours de partie
  return options[Math.floor(Math.random() * options.length)];
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;

  const currentId = room.state.currentPlayerId;
  const bot = room.state.players.find((p) => p.id === currentId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return;
  scheduled = signature;

  // Pas de bouton "Continuer" côté joueur (voir src/ui/games/trio.js) : même
  // pause fixe d'une seconde ici quand il ne reste qu'à confirmer le
  // résultat de la tentative — pas besoin de variabilité aléatoire pour ce
  // pas-là, qui ne simule pas une "réflexion" mais juste le temps de lire.
  const delay = room.state.turnOutcome ? 1000 : 700 + Math.random() * 600;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== currentId) return;

      const move = chooseMove(fresh.state, currentId);
      if (move.type === 'confirm') {
        await confirmTrioTurn(fresh, currentId);
      } else if (move.type === 'center') {
        await revealTrioCenter(fresh, currentId, move.cardId);
      } else if (move.type === 'row') {
        await revealTrioRow(fresh, currentId, move.targetPlayerId, move.end);
      }
    } catch (err) {
      // Un autre appareil a probablement déjà joué / confirmé.
    }
  }, delay);
}
