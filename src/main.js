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
  leaveOtherRooms,
  kickPlayer,
  reclaimStaleHost,
  pingHostPresence,
  pingPlayerPresence,
  reclaimStalePlayers,
  reportRelayStatus,
  playAgain,
  fetchRoomById,
  fetchRoomByCode,
  watchRoom,
  initRelay,
  isRelayActive,
  stopRelay
} from './game/engine.js';

// Un bot par jeu (src/game/<id>.bot.js), découvert dynamiquement — ajouter un
// jeu avec bot = ajouter son fichier, rien à modifier ici. Chaque module
// exporte `schedule(room)` (et éventuellement d'autres planificateurs, ex.
// `scheduleExchange` pour le Trou du Cul) — voir maybeScheduleBotMove.
const botModules = import.meta.glob('./game/*.bot.js', { eager: true });
const BOT_MODULES = {};
for (const path in botModules) {
  const id = path.match(/\/([^/]+)\.bot\.js$/)?.[1];
  if (id) BOT_MODULES[id] = botModules[path];
}

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


const GAME_TITLES = { pouilleux: 'Le Pouilleux', trouduc: 'Le Trou du Cul', americain: 'Le 8 américain', blackjack: 'Blackjack', flip7: 'Flip 7', skyjo: 'Skyjo', suiteinfernale: 'La Suite Infernale', cinqrois: 'Les Cinq Rois', luckynumbers: 'Lucky Numbers', trio: 'Trio' };

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

/**
 * Planifie le prochain coup de bot pour ce salon, si nécessaire — délègue
 * entièrement au module bot du jeu concerné (voir BOT_MODULES). Chaque
 * module gère lui-même son anti-double-déclenchement (état de module local),
 * donc l'appeler à chaque rendu ne fait rien si rien n'a changé.
 */
function maybeScheduleBotMove(room) {
  const mod = BOT_MODULES[room.game];
  if (!mod) return;
  mod.schedule?.(room);
  mod.scheduleExchange?.(room); // Trou du Cul uniquement (phase d'échange) ; no-op ailleurs
}

function draw(room) {
  currentRoomRef = room;
  updateDocumentTitle(room);
  maybeReinitRelay(room);
  maybeScheduleBotMove(room);

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
      player: currentPlayer,
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

/**
 * Rejoint directement un salon désigné par son code (lien d'invitation
 * partagé, ex: Telegram — voir le bouton "Inviter" de la salle d'attente
 * dans game.js). Si le code ne correspond plus à rien (salon fermé
 * entre-temps), repli silencieux sur l'écran des salons habituel.
 */
async function tryJoinRoomByCode(profile, code) {
  const room = await fetchRoomByCode(code);
  if (!room) {
    alert("Ce lien d'invitation n'est plus valide — le salon a peut-être été fermé.");
    await showRoomList(profile);
    return;
  }
  await leaveOtherRooms(profile, room.id);
  const joined = await ensureMembership(room, profile);
  const reclaimed = await reclaimStaleHost(joined, profile);
  enterRoom(reclaimed, profile);
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
        await leaveOtherRooms(profile, room.id);
        const joined = await ensureMembership(room, profile);
        const reclaimed = await reclaimStaleHost(joined, profile);
        stopRoomListPolling();
        enterRoom(reclaimed, profile);
      },
      onCreateRoom: async () => {
        const created = await createNewRoom();
        await leaveOtherRooms(profile, created.id);
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

  // Lien d'invitation (?room=CODE, voir le bouton "Inviter" de la salle
  // d'attente) : nettoyé de l'URL tout de suite pour qu'un rechargement de
  // page ne retente pas de rejoindre (ex: après avoir quitté ce salon).
  const joinCode = new URLSearchParams(window.location.search).get('room');
  if (joinCode) window.history.replaceState({}, '', window.location.pathname);

  const profile = getLocalProfile();

  if (!profile) {
    renderNamePrompt(app, {
      onSubmit: async (name) => {
        const newProfile = createLocalIdentity(name);
        if (joinCode) {
          await tryJoinRoomByCode(newProfile, joinCode);
        } else {
          await showRoomList(newProfile);
        }
      }
    });
    return;
  }

  if (joinCode) {
    await tryJoinRoomByCode(profile, joinCode);
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
