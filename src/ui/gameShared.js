// Utilitaires UI vraiment partagés entre plusieurs jeux (pas juste
// co-localisés par accident) : badge de connexion, boutons de fin de
// manche/abandon, tri de main "classique", vibration, le petit état
// "afficher les mains" partagé par Pouilleux/Trou du Cul/le mode spectateur,
// et la bascule 2D/3D (voir "Refonte graphique 3D" dans README).
import { playAgain, continueGame } from '../game/engine.js';
import { is3DEnabled, set3DEnabled } from './settings.js';

/**
 * Bascule 2D/3D — une bulle de plus dans la rangée `.game-hud__bubble`
 * (même famille visuelle que règles/journal/inviter/quitter), pas un
 * contrôle à part : générique (paramétrée par `gameId`), à appeler
 * uniquement depuis le fichier d'un jeu qui exporte réellement une version 3D
 * (voir `hide3D` dans src/ui/games/pouilleux.js pour l'exemple actuel) : ce
 * module ne décide pas lui-même quels jeux ont une version 3D, il fournit
 * juste le rendu + le câblage une fois que l'appelant a établi que c'est
 * pertinent — c'est pour ça qu'elle n'apparaît que dans le HTML des jeux qui
 * l'appellent effectivement. L'étiquette affiche le mode vers lequel on
 * bascule (pas le mode actuel), comme un bouton d'action plutôt qu'un état.
 */
export function threeDToggleHtml(gameId) {
  const enabled = is3DEnabled(gameId);
  const nextLabel = enabled ? '2D' : '3D';
  return `<button type="button" class="game-hud__bubble game-hud__bubble--mode" data-mode-toggle title="Passer en ${nextLabel}" aria-label="Passer en ${nextLabel}">${nextLabel}</button>`;
}

/** `onChange` : rappelée après le changement de préférence, pour redessiner l'écran dans le nouveau mode. */
export function wireThreeDToggle(container, gameId, onChange) {
  container.querySelector('[data-mode-toggle]')?.addEventListener('click', () => {
    set3DEnabled(gameId, !is3DEnabled(gameId));
    onChange?.();
  });
}

/**
 * 🔌 à côté du prénom d'un joueur qui bénéficie actuellement d'une liaison
 * directe (WebRTC) vers l'hôte — poussé par tout appareil dans
 * `room.state.connections` (voir `reportRelayStatus` dans engine.js), donc
 * visible par tout le monde à la table, pas seulement sur l'appareil concerné.
 */
export function connectionBadge(state, playerId) {
  return state.connections?.[playerId] ? ' 🔌' : '';
}

function rankSortValue(rank) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(rank);
}

/** Tri "classique" d'une main de cartes françaises (As en tête). Pouilleux/8 américain uniquement — les autres jeux ont leur propre ordre. */
export function sortedHand(hand) {
  return hand.slice().sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.suit.localeCompare(b.suit));
}

/**
 * Adversaires dans l'ordre du tour, en partant du joueur suivant après soi
 * (`state.turnOrder`, fixé aléatoirement à `initGame`, sauf jeu à ordre
 * imposé comme le Trou du Cul) — pour que la zone adversaires, en haut de
 * l'écran, se lise dans le sens de jeu plutôt que dans l'ordre d'arrivée en
 * salle. `turnOrder` par défaut sur l'ordre de `state.players` si absent
 * (jeux hérités qui ne l'exportent pas encore).
 */
export function orderedOpponents(state, playerId) {
  const turnOrder = state.turnOrder || state.players.map((p) => p.id);
  const myIdx = Math.max(0, turnOrder.indexOf(playerId));
  const ordered = [];
  for (let step = 1; step < turnOrder.length; step++) {
    const id = turnOrder[(myIdx + step) % turnOrder.length];
    const p = state.players.find((pl) => pl.id === id);
    if (p) ordered.push(p);
  }
  return ordered;
}

/**
 * Construit le lien d'invitation vers ce salon précis (?room=<code>, lu au
 * démarrage par main.js/tryJoinRoomByCode) et le propose via le partage natif
 * du téléphone (Telegram, WhatsApp, SMS… l'ami choisit) — repli sur la copie
 * dans le presse-papier si l'appareil ne propose pas de partage natif
 * (desktop, essentiellement). Utilisée depuis la salle d'attente (rejoint
 * comme joueur) et depuis la bulle HUD en pleine partie (rejoint alors en
 * spectateur — voir ensureMembership dans game/core.js — avec la possibilité
 * de prendre la place d'un bot depuis l'écran spectateur).
 */
export async function shareInviteLink(room) {
  const url = `${window.location.origin}${window.location.pathname}?room=${room.code}`;
  const shareData = { title: 'Cartes en famille', text: 'Rejoins la partie sur Cartes en famille !', url };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (err) {
      // AbortError si l'utilisateur ferme le sélecteur sans choisir — rien à faire.
    }
    return;
  }

  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(url);
      alert('Lien copié ! Colle-le dans Telegram (ou ailleurs) pour inviter.');
      return;
    } catch (err) {
      // repli sur le prompt ci-dessous
    }
  }

  window.prompt('Copie ce lien pour inviter :', url);
}

/**
 * Boutons de fin de partie, communs à la plupart des jeux : soit on enchaîne
 * directement une nouvelle manche (mêmes joueurs, sans repasser par le
 * lobby — le contexte propre à chaque jeu comme les rôles du Trou du Cul ou
 * l'argent du Blackjack est conservé), soit on retourne au lobby (tout est
 * remis à zéro). `opts.lobby`/`opts.continueBtn` (défaut true).
 */
export function endGameActionsHtml(opts = {}) {
  const showContinue = opts.continueBtn !== false;
  const showLobby = opts.lobby !== false;
  return `
    <div class="end-actions">
      ${showContinue ? '<button class="btn btn--primary" id="btn-continue">Continuer</button>' : ''}
      ${showLobby ? '<button class="btn btn--ghost" id="btn-lobby">Retour au salon</button>' : ''}
    </div>
  `;
}

/**
 * Bouton "Abandonner/Quitter la partie" en pleine partie, commun à tous les
 * jeux. L'hôte abandonne la manche pour tout le monde (comme aujourd'hui,
 * relance via `playAgain`) — le perdre casserait la table (relais WebRTC,
 * voir webrtc/relay.js). N'importe qui d'autre peut quitter sans bloquer les
 * autres : il est remplacé par un bot à sa place (voir `leaveTable` côté
 * engine.js), et repasse par l'écran "tu as quitté la table" habituel.
 */
export function wireAbandonButton(container, { room, player, state, onLeave }) {
  container.querySelector('#btn-abandon')?.addEventListener('click', () => {
    if (state.hostId === player.id) {
      if (window.confirm("Abandonner la partie en cours et ramener tout le monde en salle d'attente ? (utile si quelqu'un a quitté sans prévenir)")) {
        playAgain(room).catch((err) => alert(err.message || "Impossible d'abandonner la partie."));
      }
      return;
    }
    if (window.confirm('Quitter la partie en cours ? Un bot prendra ta suite pour ne pas bloquer les autres joueurs.')) {
      onLeave?.();
    }
  });
}

export function abandonButtonLabel(state, player) {
  return state.hostId === player.id ? 'Abandonner la partie' : 'Quitter la partie';
}

/**
 * Journal de la partie en popup (bulle 📄 du HUD) plutôt qu'un <details>
 * repliable dans le flux de la main — même famille de modale que les
 * réglages/règles. `state.log` passé directement : la modale n'a pas besoin
 * de rester "live", elle se ferme avant le prochain tour de toute façon.
 */
export function openLogModal(state) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-modal rules-modal" role="dialog" aria-modal="true" aria-label="Journal de la partie">
      <div class="settings-modal__header">
        <h2>Journal de la partie</h2>
        <button type="button" class="settings-modal__close" aria-label="Fermer">✕</button>
      </div>
      <div class="rules-modal__content">
        <ul class="log-modal__list">${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('') || '<li>Rien à signaler pour l\'instant.</li>'}</ul>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.settings-modal__close').addEventListener('click', close);
}

export function wireEndGameActions(container, room) {
  container.querySelector('#btn-continue')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await continueGame(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de continuer.');
    }
  });

  container.querySelector('#btn-lobby')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await playAgain(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de revenir au salon.');
    }
  });
}

// Sur Chrome/Android, navigator.vibrate() est bloqué (silencieusement, ou avec
// un message "[Intervention]" dans la console) tant que la page n'a reçu AUCUN
// tap depuis son dernier chargement complet — et n'existe même pas du tout hors
// contexte sécurisé (https, ou localhost). Concrètement : ça ne vibrera jamais
// en testant via `npm run dev -- --host` sur le réseau local en http://192.168.x.x
// (utilise l'URL https de prod pour ce test-là), et un appareil resté pur
// spectateur (aucun tap depuis l'ouverture de l'appli) ne vibrera pas non plus
// tant qu'il n'a pas touché un bouton au moins une fois.
export function vibrate(pattern) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const accepted = navigator.vibrate(pattern);
  if (!accepted) {
    console.debug('[vibrate] refusée par le navigateur (page pas encore "touchée", ou hors contexte sécurisé).');
  }
}

// "Afficher les mains" : bouton partagé par Pouilleux, Trou du Cul et le mode
// spectateur. Une seule source de vérité ici plutôt qu'une variable de module
// dupliquée dans chaque fichier — les imports ES ne permettent pas de
// réassigner une variable importée depuis un autre module, d'où les
// accesseurs plutôt qu'un simple `export let`.
let revealHands = false;
export function getRevealHands() { return revealHands; }
export function toggleRevealHands() { revealHands = !revealHands; return revealHands; }
export function resetRevealHands() { revealHands = false; }
