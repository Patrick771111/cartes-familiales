import './style.css';
import { renderLobby } from './ui/lobby.js';
import { renderGame } from './ui/game.js';
import { getLocalPlayer, watchRoom, fetchRoomByCode } from './game/engine.js';

const app = document.getElementById('app');
let unsubscribe = null;

function stopWatching() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}

function goToLobby(prefillCode = '') {
  stopWatching();
  const url = new URL(window.location.href);
  url.search = '';
  window.history.replaceState({}, '', url);
  renderLobby(app, { prefillCode, onEntered: enterRoom });
}

function enterRoom(room, player) {
  const url = new URL(window.location.href);
  url.search = `?room=${room.code}`;
  window.history.replaceState({}, '', url);

  stopWatching();
  renderGame(app, { room, player, onLeave: () => goToLobby() });

  unsubscribe = watchRoom(room.id, (freshRow) => {
    renderGame(app, { room: freshRow, player, onLeave: () => goToLobby() });
  });
}

async function boot() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  const codeFromUrl = params.get('room');

  if (codeFromUrl) {
    const localPlayer = getLocalPlayer(codeFromUrl);
    const room = await fetchRoomByCode(codeFromUrl);
    if (room && localPlayer && room.state.players.some((p) => p.id === localPlayer.id)) {
      enterRoom(room, localPlayer);
      return;
    }
    // Lien reçu d'un proche, ou session perdue : on préremplit le code dans le lobby.
    goToLobby(codeFromUrl.toUpperCase());
    return;
  }

  goToLobby();
}

boot();
