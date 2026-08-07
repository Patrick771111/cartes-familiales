import { cardFaceHtml, cardBackHtml } from './cards.js';
import {
  AVAILABLE_GAMES,
  startGame,
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
  playAgain,
  continueGame,
  addBot,
  setBlackjackBet,
  submitExchangeGift,
  claimHost,
  HOST_STALE_MS
} from '../game/engine.js';
import { playerToDrawFrom as computeTarget } from '../game/pouilleux.js';
import { rankValue as trouducRankValue, rankLabel as trouducRankLabel } from '../game/trouduc.js';
import { isLegalCard, hasLegalMove } from '../game/americain.js';
import { handTotal, DEFAULT_BET as BLACKJACK_DEFAULT_BET, MIN_BET as BLACKJACK_MIN_BET, MAX_BET as BLACKJACK_MAX_BET } from '../game/blackjack.js';
import { TARGET_SCORE as FLIP7_TARGET_SCORE } from '../game/flip7.js';
import { TARGET_SCORE as SKYJO_TARGET_SCORE } from '../game/skyjo.js';
import { SEQUENCE_TARGET as SUITE_INFERNALE_TARGET, SPECIAL_TYPES as SUITE_INFERNALE_SPECIAL_TYPES } from '../game/suiteinfernale.js';
import {
  canGoOut as cinqRoisCanGoOut,
  rankLabel as cinqRoisRankLabel,
  suitInfo as cinqRoisSuitInfo
} from '../game/cinqrois.js';
import { suitInfo } from '../game/deck.js';
import { suitCardImage, cardBackImage, jokerImage, suiteInfernaleSpecialImage, flipButtonImage } from './cardThemes.js';
import { getOrderedHand, moveCard, resetHandOrder } from './handOrder.js';
import { enableHandDrag } from './dragReorder.js';
import { enableDragToZone } from './dragToZone.js';
import { isSuiteInfernaleDragEnabled } from './settings.js';
import { openRulesModal } from './rules.js';

/**
 * 🔌 à côté du prénom d'un joueur qui bénéficie actuellement d'une liaison
 * directe (WebRTC) vers l'hôte — poussé par tout appareil dans
 * `room.state.connections` (voir `reportRelayStatus` dans engine.js), donc
 * visible par tout le monde à la table, pas seulement sur l'appareil concerné.
 */
function connectionBadge(state, playerId) {
  return state.connections?.[playerId] ? ' 🔌' : '';
}

function rankSortValue(rank) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(rank);
}

function sortedHand(hand) {
  return hand.slice().sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.suit.localeCompare(b.suit));
}

/**
 * Boutons de fin de partie, communs aux 4 jeux : soit on enchaîne directement
 * une nouvelle manche (mêmes joueurs, sans repasser par le lobby — le contexte
 * propre à chaque jeu comme les rôles du Trou du Cul ou l'argent du Blackjack
 * est conservé), soit on retourne au lobby (tout est remis à zéro).
 */
function endGameActionsHtml() {
  return `
    <div class="end-actions">
      <button class="btn btn--primary" id="btn-continue">Continuer</button>
      <button class="btn btn--ghost" id="btn-lobby">Retour au lobby</button>
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
function wireAbandonButton(container, { room, player, state, onLeave }) {
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

function abandonButtonLabel(state, player) {
  return state.hostId === player.id ? 'Abandonner la partie' : 'Quitter la partie';
}

function wireEndGameActions(container, room) {
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
      alert(err.message || 'Impossible de revenir au lobby.');
    }
  });
}

/**
 * Affiche l'écran de partie (salle d'attente / plateau / fin) dans `container`.
 * `room` = ligne courante (state + type de jeu inclus), `player` = profil local.
 * Le changement de prénom se fait désormais depuis la modale de réglages (settings.js).
 */
export function renderGame(container, { room, player, onLeave, onKick } = {}) {
  const state = room.state;

  if (state.status === 'lobby') {
    lastRenderedState = null;
    lastCelebratedMoveId = null;
    expiredPileClearedId = null;
    pileClearTimerFor = null;
    pendingEightCardId = null;
    skyjoPendingMode = null;
    pendingSuiteInfernaleCardId = null;
    pendingSuiteInfernaleTargetId = null;
    suiteInfernaleDiscardMode = false;
    suiteInfernaleAttackWasPending = false;
    suiteInfernaleResolutionBanner = null;
    resetHandOrder('pouilleux');
    revealHands = false;
    return renderWaitingRoom(container, { room, player, onLeave, onKick });
  }

  if (state.status === 'exchange') {
    return renderTrouducExchange(container, { room, player, state, onLeave });
  }

  const previous = lastRenderedState;
  const isNewDraw = previous && state.lastDraw && (!previous.lastDraw || previous.lastDraw.id !== state.lastDraw.id);

  if (isNewDraw) {
    return renderDrawReveal(container, { previousState: previous, newState: state, player, room, onLeave });
  }

  lastRenderedState = state;

  const isTrouduc = room.game === 'trouduc';
  const isAmericain = room.game === 'americain';
  const isBlackjack = room.game === 'blackjack';
  const isFlip7 = room.game === 'flip7';
  const isSkyjo = room.game === 'skyjo';
  const isSuiteInfernale = room.game === 'suiteinfernale';
  const isCinqRois = room.game === 'cinqrois';
  // Le Blackjack, Flip 7, Skyjo et la Suite Infernale n'ont pas d'écran de fin
  // séparé : la table (banque, mains/grilles/suites de tout le monde) reste
  // affichée telle quelle, seuls les résultats s'y ajoutent.
  if (isBlackjack && (state.status === 'playing' || state.status === 'finished')) {
    return renderBlackjackTable(container, { room, player, state, onLeave });
  }
  if (isFlip7 && (state.status === 'playing' || state.status === 'finished')) {
    return renderFlip7Table(container, { room, player, state, onLeave });
  }
  if (isSkyjo && (state.status === 'playing' || state.status === 'finished')) {
    return renderSkyjoTable(container, { room, player, state, onLeave });
  }
  if (isSuiteInfernale && (state.status === 'playing' || state.status === 'finished')) {
    return renderSuiteInfernaleTable(container, { room, player, state, onLeave });
  }
  if (isCinqRois && (state.status === 'playing' || state.status === 'last_turns' || state.status === 'finished')) {
    return renderCinqRoisTable(container, { room, player, state, onLeave });
  }
  if (state.status === 'playing') {
    if (isTrouduc) return renderTrouducTable(container, { room, player, state, onLeave });
    if (isAmericain) return renderAmericainTable(container, { room, player, state, onLeave });
    return renderTableNow(container, { room, player, state, onLeave });
  }
  if (state.status === 'finished') {
    if (isTrouduc) return renderTrouducEnd(container, { room, player, state, onLeave });
    if (isAmericain) return renderAmericainEnd(container, { room, player, state, onLeave });
    return renderEndScreen(container, { room, player, onLeave });
  }
}

// Le lobby est entièrement redessiné (innerHTML) à chaque mise à jour de la salle
// (ex : ajout d'un bot via Realtime), ce qui réinitialiserait la sélection du jeu
// si elle n'était pas mémorisée en dehors de la fonction de rendu.
let selectedGameIdByRoom = null;

function renderWaitingRoom(container, { room, player, onLeave, onKick }) {
  const state = room.state;
  if (selectedGameIdByRoom?.roomId !== room.id) selectedGameIdByRoom = null;
  const selectedGameId = selectedGameIdByRoom?.gameId || AVAILABLE_GAMES[0].id;
  const isHost = state.hostId === player.id;
  const me = state.players.find((p) => p.id === player.id);
  const currentHost = state.players.find((p) => p.id === state.hostId);
  const hostIsBot = currentHost?.isBot === true;
  const hostIsStale = !hostIsBot && Date.now() - (state.hostLastSeen || 0) > HOST_STALE_MS;
  const hostUnavailable = hostIsBot || hostIsStale;

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>${state.roomEmoji || '🎲'} ${state.roomName || 'Table ouverte'}</h1>
        <p class="lobby-card__intro">
          ${
            hostIsBot
              ? "L'hôte est un bot — quelqu'un doit reprendre la main pour lancer la partie."
              : hostIsStale
                ? "L'hôte semble inactif depuis un moment — tu peux reprendre la main."
                : isHost
                  ? "Attends que les autres arrivent, choisis le jeu, puis lance la partie."
                  : "En attente que l'hôte lance la partie…"
          }
        </p>

        <ul class="player-list">
          ${state.players
            .map(
              (p) => `
                <li>
                  <span>${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''}${p.id === state.hostId ? ' <span class="tag">hôte</span>' : ''}${p.id === player.id ? ' <span class="tag tag--you">toi</span>' : ''}</span>
                  ${isHost && p.id !== player.id ? `<button class="player-list__kick" data-kick-id="${p.id}" title="Retirer ${p.name}" aria-label="Retirer ${p.name}">✕</button>` : ''}
                </li>`
            )
            .join('')}
        </ul>

        ${hostUnavailable && !isHost ? `<button class="btn btn--ghost btn--small" id="btn-claim-host">Devenir l'hôte</button>` : ''}

        ${
          isHost && state.players.length < 6
            ? `<button class="btn btn--ghost btn--small" id="btn-add-bot">+ Ajouter un bot</button>`
            : ''
        }

        ${
          isHost
            ? `
              <div class="game-picker">
                <p class="game-picker__label">Quel jeu ?</p>
                <div class="game-picker__options">
                  ${AVAILABLE_GAMES.map(
                    (g) => `
                      <label class="game-picker__option">
                        <input type="radio" name="game" value="${g.id}" ${g.id === selectedGameId ? 'checked' : ''} />
                        <span>${g.label}<br/><small>${g.hint}</small></span>
                      </label>`
                  ).join('')}
                </div>
              </div>
              <button id="btn-start" class="btn btn--primary"></button>`
            : ''
        }
        <p class="lobby-card__rename-hint">Ce n'est pas ${me?.name || 'toi'} ? Change de prénom dans les réglages ⚙️ (en haut à droite).</p>
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  const startBtn = container.querySelector('#btn-start');
  const updateStartButton = () => {
    if (!startBtn) return;
    const selectedId = container.querySelector('input[name="game"]:checked')?.value;
    const game = AVAILABLE_GAMES.find((g) => g.id === selectedId) || AVAILABLE_GAMES[0];
    const canStart = state.players.length >= game.minPlayers;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart
      ? `Lancer la partie (${state.players.length} joueur${state.players.length > 1 ? 's' : ''})`
      : `En attente (minimum ${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''})`;
  };
  updateStartButton();
  container.querySelectorAll('input[name="game"]').forEach((r) =>
    r.addEventListener('change', () => {
      selectedGameIdByRoom = { roomId: room.id, gameId: r.value };
      updateStartButton();
    })
  );

  container.querySelector('#btn-start')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const selectedGame = container.querySelector('input[name="game"]:checked')?.value || 'pouilleux';
    try {
      await startGame(room, selectedGame);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de lancer la partie.');
    }
  });

  container.querySelector('#btn-claim-host')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await claimHost(room, player);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible de devenir l'hôte.");
    }
  });

  container.querySelector('#btn-add-bot')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await addBot(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible d'ajouter un bot.");
    }
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });

  container.querySelectorAll('.player-list__kick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.kickId;
      const target = state.players.find((p) => p.id === id);
      if (target?.isBot || window.confirm(`Retirer ${target?.name || 'ce joueur'} de la table ?`)) onKick?.(id);
    });
  });
}

/* ============================== Le Pouilleux ============================== */

// Mémorise le dernier état affiché, pour pouvoir comparer et détecter une nouvelle pioche
// à animer avant de basculer sur l'état à jour. Réinitialisé à chaque nouvelle partie.
let lastRenderedState = null;

// Sur Chrome/Android, navigator.vibrate() est bloqué (silencieusement, ou avec
// un message "[Intervention]" dans la console) tant que la page n'a reçu AUCUN
// tap depuis son dernier chargement complet — et n'existe même pas du tout hors
// contexte sécurisé (https, ou localhost). Concrètement : ça ne vibrera jamais
// en testant via `npm run dev -- --host` sur le réseau local en http://192.168.x.x
// (utilise l'URL https de prod pour ce test-là), et un appareil resté pur
// spectateur (aucun tap depuis l'ouverture de l'appli) ne vibrera pas non plus
// tant qu'il n'a pas touché un bouton au moins une fois.
function vibrate(pattern) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const accepted = navigator.vibrate(pattern);
  if (!accepted) {
    console.debug('[vibrate] refusée par le navigateur (page pas encore "touchée", ou hors contexte sécurisé).');
  }
}

function renderDrawReveal(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow(container, { room: { ...room, state: previousState }, player, state: previousState, onLeave });

  const draw = newState.lastDraw;
  const drawer = previousState.players.find((p) => p.id === draw.by);
  const target = previousState.players.find((p) => p.id === draw.from);

  const isOddCard = draw.card.id === newState.oddCardId;
  const isFinalReveal = isOddCard && newState.status === 'finished';
  const safeNames = [draw.drawerFinished ? drawer?.name : null, draw.targetFinished ? target?.name : null].filter(Boolean);

  const overlayClasses = ['draw-reveal'];
  if (isOddCard) overlayClasses.push('draw-reveal--danger');
  if (safeNames.length) overlayClasses.push('draw-reveal--safe');

  const extraMessages = [];
  if (isOddCard) {
    extraMessages.push(isFinalReveal ? `${drawer?.name || '?'} est LE Pouilleux !` : 'Attention, LE Pouilleux !');
  }
  safeNames.forEach((name) => extraMessages.push(`${name} est à l'abri !`));

  const overlay = document.createElement('div');
  overlay.className = overlayClasses.join(' ');
  overlay.innerHTML = `
    <div class="draw-reveal__card">${cardFaceHtml(draw.card)}</div>
    <p class="draw-reveal__label">
      ${drawer?.name || '?'} pioche chez ${target?.name || '?'}${draw.paired ? ' — paire !' : ''}
    </p>
    ${extraMessages.map((m) => `<p class="draw-reveal__extra">${m}</p>`).join('')}
  `;
  container.querySelector('.pouilleux-screen')?.appendChild(overlay);

  if (isFinalReveal) {
    vibrate([150, 80, 150, 80, 300]);
  } else if (isOddCard) {
    vibrate([80, 40, 80, 40, 150]);
  } else if (safeNames.length) {
    vibrate(200);
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    lastRenderedState = newState;
    if (newState.status === 'finished') {
      renderEndScreen(container, { room, player, onLeave });
    } else {
      renderTableNow(container, { room, player, state: newState, onLeave });
    }
  }, reduceMotion ? 500 : isOddCard || safeNames.length ? 1900 : 1400);
}

function renderTableNow(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  // La cible (chez qui on pioche ce tour-ci) est toujours calculable, pas
  // seulement quand c'est mon tour — ça permet de la mettre en avant même en
  // train de regarder jouer quelqu'un d'autre.
  const targetId = computeTarget(state);
  const targetName = state.players.find((p) => p.id === targetId)?.name || '';
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';
  const orderedHand = getOrderedHand('pouilleux', me.hand, sortedHand);
  const isSafe = me.hand.length === 0;
  const showFaces = isSafe && revealHands;

  const target = state.players.find((p) => p.id === targetId) || null;
  const restOthers = state.players.filter((p) => p.id !== player.id && p.id !== targetId);

  const targetPickable = isMyTurn && target && target.hand.length > 0;
  const targetHandHtml = !target
    ? ''
    : targetPickable
      ? Array.from({ length: target.hand.length })
          .map(
            (_, i) =>
              `<button type="button" class="card card--back target-card--pickable" data-pick-index="${i}"><span class="card__back-pattern"></span></button>`
          )
          .join('')
      : target.hand.length === 0
        ? ''
        : showFaces
          ? target.hand.map(cardFaceHtml).join('')
          : Array.from({ length: target.hand.length }).map(() => cardBackHtml()).join('');

  const restHtml = restOthers
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const status = p.hand.length === 0 ? 'sorti·e' : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
      const handHtml = p.hand.length === 0
        ? ''
        : showFaces
          ? p.hand.map(cardFaceHtml).join('')
          : Array.from({ length: Math.min(p.hand.length, 6) }).map(() => cardBackHtml()).join('') +
            (p.hand.length > 6 ? `<span class="opponent__count">+${p.hand.length - 5}</span>` : '');
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand ${showFaces ? 'opponent__hand--revealed' : ''}">${handHtml}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)}${p.hand.length === 0 ? ' — sorti·e' : ` · ${status}`}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table pouilleux-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="pouilleux-zone pouilleux-zone--target">
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${isMyTurn ? `Touche une carte chez ${targetName}` : `Tour de ${currentPlayerName}`}
        </div>
        ${target ? `<p class="pouilleux-target__name">${target.name}${connectionBadge(state, target.id)}${target.hand.length === 0 ? ' — sorti·e' : ` · ${target.hand.length} carte${target.hand.length > 1 ? 's' : ''}`}</p>` : ''}
        <div class="pouilleux-target__hand ${targetPickable ? 'pouilleux-target__hand--pickable' : ''} ${showFaces ? 'opponent__hand--revealed' : ''}">
          ${targetHandHtml}
        </div>
        ${isSafe ? `<button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>` : ''}
      </div>

      <div class="pouilleux-zone pouilleux-zone--mine">
        <div class="my-hand">
          <p class="my-hand__label">Ta main (${me.hand.length}) <small>— glisse pour réordonner</small></p>
          <div class="my-hand__cards">
            ${orderedHand.map(cardFaceHtml).join('') || '<p class="my-hand__empty">Tu es sorti·e, bravo ! Suis la suite de la partie ci-dessus.</p>'}
          </div>
        </div>

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderTableNow(container, { room, player, state, onLeave });
  });
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    enableHandDrag(myHandEl, {
      onDrop: (cardId, index) => {
        moveCard('pouilleux', cardId, index);
        renderTableNow(container, { room, player, state, onLeave });
      }
    });
  }

  if (isMyTurn) {
    container.querySelectorAll('.target-card--pickable').forEach((btn) => {
      btn.addEventListener('click', async () => {
        // Vibration directement dans le gestionnaire de clic (et non uniquement
        // dans renderDrawReveal, déclenché plus tard par la resynchro realtime) :
        // c'est le seul moment où le navigateur est garanti d'accepter l'appel,
        // puisqu'il suit immédiatement un vrai tap.
        vibrate(30);
        const cardIndex = Number(btn.dataset.pickIndex);
        container.querySelectorAll('.target-card--pickable').forEach((b) => (b.disabled = true));
        try {
          await drawForCurrentPlayer(room, player.id, cardIndex);
        } catch (err) {
          // Un conflit ou une action hors-tour se résorbe via la resynchro realtime.
          container.querySelectorAll('.target-card--pickable').forEach((b) => (b.disabled = false));
        }
      });
    });
  }
}

function renderEndScreen(container, { room, player, onLeave }) {
  const state = room.state;
  const loser = state.players.find((p) => p.id === state.loserId);
  const youLost = state.loserId === player.id;

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <div class="odd-card-reveal">${cardFaceHtml({ id: state.oddCardId, rank: state.oddCardId.slice(0, -1), suit: state.oddCardId.slice(-1) })}</div>
        <h1>${youLost ? 'Tu es le Pouilleux !' : `${loser?.name || '?'} est le Pouilleux !`}</h1>
        ${endGameActionsHtml()}
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}

/* ============================== Le Trou du Cul ============================== */

// Sélection de cartes en cours pour le joueur local (remise à zéro dès que ce
// n'est plus son tour). Vit en dehors du DOM pour survivre aux re-rendus.
let selectedCardIds = new Set();

// Bouton "Afficher les mains" : uniquement proposé à quelqu'un qui ne peut plus
// jouer (à l'abri, fini, ou simple spectateur) — aucun souci d'équité puisqu'il
// ne peut plus agir sur la partie en cours.
let revealHands = false;

// Sélection en cours pendant la phase d'échange (distincte de la sélection de
// jeu ci-dessus, remise à zéro dès que ce n'est plus à cette personne de choisir).
let exchangeSelectedCardIds = new Set();

/**
 * Écran de la phase d'échange : chacun ne voit que ce qui concerne SA propre
 * main. Le Président et le Vice-Président choisissent quoi rendre ; le Trou du
 * Cul et le Secrétaire attendent, sans connaître les cartes précises en jeu
 * chez le binôme adverse.
 */
function renderTrouducExchange(container, { room, player, state, onLeave }) {
  const ex = state.exchange;
  const me = state.players.find((p) => p.id === player.id);

  const isPresident = player.id === ex.presidentId;
  const isVicePresident = player.id === ex.vicePresidentId;
  const isTrouDuCul = player.id === ex.trouDuCulId;

  const needsToChoose = (isPresident && !ex.presidentGiven) || (isVicePresident && !ex.vicePresidentGiven);
  const requiredCount = isPresident ? ex.presidentGiftCount : isVicePresident ? ex.vicePresidentGiftCount : 0;

  if (!needsToChoose) exchangeSelectedCardIds = new Set();

  let statusMessage;
  if (needsToChoose) {
    const recipientName = isPresident
      ? state.players.find((p) => p.id === ex.trouDuCulId)?.name
      : state.players.find((p) => p.id === ex.secretaireId)?.name;
    statusMessage = `Choisis ${requiredCount} carte${requiredCount > 1 ? 's' : ''} à donner à ${recipientName}.`;
  } else if (isPresident || isVicePresident) {
    statusMessage = "Choix envoyé — en attente de l'autre binôme…";
  } else if (isTrouDuCul) {
    statusMessage = `Tu as donné tes 2 meilleures cartes à ${state.players.find((p) => p.id === ex.presidentId)?.name}. Il/elle va t'en redonner 2 en retour.`;
  } else {
    statusMessage = `Tu as donné ta meilleure carte à ${state.players.find((p) => p.id === ex.vicePresidentId)?.name}. Il/elle va t'en redonner une en retour.`;
  }

  const selectedCount = [...exchangeSelectedCardIds].filter((id) => me.hand.some((c) => c.id === id)).length;

  // Les cartes reçues d'office (Trou du Cul → Président, Secrétaire → Vice-
  // Président) sont entourées de doré, pour aider à choisir quoi rendre.
  const receivedIds = isPresident ? ex.receivedByPresident : isVicePresident ? ex.receivedByVicePresident : [];

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Nouvelle manche</p>
        <h1 class="exchange-title">Échange de cartes</h1>
        <p class="exchange-status">${statusMessage}</p>
        ${
          needsToChoose
            ? `<p class="exchange-hint">✨ Entourées de doré : les cartes que tu viens de recevoir.</p>
               <button id="btn-give" class="btn btn--primary" ${selectedCount === requiredCount ? '' : 'disabled'}>
                 Donner (${selectedCount}/${requiredCount})
               </button>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length})</p>
        <div class="my-hand__cards">
          ${me.hand
            .map(
              (c) =>
                `<div class="hand-card ${exchangeSelectedCardIds.has(c.id) ? 'hand-card--selected' : ''} ${receivedIds.includes(c.id) ? 'hand-card--gifted' : ''}" data-card-id="${c.id}">${cardFaceHtml(c)}</div>`
            )
            .join('')}
        </div>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  if (needsToChoose) {
    container.querySelectorAll('.hand-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.cardId;
        if (exchangeSelectedCardIds.has(id)) {
          exchangeSelectedCardIds.delete(id);
        } else if (exchangeSelectedCardIds.size < requiredCount) {
          exchangeSelectedCardIds.add(id);
        }
        renderTrouducExchange(container, { room, player, state, onLeave });
      });
    });

    container.querySelector('#btn-give')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await submitExchangeGift(room, player.id, [...exchangeSelectedCardIds]);
        exchangeSelectedCardIds = new Set();
      } catch (err) {
        e.target.disabled = false;
        alert(err.message || 'Impossible de donner ces cartes.');
      }
    });
  }
}

// Id du dernier coup déjà célébré (accession au poste de Président), pour ne
// pas répéter l'effet à chaque re-rendu.
let lastCelebratedMoveId = null;

// Suivi du dernier pli "effacé visuellement" côté client (voir pileClearedId
// dans trouduc.js) : le pli reste affiché ~1s après avoir brûlé/été ramassé,
// avant que ces variables ne le fassent disparaître à l'écran.
let expiredPileClearedId = null;
let pileClearTimerFor = null;

function renderTrouducTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  // Place les 3 adversaires dans l'ordre du tour à partir de moi (siège gauche
  // = joueur suivant, milieu = celui d'après, droite = celui juste avant moi),
  // pour que le jeu progresse toujours dans le sens des aiguilles d'une montre
  // en partant du bas (moi) vers la gauche, le haut, puis la droite.
  const myTurnIdx = state.turnOrder.indexOf(player.id);
  const others =
    myTurnIdx === -1
      ? state.players.filter((p) => p.id !== player.id)
      : [1, 2, 3].map((step) => state.players.find((p) => p.id === state.turnOrder[(myTurnIdx + step) % state.turnOrder.length]));
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) selectedCardIds = new Set();

  // Décale légèrement chaque pose vers le siège de celui qui l'a posée (gauche,
  // milieu/en face, droite, ou vers toi en bas), pour un rendu plus vivant qu'un
  // pli toujours parfaitement centré — sans jamais s'éloigner beaucoup du centre.
  const seatShiftFor = (playerId) => {
    if (playerId === player.id) return { x: 0, y: 30 };
    const seatIndex = others.findIndex((p) => p.id === playerId);
    if (seatIndex === 0) return { x: -22, y: -10 };
    if (seatIndex === 2) return { x: 22, y: -10 };
    if (seatIndex === 1) return { x: 0, y: -30 };
    return { x: 0, y: 0 };
  };

  // Le pli en cours (historique complet des poses depuis son ouverture) reste
  // affiché, empilé, tant qu'il n'a pas été explicitement "effacé" côté client
  // (voir plus bas) : ça laisse le temps de voir une carte qui vient de brûler
  // le pli, ou le dernier pli avant qu'il soit ramassé, au lieu qu'il disparaisse
  // instantanément dès que le serveur repasse pileCount à 0.
  const pileVisuallyCleared = state.pileCount === 0 && state.pileClearedId && state.pileClearedId === expiredPileClearedId;
  const pileHistoryForDisplay = pileVisuallyCleared ? [] : state.pileHistory || [];

  if (
    state.pileCount === 0 &&
    state.pileClearedId &&
    state.pileClearedId !== expiredPileClearedId &&
    state.pileClearedId !== pileClearTimerFor
  ) {
    pileClearTimerFor = state.pileClearedId;
    const idToExpire = state.pileClearedId;
    window.setTimeout(() => {
      expiredPileClearedId = idToExpire;
      pileClearTimerFor = null;
      renderTrouducTable(container, { room, player, state, onLeave });
    }, 1000);
  }

  // Pendant le tout premier pli de la manche, entoure de doré les cartes que
  // le Trou du Cul / le Secrétaire viennent de recevoir en retour d'échange.
  const giftedCardIds = state.firstTrickPending ? state.returnGiftIds?.[player.id] || [] : [];

  const selectedCards = me.hand.filter((c) => selectedCardIds.has(c.id));
  const selectedRank = selectedCards[0]?.rank;
  const beatsOrMatchesPile = state.rankLocked
    ? trouducRankValue(selectedRank) === trouducRankValue(state.pileRank)
    : trouducRankValue(selectedRank) >= trouducRankValue(state.pileRank);
  const selectionValid =
    isMyTurn &&
    selectedCards.length > 0 &&
    selectedCards.every((c) => c.rank === selectedRank) &&
    (state.pileCount === 0 ? true : selectedCards.length === state.pileCount && beatsOrMatchesPile);
  const canPass = isMyTurn && state.pileCount > 0;

  const handCountsByRank = new Map();
  for (const c of me.hand) handCountsByRank.set(c.rank, (handCountsByRank.get(c.rank) || 0) + 1);
  const isRankPlayable = (rank) => {
    if (state.pileCount === 0) return true;
    if ((handCountsByRank.get(rank) || 0) < state.pileCount) return false;
    const rv = trouducRankValue(rank);
    const pileRv = trouducRankValue(state.pileRank);
    return state.rankLocked ? rv === pileRv : rv >= pileRv;
  };

  // Regroupe les cartes consécutives de même rang (la main est déjà triée par rang
  // par le serveur), puis répartit les groupes sur deux rangées sans jamais couper
  // un groupe en deux. L'espacement entre groupes est calculé pour que chaque
  // rangée tienne toujours dans la largeur de l'écran, même dans le pire des cas
  // (aucune paire en main : autant de groupes que de cartes).
  const CARD_W = 64;
  const TIGHT_STEP = 26; // largeur visible d'une carte "empilée" dans le même groupe
  // Largeur dispo estimée pour une rangée : s'adapte à l'écran réel (mobile étroit
  // comme desktop plus large), avec une marge de sécurité pour le cadre autour.
  const ROW_WIDTH_BUDGET = Math.min(window.innerWidth - 40, 620);

  const groupHand = (hand) => {
    const groups = [];
    for (const card of hand) {
      const last = groups[groups.length - 1];
      if (last && last[0].rank === card.rank) last.push(card);
      else groups.push([card]);
    }
    return groups;
  };

  const splitIntoRows = (groups, total) => {
    const targetRow1 = Math.ceil(total / 2);
    const rows = [[], []];
    let count = 0;
    let rowIndex = 0;
    for (const group of groups) {
      if (rowIndex === 0 && count >= targetRow1 && count > 0) rowIndex = 1;
      rows[rowIndex].push(group);
      count += group.length;
    }
    return rows;
  };

  const renderRow = (rowGroups) => {
    if (!rowGroups.length) return '';
    const n = rowGroups.reduce((s, g) => s + g.length, 0);
    const nGroupStarts = rowGroups.length - 1; // hors tout premier groupe de la rangée
    const nContinuations = n - rowGroups.length; // cartes qui prolongent un groupe existant
    const remaining = ROW_WIDTH_BUDGET - CARD_W - nContinuations * TIGHT_STEP;
    const lightStep = nGroupStarts > 0 ? Math.max(TIGHT_STEP, Math.min(CARD_W - 4, remaining / nGroupStarts)) : 0;

    let html = '';
    let cardPos = 0;
    rowGroups.forEach((group) => {
      group.forEach((c, iInGroup) => {
        const isFirstInRow = cardPos === 0;
        const isFirstInGroup = iInGroup === 0;
        let marginLeft;
        if (isFirstInRow) marginLeft = 0;
        else if (isFirstInGroup) marginLeft = -(CARD_W - lightStep);
        else marginLeft = -(CARD_W - TIGHT_STEP);
        const playable = !isMyTurn || isRankPlayable(c.rank);
        const gifted = giftedCardIds.includes(c.id);
        html += `<div class="hand-card ${selectedCardIds.has(c.id) ? 'hand-card--selected' : ''} ${playable ? '' : 'hand-card--unplayable'} ${gifted ? 'hand-card--gifted' : ''}" data-card-id="${c.id}" style="margin-left:${marginLeft}px">${cardFaceHtml(c)}</div>`;
        cardPos++;
      });
    });
    return html;
  };

  const handGroups = groupHand(me.hand);
  const handRows = splitIntoRows(handGroups, me.hand.length);
  const isSafe = me.finished;
  const showFaces = isSafe && revealHands;

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt trouduc-felt">
        <div class="trouduc-opponents">
          ${others
            .map((p, i) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = p.finished
                ? trouducRankLabel(p.rank)
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const label = p.role ? `${p.role} · ${status}` : status;
              const previewCount = Math.min(p.hand.length, 5);
              const handPreview = p.finished
                ? ''
                : showFaces
                  ? p.hand.slice(0, previewCount).map(cardFaceHtml).join('') +
                    (p.hand.length > previewCount ? `<span class="opponent__count">+${p.hand.length - previewCount}</span>` : '')
                  : Array.from({ length: previewCount }).map(() => cardBackHtml()).join('');
              return `
                <div class="trouduc-seat trouduc-seat--${i} ${isTurn ? 'trouduc-seat--turn' : ''} ${p.finished ? 'trouduc-seat--finished' : ''}">
                  <p class="trouduc-seat__name">${p.name}${connectionBadge(state, p.id)}</p>
                  <p class="trouduc-seat__status">${label}</p>
                  <div class="trouduc-seat__row">
                    <div class="trouduc-seat__hand ${showFaces ? 'trouduc-seat__hand--revealed' : ''}">${handPreview}</div>
                  </div>
                </div>`;
            })
            .join('')}
        </div>

        <div class="trouduc-center">
          <div class="trouduc-pile ${pileHistoryForDisplay.length ? 'trouduc-pile--active' : ''}">
            ${
              pileHistoryForDisplay.length
                ? `<div class="trouduc-pile__stack">
                     ${pileHistoryForDisplay
                       .map((entry, i) => {
                         const shift = seatShiftFor(entry.by);
                         const stackOffset = i * 4;
                         return `<div class="trouduc-pile__shift" style="transform: translate(${shift.x + stackOffset}px, ${shift.y + stackOffset}px); z-index: ${i}">
                                    <div class="trouduc-pile__cards">${entry.cards.map(cardFaceHtml).join('')}</div>
                                  </div>`;
                       })
                       .join('')}
                   </div>
                   <p class="trouduc-pile__label">
                     ${
                       state.pileCount > 0
                         ? `${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}`
                         : 'Pli terminé'
                     }
                   </p>`
                : `<p class="trouduc-pile__empty">Pli libre — pose ce que tu veux</p>`
            }
          </div>

          <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
            ${isMyTurn ? "C'est ton tour" : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`}
          </div>

          ${
            isMyTurn
              ? `<div class="trouduc-actions">
                   <button id="btn-play" class="btn btn--primary" ${selectionValid ? '' : 'disabled'}>
                     Jouer${selectedCards.length ? ` (${selectedCards.length})` : ''}
                   </button>
                   <button id="btn-pass" class="btn btn--ghost" ${canPass ? '' : 'disabled'}>Passer</button>
                 </div>`
              : ''
          }

          ${isSafe ? `<button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>` : ''}
        </div>
      </div>

      <div class="my-hand trouduc-hand">
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length})</p>
        ${giftedCardIds.length ? `<p class="exchange-hint">✨ Entourées de doré : les cartes reçues en retour d'échange.</p>` : ''}
        ${
          me.hand.length
            ? `<div class="trouduc-hand-rows">
                 <div class="trouduc-hand-row">${renderRow(handRows[0])}</div>
                 <div class="trouduc-hand-row trouduc-hand-row--2">${renderRow(handRows[1])}</div>
               </div>`
            : '<p class="my-hand__empty">Tu as fini, bravo ! Suis la suite de la partie ci-dessus.</p>'
        }
      </div>

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>

      <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
      <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderTrouducTable(container, { room, player, state, onLeave });
  });

  if (isMyTurn) {
    container.querySelectorAll('.hand-card:not(.hand-card--unplayable)').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.cardId;
        const card = me.hand.find((c) => c.id === id);
        if (selectedCardIds.has(id)) {
          selectedCardIds.delete(id);
        } else if (state.pileCount > 0 && isRankPlayable(card.rank)) {
          // Le pli en cours impose un nombre de cartes précis (paire, triple, carré) :
          // un seul clic sur une carte du bon rang suffit à sélectionner tout le lot.
          selectedCardIds = new Set(
            me.hand.filter((c) => c.rank === card.rank).slice(0, state.pileCount).map((c) => c.id)
          );
        } else {
          selectedCardIds.add(id);
        }
        renderTrouducTable(container, { room, player, state, onLeave });
      });
    });
  }

  container.querySelector('#btn-play')?.addEventListener('click', async (e) => {
    vibrate(30);
    e.target.disabled = true;
    const ids = [...selectedCardIds];
    try {
      await playCards(room, player.id, ids);
      selectedCardIds = new Set();
    } catch (err) {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-pass')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await passTurn(room, player.id);
    } catch (err) {
      e.target.disabled = false;
    }
  });

  const move = state.lastMove;
  const justBecamePresident = move && move.finished && state.finishedOrder[0] === move.by && move.id !== lastCelebratedMoveId;
  if (justBecamePresident) {
    lastCelebratedMoveId = move.id;
    const presidentName = state.players.find((p) => p.id === move.by)?.name || '?';
    const celebration = document.createElement('div');
    celebration.className = 'draw-reveal draw-reveal--safe draw-reveal--brief';
    celebration.innerHTML = `<p class="draw-reveal__extra draw-reveal__extra--big">🎉 ${presidentName} est Président !</p>`;
    container.querySelector('.table-felt')?.appendChild(celebration);
    vibrate([100, 60, 200]);
    window.setTimeout(() => celebration.remove(), 1600);
  }
}

function renderTrouducEnd(container, { room, player, state, onLeave }) {
  const ranked = state.players.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const me = state.players.find((p) => p.id === player.id);

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <h1>${trouducRankLabel(me?.rank)}${me?.rank === 1 ? ' 🏆' : ''}</h1>
        <ol class="rank-list">
          ${ranked
            .map((p) => `<li>${trouducRankLabel(p.rank)} — ${p.name}${p.id === player.id ? ' (toi)' : ''}</li>`)
            .join('')}
        </ol>
        ${endGameActionsHtml()}
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}

/* ============================== Le 8 américain ============================== */

// Carte "8" en attente du choix de couleur (clic sur l'icône couleur pour valider,
// ou en dehors pour annuler) — distincte de toute autre sélection, remise à zéro
// dès que ce n'est plus mon tour.
let pendingEightCardId = null;

const SUIT_ORDER = ['S', 'H', 'D', 'C'];

function renderAmericainTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) pendingEightCardId = null;

  const topCard = state.discard[state.discard.length - 1];
  const activeSuitChanged = topCard.rank === '8' && state.activeSuit !== topCard.suit;
  const myLegalMove = isMyTurn && hasLegalMove(state, me.hand);
  const mustDraw = isMyTurn && !myLegalMove;

  // Empile les dernières poses (fenêtre glissante côté state — voir americain.js)
  // les unes sur les autres, décalées vers qui les a posées, comme au Trou du
  // Cul. Sans siège fixe ici (jusqu'à 5 adversaires en rang flexible), le
  // décalage horizontal est réparti selon la position de chacun dans la rangée.
  const discardHistory = state.discardHistory && state.discardHistory.length ? state.discardHistory : [{ by: null, cards: [topCard] }];
  const seatShiftFor = (playerId) => {
    if (!playerId) return { x: 0, y: 0 };
    if (playerId === player.id) return { x: 0, y: 26 };
    const seatIndex = others.findIndex((p) => p.id === playerId);
    if (seatIndex === -1) return { x: 0, y: -22 };
    const mid = (others.length - 1) / 2;
    return { x: Math.round((seatIndex - mid) * 16), y: -22 };
  };

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const status = `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
      const handHtml =
        Array.from({ length: Math.min(p.hand.length, 6) }).map(() => cardBackHtml()).join('') +
        (p.hand.length > 6 ? `<span class="opponent__count">+${p.hand.length - 5}</span>` : '');
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand">${handHtml}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${status}</p>
        </div>`;
    })
    .join('');

  const orderedHand = getOrderedHand('americain', me.hand, sortedHand);

  container.innerHTML = `
    <div class="screen screen--table americain-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt americain-felt">
        <div class="americain-center">
          <div class="trouduc-pile trouduc-pile--active">
            <div class="trouduc-pile__stack">
              ${discardHistory
                .map((entry, i) => {
                  const shift = seatShiftFor(entry.by);
                  const stackOffset = i * 4;
                  const isTopmost = i === discardHistory.length - 1;
                  return `<div class="trouduc-pile__shift" style="transform: translate(${shift.x + stackOffset}px, ${shift.y + stackOffset}px); z-index: ${i}">
                            <div class="trouduc-pile__cards ${isTopmost ? 'americain-discard-top' : ''}">
                              ${entry.cards.map(cardFaceHtml).join('')}
                              ${isTopmost && activeSuitChanged ? `<span class="americain-active-suit americain-active-suit--${suitInfo(state.activeSuit).color}">${suitInfo(state.activeSuit).symbol}</span>` : ''}
                            </div>
                          </div>`;
                })
                .join('')}
            </div>
          </div>
          <button type="button" class="americain-stock ${mustDraw ? 'americain-stock--pickable' : ''}" id="btn-draw" ${mustDraw ? '' : 'disabled'}>
            ${cardBackHtml()}
            <span class="americain-stock__count">${state.stock.length}</span>
          </button>
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            isMyTurn
              ? mustDraw
                ? 'Aucun coup possible — pioche'
                : 'Touche une carte jouable'
              : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`
          }
        </div>
        <p class="americain-direction">${state.direction === -1 ? '↺ Sens inversé' : '↻ Sens normal'}</p>

        ${
          pendingEightCardId
            ? `<div class="americain-suit-picker">
                 <p class="americain-suit-picker__label">Choisis la couleur :</p>
                 <div class="americain-suit-picker__options">
                   ${SUIT_ORDER.map((key) => {
                     const s = suitInfo(key);
                     return `<button type="button" class="americain-suit-picker__option americain-suit-picker__option--${s.color}" data-suit="${key}">${s.symbol}</button>`;
                   }).join('')}
                 </div>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-eight">Annuler</button>
               </div>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${me.hand.length}) <small>— glisse pour réordonner</small></p>
        <div class="my-hand__cards">
          ${orderedHand
            .map((c) => {
              const legal = isLegalCard(state, c);
              const playable = isMyTurn && legal;
              return `<div class="hand-card ${playable ? '' : 'hand-card--unplayable'} ${pendingEightCardId === c.id ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${cardFaceHtml(c)}</div>`;
            })
            .join('') || '<p class="my-hand__empty">Tu as fini, bravo ! Suis la suite de la partie ci-dessus.</p>'}
        </div>

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawAmericainCard(room, player.id);
    } catch (err) {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-cancel-eight')?.addEventListener('click', () => {
    pendingEightCardId = null;
    renderAmericainTable(container, { room, player, state, onLeave });
  });

  container.querySelectorAll('.americain-suit-picker__option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const suit = btn.dataset.suit;
      const cardId = pendingEightCardId;
      container.querySelectorAll('.americain-suit-picker__option').forEach((b) => (b.disabled = true));
      try {
        await playAmericainCard(room, player.id, cardId, suit);
        pendingEightCardId = null;
      } catch (err) {
        container.querySelectorAll('.americain-suit-picker__option').forEach((b) => (b.disabled = false));
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  if (isMyTurn) {
    container.querySelectorAll('.my-hand .hand-card:not(.hand-card--unplayable)').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.dataset.cardId;
        const card = me.hand.find((c) => c.id === id);
        if (card.rank === '8') {
          pendingEightCardId = id;
          renderAmericainTable(container, { room, player, state, onLeave });
          return;
        }
        try {
          await playAmericainCard(room, player.id, id);
        } catch (err) {
          alert(err.message || 'Impossible de jouer cette carte.');
        }
      });
    });
  }

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    enableHandDrag(myHandEl, {
      onDrop: (cardId, index) => {
        moveCard('americain', cardId, index);
        renderAmericainTable(container, { room, player, state, onLeave });
      }
    });
  }
}

function renderAmericainEnd(container, { room, player, state, onLeave }) {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const youWon = state.winnerId === player.id;

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <h1>${youWon ? 'Tu as gagné !' : `${winner?.name || '?'} a gagné !`}${youWon ? ' 🏆' : ''}</h1>
        ${endGameActionsHtml()}
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}

/* ============================== Blackjack ============================== */

const BLACKJACK_STATUS_LABEL = { playing: 'En jeu', stood: 'Reste', bust: 'Passé !' };
const BLACKJACK_RESULT_LABEL = { win: 'Gagné 🎉', lose: 'Perdu', push: 'Égalité' };

function renderBlackjackTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';

  const dealerCardsHtml = state.dealer.hidden
    ? cardFaceHtml(state.dealer.hand[0]) + cardBackHtml()
    : state.dealer.hand.map(cardFaceHtml).join('');
  const dealerTotalLabel = state.dealer.hidden ? '' : ` (${handTotal(state.dealer.hand)})`;

  const betFor = (p) => p.bet ?? BLACKJACK_DEFAULT_BET;
  const moneyDeltaFor = (id) => {
    const r = state.results?.[id];
    const target = state.players.find((p) => p.id === id);
    const bet = betFor(target || {});
    return r === 'win' ? bet : r === 'lose' ? -bet : 0;
  };
  const moneyLabelFor = (p) => {
    if (!finished) return `${p.money} 💰 (mise : ${betFor(p)})`;
    const delta = moneyDeltaFor(p.id);
    const deltaLabel = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
    return `${p.money} 💰 (${deltaLabel})`;
  };

  const restHtml = others
    .map((p) => {
      const total = handTotal(p.hand);
      const label = finished ? BLACKJACK_RESULT_LABEL[state.results?.[p.id]] || BLACKJACK_STATUS_LABEL[p.status] : BLACKJACK_STATUS_LABEL[p.status];
      const isTurn = p.id === state.currentPlayerId;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand opponent__hand--revealed">${p.hand.map(cardFaceHtml).join('')}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${total} · ${label}</p>
          <p class="opponent__name">${moneyLabelFor(p)}</p>
        </div>`;
    })
    .join('');

  const meTotal = handTotal(me.hand);
  const myResultLabel = finished ? BLACKJACK_RESULT_LABEL[state.results?.[me.id]] || BLACKJACK_STATUS_LABEL[me.status] : BLACKJACK_STATUS_LABEL[me.status];
  const canAct = isMyTurn && me.status === 'playing' && !finished;

  container.innerHTML = `
    <div class="screen screen--table blackjack-screen">
      <div class="table-felt blackjack-felt">
        <div class="blackjack-dealer">
          <p class="blackjack-dealer__label">🏦 Banque${dealerTotalLabel}</p>
          <div class="blackjack-hand">${dealerCardsHtml}</div>
        </div>

        <div class="pouilleux-zone pouilleux-zone--others">
          ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? 'À toi de jouer'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || 'la banque'}`
          }
        </div>
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${meTotal}) · ${myResultLabel}</p>
        <p class="my-hand__label">${moneyLabelFor(me)}</p>
        <div class="my-hand__cards">${me.hand.map(cardFaceHtml).join('')}</div>

        ${
          canAct
            ? `<div class="blackjack-actions">
                 <button id="btn-hit" class="btn btn--primary">Tirer</button>
                 <button id="btn-stand" class="btn btn--ghost">Rester</button>
               </div>`
            : ''
        }

        ${
          finished
            ? `<div class="blackjack-bet-picker">
                 <label for="bet-slider">Ta mise pour la prochaine manche : <strong id="bet-slider-value">${betFor(me)}</strong> 💰</label>
                 <input type="range" id="bet-slider" min="${BLACKJACK_MIN_BET}" max="${BLACKJACK_MAX_BET}" step="5" value="${betFor(me)}" />
               </div>`
            : ''
        }

        ${finished ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-hit')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await hitBlackjack(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de tirer une carte.');
    }
  });

  container.querySelector('#btn-stand')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await standBlackjack(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de rester.');
    }
  });

  const betSlider = container.querySelector('#bet-slider');
  betSlider?.addEventListener('input', (e) => {
    container.querySelector('#bet-slider-value').textContent = e.target.value;
  });
  betSlider?.addEventListener('change', async (e) => {
    try {
      await setBlackjackBet(room, player.id, Number(e.target.value));
    } catch (err) {
      alert(err.message || 'Impossible de changer la mise.');
    }
  });

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });
}

/* ============================== Flip 7 ============================== */

const FLIP7_STATUS_LABEL = { active: 'En jeu', stayed: 'Resté', busted: 'Passé !' };
const FLIP7_ACTION_LABEL = { freeze: '❄️ Freeze', flipThree: '🔀 Flip Three', secondChance: '🛡️ 2e chance' };

function flip7CardHtml(card) {
  if (card.kind === 'number') return `<div class="flip7-card flip7-card--number">${card.value}</div>`;
  if (card.kind === 'modifier') return `<div class="flip7-card flip7-card--modifier">${card.label}</div>`;
  return `<div class="flip7-card flip7-card--action">${FLIP7_ACTION_LABEL[card.kind] || card.label}</div>`;
}

function renderFlip7Table(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const canAct = isMyTurn && me.status === 'active' && !finished;

  const uniqueCountFor = (p) => p.display.filter((c) => c.kind === 'number').length;
  const statusLabelFor = (p) =>
    finished ? `${FLIP7_STATUS_LABEL[p.status]} · ${p.roundScore ?? 0} pt${(p.roundScore ?? 0) > 1 ? 's' : ''} cette manche` : FLIP7_STATUS_LABEL[p.status];

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="flip7-mini-hand">${p.display.map(flip7CardHtml).join('') || '<span class="flip7-mini-hand__empty">—</span>'}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${uniqueCountFor(p)}/7 · ${statusLabelFor(p)}</p>
          <p class="opponent__name">Score total : ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table flip7-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt flip7-felt">
        ${
          state.flip7PlayerId
            ? `<p class="flip7-banner">🎉 ${state.players.find((p) => p.id === state.flip7PlayerId)?.name || '?'} a réalisé un FLIP 7 !</p>`
            : ''
        }
        ${
          state.gameWinnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.gameWinnerId)?.name || '?'} a atteint ${FLIP7_TARGET_SCORE} points et gagne la partie !</p>`
            : ''
        }
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? 'À toi de flipper'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`
          }
        </div>
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${uniqueCountFor(me)}/7) · ${statusLabelFor(me)}</p>
        <p class="my-hand__label">Score total : ${me.score}${me.id === state.gameWinnerId ? ' 🏆' : ''}</p>
        <div class="flip7-hand">${me.display.map(flip7CardHtml).join('') || '<p class="my-hand__empty">Pas encore de carte cette manche.</p>'}</div>

        ${
          canAct
            ? `<div class="flip7-actions">
                 <button id="btn-hit" class="btn btn--primary">Flip !</button>
                 <button id="btn-stay" class="btn btn--ghost">Rester</button>
               </div>`
            : ''
        }

        ${finished ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-hit')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await hitFlip7(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de flipper une carte.');
    }
  });

  container.querySelector('#btn-stay')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await stayFlip7(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de rester.');
    }
  });

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });
}

/* ============================== Skyjo ============================== */

// Une carte piochée du sabot peut être posée (1 touche/glisser) ou défaussée
// en retournant une case cachée à la place (2 touches rapprochées sur cette
// case) — ce petit état suit la dernière case touchée pour distinguer les
// deux, sans délai ajouté sur les cases où l'ambiguïté n'existe pas (déjà
// face visible, ou carte piochée de la défausse — jamais défaussable) : un
// bouton Flip dédié, à côté de la carte piochée, sert de seconde "source" au
// glisser-déposer/tap-puis-tap à côté de la carte elle-même — voir
// renderSkyjoTable. `null` = aucune action armée (le tap sur une case pose
// directement, comme avant) ; `'flip'` = armé après un tap sur le bouton
// Flip, en attente d'une case cachée à toucher.
let skyjoPendingMode = null; // 'flip' | null

function skyjoValueClass(v) {
  if (v <= -1) return 'skyjo-cell--neg';
  if (v === 0) return 'skyjo-cell--zero';
  if (v <= 4) return 'skyjo-cell--low';
  if (v <= 8) return 'skyjo-cell--mid';
  return 'skyjo-cell--high';
}

// `enableDrop`, uniquement pour sa propre grille : marque chaque case non
// vide comme zone de dépôt (`data-dropzone="skyjo-cell"`) pour le
// glisser-déposer de la carte piochée ou du bouton Flip (voir plus bas).
// `flipTargetFor` (idem, uniquement sa propre grille) surligne les cases
// cachées valides comme cible pendant que le mode Flip est armé.
function skyjoGridHtml(grid, clickableClassFor, enableDrop, flipTargetFor) {
  return `<div class="skyjo-grid">
    ${grid
      .map((cell, i) => {
        let classes = 'skyjo-cell';
        let content = '';
        if (!cell) {
          classes += ' skyjo-cell--empty';
        } else if (!cell.faceUp) {
          classes += ' skyjo-cell--facedown';
        } else {
          classes += ` skyjo-cell--faceup ${skyjoValueClass(cell.card.value)}`;
          content = cell.card.value;
        }
        if (clickableClassFor) classes += ` ${clickableClassFor(cell, i) || ''}`;
        if (flipTargetFor?.(cell, i)) classes += ' skyjo-cell--flip-target';
        const dropAttrs = enableDrop && cell ? 'data-dropzone="skyjo-cell"' : '';
        return `<div class="${classes}" data-index="${i}" ${dropAttrs}>${content}</div>`;
      })
      .join('')}
  </div>`;
}

// Somme des cases déjà retournées d'une grille (0 pour les cases cachées ou
// effacées) : donne un aperçu du score de manche en cours, avant que la
// grille ne soit entièrement révélée.
function skyjoVisibleSum(grid) {
  return grid.reduce((sum, cell) => sum + (cell && cell.faceUp ? cell.card.value : 0), 0);
}

function renderSkyjoTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  if (!isMyTurn || !state.drawnCard) skyjoPendingMode = null;

  const canDraw = isMyTurn && !state.drawnCard && !finished;
  const canAct = isMyTurn && !!state.drawnCard && !finished;
  const topDiscard = state.discard[state.discard.length - 1];

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const roundLabel = finished ? ` · ${p.roundScore ?? 0} pt${(p.roundScore ?? 0) > 1 ? 's' : ''} cette manche` : '';
      const visibleSum = skyjoVisibleSum(p.grid);
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <p class="skyjo-visible-sum">${visibleSum} pt${visibleSum > 1 ? 's' : ''} visible${visibleSum > 1 ? 's' : ''}</p>
          ${skyjoGridHtml(p.grid)}
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}${roundLabel}</p>
        </div>`;
    })
    .join('');

  const myClickableClassFor = (cell, i) => (canAct && cell ? 'skyjo-cell--placeable' : '');
  const canFlip = canAct && state.drawnCard.source === 'deck';
  const myFlipTargetFor = (cell) => Boolean(canFlip && skyjoPendingMode === 'flip' && cell && !cell.faceUp);
  const skyjoFlipIllustration = flipButtonImage(document.documentElement.dataset.cardTheme);
  const myVisibleSum = skyjoVisibleSum(me.grid);

  container.innerHTML = `
    <div class="screen screen--table skyjo-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt skyjo-felt">
        ${
          state.gameWinnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.gameWinnerId)?.name || '?'} termine sous ${SKYJO_TARGET_SCORE} points cumulés et gagne la partie !</p>`
            : ''
        }
        <div class="skyjo-draw-area">
          <button type="button" class="skyjo-pile skyjo-pile--discard ${canDraw ? 'skyjo-pile--pickable' : ''} ${canAct ? 'skyjo-pile--dimmed' : ''}" id="btn-draw-discard" ${canDraw ? '' : 'disabled'} ${canDraw && topDiscard ? 'data-card-id="discard-pile"' : ''}>
            ${topDiscard ? `<div class="skyjo-cell skyjo-cell--faceup ${skyjoValueClass(topDiscard.value)}">${topDiscard.value}</div>` : ''}
            <span class="skyjo-pile__label">Défausse${canDraw && topDiscard ? ' · glisse-la vers ta grille' : ''}</span>
          </button>

          ${
            canAct
              ? `<div class="skyjo-pile skyjo-pile--drawn" id="skyjo-drawn-card">
                   <div class="skyjo-cell skyjo-cell--faceup ${skyjoValueClass(state.drawnCard.card.value)}" data-card-id="drawn">${state.drawnCard.card.value}</div>
                   <span class="skyjo-pile__label">Piochée</span>
                 </div>`
              : `<button type="button" class="skyjo-pile skyjo-pile--deck ${canDraw ? 'skyjo-pile--pickable' : ''}" id="btn-draw-deck" ${canDraw ? '' : 'disabled'}>
                   <div class="skyjo-cell skyjo-cell--facedown"></div>
                   <span class="skyjo-pile__label">Pioche (${state.deck.length})</span>
                 </button>`
          }

          <!-- Toujours affiché à une position fixe (grisé quand non jouable),
               plutôt que d'apparaître/disparaître — évite que la ligne se
               redimensionne selon l'état. -->
          <button type="button" class="skyjo-flip-btn ${skyjoPendingMode === 'flip' ? 'skyjo-flip-btn--armed' : ''} ${canFlip ? '' : 'skyjo-flip-btn--dimmed'} ${skyjoFlipIllustration ? 'skyjo-flip-btn--illustrated' : ''}" id="skyjo-flip-btn" ${canFlip ? 'data-card-id="flip"' : 'disabled'} ${skyjoFlipIllustration ? `style="background-image:url('${skyjoFlipIllustration}')"` : ''}>
            ${skyjoFlipIllustration ? '' : '<span class="skyjo-flip-btn__icon">🔄</span><span>Flip</span>'}
          </button>
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? canDraw
                  ? 'Pioche la défausse ou le sabot'
                  : skyjoPendingMode === 'flip'
                    ? 'Touche une case cachée à retourner'
                    : canFlip
                      ? 'Place ta carte, ou utilise Flip'
                      : 'Place ta carte'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`
          }
        </div>
      </div>

      <div class="my-hand">
        ${finished ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>

      <div class="skyjo-my-grid-dock">
        <p class="my-hand__label">Ta grille · Score total : ${me.score}${me.id === state.gameWinnerId ? ' 🏆' : ''}${finished ? ` · ${me.roundScore ?? 0} pts cette manche` : ''}</p>
        <p class="skyjo-visible-sum">${myVisibleSum} pt${myVisibleSum > 1 ? 's' : ''} visible${myVisibleSum > 1 ? 's' : ''}</p>
        ${skyjoGridHtml(me.grid, myClickableClassFor, canAct || canDraw, myFlipTargetFor)}
      </div>
    </div>
  `;

  container.querySelector('#btn-draw-deck')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawSkyjoFromDeck(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de piocher.');
    }
  });

  const placeCard = (index) => {
    placeSkyjoCard(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };
  const discardAndReveal = (index) => {
    discardSkyjoAndReveal(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };

  if (canAct) {
    container.querySelectorAll('.skyjo-my-grid-dock .skyjo-cell--placeable').forEach((el) => {
      el.addEventListener('click', () => {
        const index = Number(el.dataset.index);
        const cell = me.grid[index];
        // Mode Flip armé (bouton Flip touché juste avant) : cette case doit
        // être cachée pour pouvoir défausser-et-retourner dessus. Sinon
        // (comportement par défaut, le plus courant) : pose directement.
        if (skyjoPendingMode === 'flip') {
          if (!canFlip || !cell || cell.faceUp) {
            alert('Choisis une case cachée pour la retourner.');
            return;
          }
          skyjoPendingMode = null;
          discardAndReveal(index);
          return;
        }
        placeCard(index);
      });
    });
  }

  // Zone de pioche unifiée : selon la phase, la "source" glissable/tapable
  // est soit la défausse (avant pioche), soit la carte piochée + le bouton
  // Flip (après) — jamais les deux en même temps, donc un seul
  // enableDragToZone couvre tout le cycle sans se soucier de canDraw/canAct
  // (querySelectorAll('[data-card-id]') ne trouve que ce qui existe vraiment
  // dans le DOM à ce rendu).
  const drawArea = container.querySelector('.skyjo-draw-area');
  if (drawArea) {
    enableDragToZone(drawArea, {
      onTap: async (id) => {
        if (id === 'discard-pile') {
          const btn = container.querySelector('#btn-draw-discard');
          if (btn) btn.disabled = true;
          try {
            await drawSkyjoFromDiscard(room, player.id);
          } catch (err) {
            if (btn) btn.disabled = false;
            alert(err.message || 'Impossible de prendre la défausse.');
          }
          return;
        }
        if (id === 'flip') {
          skyjoPendingMode = skyjoPendingMode !== 'flip' ? 'flip' : null;
          renderSkyjoTable(container, { room, player, state, onLeave });
        }
        // id === 'drawn' : un tap simple sur la carte piochée elle-même ne fait rien, il faut viser une case.
      },
      onDrop: async (id, zone) => {
        if (zone.dropzone !== 'skyjo-cell') return;
        const index = Number(zone.index);
        if (id === 'discard-pile') {
          try {
            // `room` capture le state d'AVANT la pioche (drawnCard encore nul) :
            // il faut enchaîner sur le room mis à jour que renvoie l'appel
            // précédent, sinon la pose suivante croit qu'aucune carte n'a été
            // piochée ("Pioche d'abord une carte.") et échoue systématiquement.
            const drawn = await drawSkyjoFromDiscard(room, player.id);
            await placeSkyjoCard(drawn, player.id, index);
          } catch (err) {
            alert(err.message || 'Impossible de prendre la défausse et de la poser.');
          }
          return;
        }
        if (id === 'flip') {
          const cell = me.grid[index];
          if (!cell || cell.faceUp) {
            alert('Choisis une case cachée pour la retourner.');
            return;
          }
          discardAndReveal(index);
          return;
        }
        if (id === 'drawn') placeCard(index);
      }
    });
  }

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });
}

/* ========================== La Suite Infernale ========================== */

const SUITE_INFERNALE_SLOT_TARGETED_TYPES = ['retirerUne', 'volerUne'];

function suiteInfernaleCardHtml(card) {
  const theme = document.documentElement.dataset.cardTheme;
  if (card.kind === 'number') return `<div class="suiteinfernale-card suiteinfernale-card--number">${card.value}</div>`;
  const label = SUITE_INFERNALE_SPECIAL_TYPES[card.type]?.label || card.type;
  const illustration = suiteInfernaleSpecialImage(theme, card.type, card.id);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="suiteinfernale-card suiteinfernale-card--special ${illustration ? 'suiteinfernale-card--illustrated' : ''}" title="${label}"${style}>${illustration ? '' : label}</div>`;
}

// Une case remplie par un Joker doit rester visuellement distincte d'un
// numéro normal (on ne voit sinon pas qu'on attaque un Joker +2 plutôt
// qu'un vrai numéro, par exemple) : contenu + info-bulle différents.
function suiteInfernaleSlotContent(card) {
  if (!card) return '';
  if (card.kind === 'number') return card.value;
  return card.type === 'jokerPlus2' ? '🃏²' : '🃏';
}

function suiteInfernaleSlotTitle(card, index) {
  if (!card) return `Case ${index + 1} (vide)`;
  if (card.kind === 'number') return `${card.value}`;
  return SUITE_INFERNALE_SPECIAL_TYPES[card.type]?.label || card.type;
}

/**
 * `targetId`, uniquement pour la suite d'un adversaire : marque chaque case
 * remplie comme zone de dépôt précise (`opponent-slot`) pour le
 * glisser-déposer d'une attaque ciblée (ex : retirer/voler LA carte visée),
 * en plus de la zone globale posée sur `.opponent` (voir `restHtml`).
 */
function suiteInfernaleSequenceHtml(sequence, { clickableIndexes, targetId } = {}) {
  return `<div class="suiteinfernale-sequence">
    ${sequence
      .map((card, i) => {
        const clickable = clickableIndexes && clickableIndexes.includes(i);
        const isJoker = card && card.kind === 'special';
        const dropAttrs = targetId && card ? `data-dropzone="opponent-slot" data-target-id="${targetId}" data-slot-index="${i}"` : '';
        return `<div class="suiteinfernale-slot ${card ? 'suiteinfernale-slot--filled' : ''} ${isJoker ? 'suiteinfernale-slot--joker' : ''} ${clickable ? 'suiteinfernale-slot--pickable' : ''}" data-index="${i}" ${dropAttrs} title="${suiteInfernaleSlotTitle(card, i)}">${suiteInfernaleSlotContent(card) || i + 1}</div>`;
      })
      .join('')}
  </div>`;
}

function suiteInfernaleHighestFilledIndex(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i]) return i;
  }
  return -1;
}

function suiteInfernalePlayable(card, me) {
  const neededIndex = me.sequence.findIndex((c) => !c);
  const filledCount = me.sequence.filter(Boolean).length;
  if (card.kind === 'number') return neededIndex !== -1 && card.value === neededIndex + 1;
  if (card.type === 'jokerPlus1') return neededIndex !== -1;
  if (card.type === 'jokerPlus2') return neededIndex !== -1 && filledCount > 0 && neededIndex < 8;
  if (card.type === 'stop') return false; // uniquement jouable en réaction à une attaque
  return true; // rejouer + les 6 types ciblés
}

// Carte en cours de sélection d'une cible (et, pour "retirer/voler 1 carte",
// d'une case précise dans la suite de la cible une fois choisie) — mémorisé
// en dehors du rendu, sur le même principe que `pendingEightCardId` au 8
// américain. `suiteInfernaleDiscardMode` bascule le clic sur une carte en
// main vers une défausse plutôt qu'une tentative de jeu.
let pendingSuiteInfernaleCardId = null;
let pendingSuiteInfernaleTargetId = null;
let suiteInfernaleDiscardMode = false;

// Une attaque en attente reste visible de tous (pas seulement de la cible)
// pendant qu'elle attend une réponse ; une fois résolue (bloquée ou non), le
// message de résolution reste affiché ~1,5s pour que tout le monde le voie
// avant de disparaître — même principe que `pileClearTimerFor` plus haut
// dans ce fichier (pli du Trou du Cul), adapté avec un simple drapeau de
// transition plutôt qu'un id, une seule attaque ne pouvant être en attente
// à la fois.
let suiteInfernaleAttackWasPending = false;
let suiteInfernaleResolutionBanner = null;

function renderSuiteInfernaleTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const reaction = state.pendingAttack && state.pendingAttack.targetId === player.id ? state.pendingAttack : null;
  if (!isMyTurn || state.pendingAttack) {
    pendingSuiteInfernaleCardId = null;
    pendingSuiteInfernaleTargetId = null;
  }
  if (!isMyTurn) suiteInfernaleDiscardMode = false;

  if (state.pendingAttack) {
    suiteInfernaleAttackWasPending = true;
  } else if (suiteInfernaleAttackWasPending) {
    suiteInfernaleAttackWasPending = false;
    const message = state.log[state.log.length - 1]?.message;
    if (message) {
      suiteInfernaleResolutionBanner = message;
      window.setTimeout(() => {
        suiteInfernaleResolutionBanner = null;
        renderSuiteInfernaleTable(container, { room, player, state, onLeave });
      }, 1500);
    }
  }

  const pendingAttackInfo = state.pendingAttack
    ? {
        attackerName: state.players.find((p) => p.id === state.pendingAttack.byId)?.name || '?',
        targetName: state.players.find((p) => p.id === state.pendingAttack.targetId)?.name || '?',
        label: SUITE_INFERNALE_SPECIAL_TYPES[state.pendingAttack.type]?.label || state.pendingAttack.type
      }
    : null;

  const canDraw = isMyTurn && !state.hasDrawnThisTurn && !finished && !state.pendingAttack;
  const canAct = isMyTurn && state.hasDrawnThisTurn && !finished && !state.pendingAttack;

  const pendingCard = pendingSuiteInfernaleCardId ? me.hand.find((c) => c.id === pendingSuiteInfernaleCardId) : null;
  const validTargets = pendingCard
    ? others.filter((o) => {
        if (pendingCard.type === 'volerDerniere') return suiteInfernaleHighestFilledIndex(o.sequence) !== -1;
        if (pendingCard.type === 'retirerDeux') {
          const h = suiteInfernaleHighestFilledIndex(o.sequence);
          return h >= 1 && o.sequence[h] && o.sequence[h - 1];
        }
        if (SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type)) return o.sequence.some(Boolean);
        return true; // echangerJeu, changerPlace
      })
    : [];
  const pendingTarget = pendingSuiteInfernaleTargetId ? others.find((o) => o.id === pendingSuiteInfernaleTargetId) : null;
  const awaitingSlotChoice = pendingCard && pendingTarget && SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type);

  const myStopCard = me.hand.find((c) => c.kind === 'special' && c.type === 'stop');
  const dragMode = isSuiteInfernaleDragEnabled();

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const isPendingTarget = pendingTarget?.id === p.id;
      const clickableIndexes = awaitingSlotChoice && isPendingTarget ? p.sequence.map((c, i) => (c ? i : -1)).filter((i) => i !== -1) : null;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}" data-player-id="${p.id}" data-dropzone="opponent" data-target-id="${p.id}">
          ${suiteInfernaleSequenceHtml(p.sequence, { clickableIndexes, targetId: p.id })}
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${p.sequence.filter(Boolean).length}/${SUITE_INFERNALE_TARGET} · ${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table suiteinfernale-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt suiteinfernale-felt">
        ${
          state.winnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.winnerId)?.name || '?'} termine sa suite et gagne la partie !</p>`
            : ''
        }
        <p class="suiteinfernale-deck-count">Pioche : ${state.deck.length} carte${state.deck.length > 1 ? 's' : ''}</p>

        ${
          (() => {
            const text = finished
              ? 'Partie terminée'
              : state.pendingAttack
                ? '' // le bandeau d'attaque ci-dessous suffit
                : isMyTurn
                  ? canDraw
                    ? '' // redondant avec le bouton "Piocher" ci-dessous
                    : 'Joue une carte, ou défausses-en une'
                  : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
            return text ? `<div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${text}</div>` : '';
          })()
        }

        ${
          pendingAttackInfo
            ? `<div class="suiteinfernale-attack-banner">
                 <p>${pendingAttackInfo.attackerName} attaque ${pendingAttackInfo.targetName} avec ${pendingAttackInfo.label} !</p>
               </div>`
            : suiteInfernaleResolutionBanner
              ? `<div class="suiteinfernale-attack-banner suiteinfernale-attack-banner--resolved"><p>${suiteInfernaleResolutionBanner}</p></div>`
              : ''
        }

        ${
          reaction
            ? `<div class="suiteinfernale-reaction">
                 <div class="suiteinfernale-reaction__options">
                   <button type="button" class="btn btn--primary btn--small" id="btn-stop" ${myStopCard ? '' : 'disabled'}>🛑 Bloquer avec un STOP</button>
                   <button type="button" class="btn btn--ghost btn--small" id="btn-allow">Laisser passer</button>
                 </div>
               </div>`
            : ''
        }

        ${
          pendingCard && !awaitingSlotChoice
            ? `<div class="suiteinfernale-target-picker">
                 <p class="suiteinfernale-target-picker__label">Choisis la cible :</p>
                 <div class="suiteinfernale-target-picker__options">
                   ${validTargets.map((p) => `<button type="button" class="btn btn--ghost btn--small suiteinfernale-target-picker__option" data-target-id="${p.id}">${p.name}</button>`).join('') || '<p class="suiteinfernale-target-picker__empty">Aucune cible valide pour cette carte.</p>'}
                 </div>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-special">Annuler</button>
               </div>`
            : ''
        }
        ${
          awaitingSlotChoice
            ? `<div class="suiteinfernale-target-picker">
                 <p class="suiteinfernale-target-picker__label">Touche la carte de ${pendingTarget.name} à cibler, ci-dessus.</p>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-special">Annuler</button>
               </div>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label" ${dragMode ? `title="Dépose une carte ici pour la jouer."` : ''}>Ta suite (${me.sequence.filter(Boolean).length}/${SUITE_INFERNALE_TARGET})${dragMode ? ' <small>ℹ️</small>' : ''}</p>
        <div data-dropzone="own-sequence">${suiteInfernaleSequenceHtml(me.sequence)}</div>

        ${canDraw ? `<div class="suiteinfernale-actions"><button id="btn-draw" class="btn btn--primary">Piocher</button></div>` : ''}
        ${
          canAct && !pendingCard
            ? `<div class="suiteinfernale-actions">
                 ${dragMode ? `<div class="suiteinfernale-discard" data-dropzone="discard" title="Dépose une carte ici pour la défausser.">🗑️<span>Défausse</span></div>` : ''}
                 ${!dragMode ? `<button id="btn-discard-mode" class="btn ${suiteInfernaleDiscardMode ? 'btn--primary' : 'btn--ghost'}">${suiteInfernaleDiscardMode ? 'Touche une carte à défausser' : 'Défausser une carte'}</button>` : ''}
               </div>`
            : ''
        }

        <p class="my-hand__label" ${dragMode ? `title="Glisse une carte vers ta suite, un adversaire ou la défausse."` : `title="Touche une carte pour la jouer, ou choisir sa cible."`}>Ta main (${me.hand.length}) <small>ℹ️</small></p>
        <div class="my-hand__cards suiteinfernale-hand" id="suiteinfernale-hand">
          ${me.hand
            .map((c) => {
              const playable = canAct && !suiteInfernaleDiscardMode && suiteInfernalePlayable(c, me);
              const discardable = canAct && suiteInfernaleDiscardMode;
              return `<div class="hand-card ${playable || discardable ? '' : 'hand-card--unplayable'} ${pendingSuiteInfernaleCardId === c.id ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${suiteInfernaleCardHtml(c)}</div>`;
            })
            .join('') || '<p class="my-hand__empty">Main vide.</p>'}
        </div>

        ${finished ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawSuiteInfernale(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de piocher.');
    }
  });

  container.querySelector('#btn-discard-mode')?.addEventListener('click', () => {
    suiteInfernaleDiscardMode = !suiteInfernaleDiscardMode;
    renderSuiteInfernaleTable(container, { room, player, state, onLeave });
  });

  container.querySelector('#btn-stop')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await respondToSuiteInfernaleAttack(room, player.id, { block: true, stopCardId: myStopCard.id });
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de bloquer cette attaque.');
    }
  });

  container.querySelector('#btn-allow')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await respondToSuiteInfernaleAttack(room, player.id, { block: false });
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible de laisser passer l'attaque.");
    }
  });

  container.querySelector('#btn-cancel-special')?.addEventListener('click', () => {
    pendingSuiteInfernaleCardId = null;
    pendingSuiteInfernaleTargetId = null;
    renderSuiteInfernaleTable(container, { room, player, state, onLeave });
  });

  container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.targetId;
      const cardId = pendingSuiteInfernaleCardId;
      if (SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type)) {
        pendingSuiteInfernaleTargetId = targetId;
        renderSuiteInfernaleTable(container, { room, player, state, onLeave });
        return;
      }
      container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((b) => (b.disabled = true));
      try {
        await playSuiteInfernaleAttack(room, player.id, cardId, targetId, null);
        pendingSuiteInfernaleCardId = null;
      } catch (err) {
        container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((b) => (b.disabled = false));
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  if (awaitingSlotChoice) {
    container.querySelectorAll(`.opponent[data-player-id="${pendingTarget.id}"] .suiteinfernale-slot--pickable`).forEach((el) => {
      el.addEventListener('click', async () => {
        const slotIndex = Number(el.dataset.index);
        const cardId = pendingSuiteInfernaleCardId;
        const targetId = pendingSuiteInfernaleTargetId;
        try {
          await playSuiteInfernaleAttack(room, player.id, cardId, targetId, slotIndex);
          pendingSuiteInfernaleCardId = null;
          pendingSuiteInfernaleTargetId = null;
        } catch (err) {
          alert(err.message || 'Impossible de jouer cette carte.');
        }
      });
    });
  }

  if (canAct && !pendingCard) {
    // Tap simple : même flux qu'avant (choix de cible/case via les boutons
    // pour les cartes ciblées). Glisser-déposer : dépôt direct sur la zone
    // visée (sa propre suite, un adversaire — précisément sur sa carte pour
    // "retirer/voler 1 carte" — ou la défausse), en un seul geste.
    const handEl = container.querySelector('#suiteinfernale-hand');
    if (handEl) {
      enableDragToZone(handEl, {
        dragEnabled: dragMode,
        onTap: async (id) => {
          const card = me.hand.find((c) => c.id === id);
          if (!card) return;

          if (suiteInfernaleDiscardMode) {
            try {
              await discardSuiteInfernale(room, player.id, id);
              suiteInfernaleDiscardMode = false;
            } catch (err) {
              alert(err.message || 'Impossible de défausser cette carte.');
            }
            return;
          }

          if (card.kind === 'number' || card.type === 'jokerPlus1' || card.type === 'jokerPlus2') {
            try {
              await playSuiteInfernaleSequenceCard(room, player.id, id);
            } catch (err) {
              alert(err.message || 'Impossible de jouer cette carte.');
            }
            return;
          }
          if (card.type === 'rejouer') {
            try {
              await playSuiteInfernaleRejouer(room, player.id, id);
            } catch (err) {
              alert(err.message || 'Impossible de jouer cette carte.');
            }
            return;
          }

          pendingSuiteInfernaleCardId = id;
          pendingSuiteInfernaleTargetId = null;
          renderSuiteInfernaleTable(container, { room, player, state, onLeave });
        },
        onDrop: async (id, zone) => {
          const card = me.hand.find((c) => c.id === id);
          if (!card) return;

          try {
            if (zone.dropzone === 'discard') {
              await discardSuiteInfernale(room, player.id, id);
              return;
            }
            if (card.kind === 'number' || card.type === 'jokerPlus1' || card.type === 'jokerPlus2') {
              if (zone.dropzone !== 'own-sequence') {
                alert('Dépose cette carte sur ta suite pour la jouer.');
                return;
              }
              await playSuiteInfernaleSequenceCard(room, player.id, id);
              return;
            }
            if (card.type === 'rejouer') {
              if (zone.dropzone !== 'own-sequence') {
                alert('Dépose cette carte sur ta suite pour la jouer.');
                return;
              }
              await playSuiteInfernaleRejouer(room, player.id, id);
              return;
            }
            if (card.type === 'stop') {
              alert('Le STOP ne se joue que pour contrer une attaque adverse, en réaction.');
              return;
            }
            if (zone.dropzone === 'opponent' || zone.dropzone === 'opponent-slot') {
              const needsSlot = SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(card.type);
              if (needsSlot && zone.dropzone !== 'opponent-slot') {
                alert('Dépose cette carte précisément sur la carte de la suite adverse à cibler.');
                return;
              }
              const slotIndex = needsSlot ? Number(zone.slotIndex) : null;
              await playSuiteInfernaleAttack(room, player.id, id, zone.targetId, slotIndex);
              return;
            }
            alert('Dépose cette carte sur ta suite, sur un adversaire, ou sur la défausse.');
          } catch (err) {
            alert(err.message || 'Impossible de jouer cette carte.');
          }
        }
      });
    }
  }

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });
}

function cinqRoisRoleForRank(rank) {
  if (rank === 11) return 'valet';
  if (rank === 12) return 'dame';
  if (rank === 13) return 'roi';
  return 'number';
}

function cinqRoisCardHtml(card, trumpRank, selected = false) {
  const theme = document.documentElement.dataset.cardTheme;

  if (card.isJoker) {
    const illustration = jokerImage(theme, card.id);
    const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
    return `<div class="cinqrois-card cinqrois-card--joker ${illustration ? 'cinqrois-card--illustrated' : ''} ${selected ? 'cinqrois-card--selected' : ''}" data-card-id="${card.id}"${style}>${illustration ? '' : '!'}</div>`;
  }

  const info = cinqRoisSuitInfo(card.suit);
  const isTrump = card.rank === trumpRank;
  const illustration = suitCardImage(theme, card.suit, cinqRoisRoleForRank(card.rank));
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  const colorClass = illustration
    ? 'cinqrois-card--illustrated'
    : info?.color === 'red'
      ? 'cinqrois-card--red'
      : info?.color === 'gold'
        ? 'cinqrois-card--gold'
        : 'cinqrois-card--dark';
  return `<div class="cinqrois-card ${colorClass} ${isTrump ? 'cinqrois-card--trump' : ''} ${selected ? 'cinqrois-card--selected' : ''}" data-card-id="${card.id}"${style}>
    <span class="cinqrois-card__rank">${cinqRoisRankLabel(card.rank)}</span>
    <span class="cinqrois-card__suit">${info?.symbol || ''}</span>
  </div>`;
}

function cinqRoisCardBackHtml() {
  const illustration = cardBackImage(document.documentElement.dataset.cardTheme);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="cinqrois-card cinqrois-card--back ${illustration ? 'cinqrois-card--back-illustrated' : ''}"${style}></div>`;
}

function renderCinqRoisTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn =
    (state.status === 'playing' || state.status === 'last_turns') &&
    state.currentPlayerId === player.id &&
    me &&
    !me.laidDown;
  const isFinished = state.status === 'finished';
  const topDiscard = state.discard[state.discard.length - 1];

  const othersHtml = state.players
    .filter((p) => p.id !== player.id)
    .map((p) => {
      const isTurn = state.currentPlayerId === p.id;
      let status = p.laidDown ? 'Posé ✓' : isTurn ? 'À jouer…' : `${p.hand.length} cartes`;
      if (isFinished && state.roundScores) status = `+${state.roundScores[p.id] ?? 0} · total ${p.score}`;
      return `
        <div class="cinqrois-seat ${isTurn ? 'cinqrois-seat--turn' : ''} ${p.laidDown ? 'cinqrois-seat--laid' : ''}">
          <p class="cinqrois-seat__name">${p.name}${connectionBadge(state, p.id)} <span class="cinqrois-seat__score">(${p.score})</span></p>
          <p class="cinqrois-seat__status">${status}</p>
          <div class="cinqrois-seat__backs">${Array(Math.min(p.hand.length, 13)).fill(cinqRoisCardBackHtml()).join('')}</div>
        </div>`;
    })
    .join('');

  const sortedHand = me
    ? me.hand.slice().sort((a, b) => {
        if (a.isJoker !== b.isJoker) return a.isJoker ? 1 : -1;
        if (a.rank !== b.rank) return (a.rank || 99) - (b.rank || 99);
        return (a.suit || '').localeCompare(b.suit || '');
      })
    : [];

  let actionsHtml = '';
  if (isFinished) {
    const winner = state.gameWinnerId ? state.players.find((p) => p.id === state.gameWinnerId) : null;
    actionsHtml = `
      <div class="cinqrois-actions">
        ${
          winner
            ? `<p class="cinqrois-winner">🏆 ${winner.name} gagne avec ${winner.score} points !</p>`
            : `<p class="cinqrois-winner">Manche terminée — enchaîne ou retourne au lobby.</p>`
        }
        ${endGameActionsHtml()}
      </div>`;
  } else if (isMyTurn && state.phase === 'draw') {
    actionsHtml = `
      <div class="cinqrois-actions">
        <button id="btn-cinqrois-stock" class="btn btn--primary">Pioche (${state.stock.length})</button>
        <button id="btn-cinqrois-discard-draw" class="btn btn--secondary" ${
          topDiscard ? '' : 'disabled'
        }>Prendre défausse ${
          topDiscard
            ? topDiscard.isJoker
              ? '(!)'
              : `(${cinqRoisRankLabel(topDiscard.rank)}${cinqRoisSuitInfo(topDiscard.suit)?.symbol || ''})`
            : ''
        }</button>
      </div>`;
  } else if (isMyTurn && state.phase === 'discard') {
    actionsHtml = `
      <div class="cinqrois-actions">
        <p class="cinqrois-hint">Choisis une carte à défausser, puis éventuellement pose ta main.</p>
        <button id="btn-cinqrois-discard" class="btn btn--primary" disabled>Défausser</button>
        <button id="btn-cinqrois-goout" class="btn btn--secondary" disabled>Défausser &amp; poser</button>
      </div>`;
  } else if (me?.laidDown) {
    actionsHtml = `<p class="cinqrois-hint">Tu as posé ta main — en attente des autres…</p>`;
  }

  const myStatus = isFinished && state.roundScores ? ` — +${state.roundScores[me?.id] ?? 0} pts cette manche` : '';

  container.innerHTML = `
    <div class="screen screen--table cinqrois-screen">
      <p class="eyebrow">Cinq Rois · manche ${state.handSize}/13 · atout ${cinqRoisRankLabel(state.trumpRank)}${
        state.status === 'last_turns' ? ' · derniers tours' : ''
      }</p>
      <div class="cinqrois-opponents">${othersHtml || '<p class="cinqrois-empty">Aucun adversaire</p>'}</div>
      <div class="cinqrois-center">
        <div class="cinqrois-pile">
          ${cinqRoisCardBackHtml()}
          <span class="cinqrois-pile__label">Pioche ${state.stock.length}</span>
        </div>
        <div class="cinqrois-discard">
          ${
            topDiscard
              ? cinqRoisCardHtml(topDiscard, state.trumpRank)
              : '<div class="cinqrois-card cinqrois-card--empty">—</div>'
          }
          <span class="cinqrois-pile__label">Défausse</span>
        </div>
      </div>
      <div class="cinqrois-me ${isMyTurn ? 'cinqrois-me--turn' : ''} ${me?.laidDown ? 'cinqrois-me--laid' : ''}">
        <p class="cinqrois-me__name">Toi${connectionBadge(state, me?.id)} (${me?.score ?? 0} pts)${me?.laidDown ? ' — posé ✓' : ''}${myStatus}</p>
        <div class="cinqrois-me__hand" id="cinqrois-hand">
          ${sortedHand.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('') || '<p class="cinqrois-empty">—</p>'}
        </div>
      </div>
      ${actionsHtml}

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>

      <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
      <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
    </div>`;

  if (isFinished) wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal('cinqrois'));
  wireAbandonButton(container, { room, player, state, onLeave });

  let selectedCardId = null;
  const refreshSelection = () => {
    container.querySelectorAll('#cinqrois-hand .cinqrois-card').forEach((el) => {
      el.classList.toggle('cinqrois-card--selected', el.dataset.cardId === selectedCardId);
    });
    const discardBtn = container.querySelector('#btn-cinqrois-discard');
    const goOutBtn = container.querySelector('#btn-cinqrois-goout');
    if (discardBtn) discardBtn.disabled = !selectedCardId;
    if (goOutBtn) {
      if (!selectedCardId || !me) {
        goOutBtn.disabled = true;
      } else {
        const remaining = me.hand.filter((c) => c.id !== selectedCardId);
        goOutBtn.disabled = remaining.length < 3 || !cinqRoisCanGoOut(remaining, state.trumpRank);
      }
    }
  };

  if (isMyTurn && state.phase === 'discard') {
    container.querySelectorAll('#cinqrois-hand .cinqrois-card').forEach((el) => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        selectedCardId = el.dataset.cardId;
        refreshSelection();
      });
    });
  }

  container.querySelector('#btn-cinqrois-stock')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawCinqRoisFromStock(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de piocher.');
    }
  });
  container.querySelector('#btn-cinqrois-discard-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawCinqRoisFromDiscard(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de prendre la défausse.');
    }
  });
  container.querySelector('#btn-cinqrois-discard')?.addEventListener('click', async (e) => {
    if (!selectedCardId) return;
    e.target.disabled = true;
    try {
      await discardCinqRois(room, player.id, selectedCardId, false);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de défausser.');
    }
  });
  container.querySelector('#btn-cinqrois-goout')?.addEventListener('click', async (e) => {
    if (!selectedCardId) return;
    e.target.disabled = true;
    try {
      await discardCinqRois(room, player.id, selectedCardId, true);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de poser.');
    }
  });
}

/**
 * Vue lecture seule d'une partie en cours, pour quelqu'un qui n'y participe pas
 * (arrivé après le lancement, ou en attente de la manche suivante). Volontairement
 * simplifiée par rapport à la table "joueur" (pas de main perso à afficher, pas
 * besoin de gérer les cas où le spectateur ne fait pas partie de `state.players`).
 */
export function renderSpectatorGame(container, { room, gameLabel, onBackToRooms }) {
  const state = room.state;
  const isTrouduc = room.game === 'trouduc';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const pileHtml = isTrouduc
    ? state.pileCount > 0
      ? `<div class="trouduc-pile trouduc-pile--active">
           <div class="trouduc-pile__cards">${state.pile.map(cardFaceHtml).join('')}</div>
           <p class="trouduc-pile__label">${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}</p>
         </div>`
      : `<p class="trouduc-pile__empty">Pli libre</p>`
    : '';

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Tu regardes — ${gameLabel || 'partie'} en cours</p>
        <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>

        <ul class="spectator-players">
          ${state.players
            .map((p) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = p.finished
                ? isTrouduc
                  ? trouducRankLabel(p.rank)
                  : 'sorti·e'
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const roleLabel = p.role ? `${p.role} · ` : '';
              const handHtml = revealHands && p.hand.length ? `<div class="spectator-player__hand">${p.hand.map(cardFaceHtml).join('')}</div>` : '';
              return `
                <li class="spectator-player ${isTurn ? 'spectator-player--turn' : ''}">
                  <div class="spectator-player__row">
                    <span class="spectator-player__name">${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''}</span>
                    <span class="spectator-player__status">${roleLabel}${status}</span>
                  </div>
                  ${handHtml}
                </li>`;
            })
            .join('')}
        </ul>

        <button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>

        ${pileHtml}

        <div class="turn-banner">${currentName ? `Tour de ${currentName}` : 'En attente…'}</div>
      </div>

      <details class="log" open>
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderSpectatorGame(container, { room, gameLabel, onBackToRooms });
  });

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => {
    onBackToRooms?.();
  });
}
