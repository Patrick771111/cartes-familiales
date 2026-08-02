import './style.css';
import { renderNamePrompt, renderLeftTable } from './ui/lobby.js';
import { renderGame, renderSpectatorGame } from './ui/game.js';
import {
  getLocalProfile,
  ensureFamilyRoom,
  ensureMembership,
  createIdentityAndJoin,
  renameLocalPlayer,
  leaveTable,
  kickPlayer,
  drawForCurrentPlayer,
  playCards,
  passTurn,
  submitExchangeGift,
  reclaimStaleHost,
  pingHostPresence,
  playAgain,
  fetchRoomById,
  watchRoom
} from './game/engine.js';
import { playerToDrawFrom } from './game/pouilleux.js';
import { rankValue as trouducRankValue } from './game/trouduc.js';

const app = document.getElementById('app');
let unsubscribe = null;
let currentPlayer = null;
let currentRoomId = null;
let hasLeftTable = false;
// Pourquoi on affiche l'écran "pas à la table" : un départ volontaire, ou juste
// une attente pendant qu'une partie tournait sans nous. Fixé une fois à l'entrée
// sur cet écran, pour ne pas changer de message à chaque re-rendu.
let leftScreenIsWaiting = false;

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

const GAME_TITLES = { pouilleux: 'Le Pouilleux', trouduc: 'Le Trou du Cul' };

function updateDocumentTitle(room) {
  const gameLabel = GAME_TITLES[room.game];
  document.title = gameLabel ? `${gameLabel} — Cartes en famille` : 'Cartes en famille';
}

let currentRoomRef = null;

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

function draw(room) {
  currentRoomRef = room;
  updateDocumentTitle(room);
  maybeScheduleBotMove(room);
  maybeScheduleTrouducExchangeBot(room);
  maybeScheduleTrouducBotMove(room);

  const stillMember = room.state.players.some((p) => p.id === currentPlayer.id);

  // Une partie est en cours et je n'en fais pas partie (ex: quelqu'un d'autre a lancé
  // une manche avant que je ne rejoigne) : on affiche un écran d'attente qui se
  // met à jour tout seul, plutôt que de tomber dans le rendu normal (qui suppose
  // toujours que le joueur local fait partie de la partie, et plante sinon).
  if (!stillMember && room.state.status === 'playing') {
    renderSpectatorGame(app, { room, gameLabel: GAME_TITLES[room.game] });
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
      onRename: async (newName) => {
        try {
          const { room: updatedRoom, player: updatedProfile } = await renameLocalPlayer(room, currentPlayer, newName);
          currentPlayer = updatedProfile;
          draw(updatedRoom);
        } catch (err) {
          alert(err.message || 'Impossible de changer le prénom.');
        }
      },
      onLeave: async () => {
        try {
          await leaveTable(room, currentPlayer);
          hasLeftTable = true;
          leftScreenIsWaiting = false;
          draw(room);
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

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const room = await ensureFamilyRoom();
  const profile = getLocalProfile();

  if (!profile) {
    renderNamePrompt(app, {
      onSubmit: async (name) => {
        const { room: joinedRoom, player } = await createIdentityAndJoin(room, name);
        const reclaimed = await reclaimStaleHost(joinedRoom, player);
        enterRoom(reclaimed, player);
      }
    });
    return;
  }

  const joinedRoom = await ensureMembership(room, profile);
  const reclaimed = await reclaimStaleHost(joinedRoom, profile);
  enterRoom(reclaimed, profile);
}

// Battement de cœur : tant que cet appareil est ouvert et que son utilisateur
// est hôte d'une table en salle d'attente, on signale régulièrement sa présence
// pour éviter qu'un autre appareil ne le remplace par erreur au bout de 2 minutes.
window.setInterval(async () => {
  if (!currentRoomRef || !currentPlayer) return;
  try {
    currentRoomRef = await pingHostPresence(currentRoomRef, currentPlayer);
  } catch (err) {
    // Pas grave, on retentera au prochain battement.
  }
}, 45000);

boot();
