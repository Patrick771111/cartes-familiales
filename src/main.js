import './style.css';
import { renderNamePrompt, renderLeftTable } from './ui/lobby.js';
import { renderGame } from './ui/game.js';
import {
  getLocalProfile,
  ensureFamilyRoom,
  ensureMembership,
  createIdentityAndJoin,
  renameLocalPlayer,
  leaveTable,
  kickPlayer,
  watchRoom
} from './game/engine.js';

const app = document.getElementById('app');
let unsubscribe = null;
let currentPlayer = null;
let currentRoomId = null;
let hasLeftTable = false;

function draw(room) {
  const stillMember = room.state.players.some((p) => p.id === currentPlayer.id);
  const shouldShowLeftScreen = hasLeftTable || (!stillMember && room.state.status !== 'playing');

  if (shouldShowLeftScreen) {
    hasLeftTable = true;
    renderLeftTable(app, {
      name: currentPlayer.name,
      onRejoin: async () => {
        const rejoined = await ensureMembership(room, currentPlayer);
        hasLeftTable = false;
        draw(rejoined);
      }
    });
    return;
  }

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
        enterRoom(joinedRoom, player);
      }
    });
    return;
  }

  const joinedRoom = await ensureMembership(room, profile);
  enterRoom(joinedRoom, profile);
}

boot();
