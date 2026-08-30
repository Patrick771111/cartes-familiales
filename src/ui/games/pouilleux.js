import { cardFaceHtml, cardBackHtml } from '../cards.js';
import { drawForCurrentPlayer, playerToDrawFrom as computeTarget } from '../../game/pouilleux.js';
import { getOrderedHand, moveCard, resetHandOrder } from '../handOrder.js';
import { enableHandDrag } from '../dragReorder.js';
import { openRulesModal } from '../rules.js';
import {
  connectionBadge,
  sortedHand,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  vibrate,
  getRevealHands,
  toggleRevealHands,
  orderedOpponents,
  openLogModal,
  shareInviteLink,
  threeDToggleHtml,
  wireThreeDToggle
} from '../gameShared.js';
import { is3DEnabled } from '../settings.js';
import {
  mountFan,
  positionFan,
  updateFan,
  showFan,
  hideFan,
  hideAllFans,
  flipCardAt,
  setCardHighlight,
  fadeOutCard,
  descendCard,
  getCardScreenRects
} from '../../three/pouilleuxScene.js';

// Durée du retournement 3D (voir flipCardAt) — nommée ici plutôt que de
// compter sur sa valeur par défaut, pour caler dessus le déclenchement à
// 80% de rotation de la chorégraphie paire/descente (renderDrawReveal3D).
const FLIP_DURATION = 700;

let lastRenderedState = null;

// Pendant qu'une révélation de tirage est affichée (overlay 2D ou
// retournement 3D, voir renderDrawReveal2D/3D), un timestamp (performance.now())
// jusqu'auquel ignorer tout nouveau rendu externe — sinon un coup de bot
// planifié ~1-1.7s après ce tirage (voir schedule() dans pouilleux.bot.js),
// ou un doublon temps réel/relais WebRTC du même état, arrive PENDANT les
// ~1.4-1.9s d'affichage et reconstruit tout le stage 3D (ou remplace l'overlay
// 2D) en plein milieu : la carte qui se retourne se fige à 90°, le canvas est
// caché par hide3D() puis réapparaît déjà entièrement retournée. On patiente
// donc jusqu'à la fin de CETTE révélation avant d'appliquer le rendu suivant
// (voir renderTable et flushPendingRender ci-dessous).
let revealActiveUntil = 0;
let pendingRenderArgs = null;

// Hook générique lu par src/ui/game.js (hideAllThreeDScenes) — c'est CE
// fichier qui "s'inscrit" à la 3D, les fichiers communs n'ont besoin de
// connaître aucun jeu en particulier pour savoir masquer sa scène au bon moment.
export function hide3D() {
  if (performance.now() < revealActiveUntil) return;
  hideAllFans();
}

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  lastRenderedState = null;
  revealActiveUntil = 0;
  pendingRenderArgs = null;
  resetHandOrder('pouilleux');
}

/** Applique le rendu resté en attente pendant la révélation qui vient de se terminer, s'il y en a un. */
function flushPendingRender() {
  revealActiveUntil = 0;
  if (!pendingRenderArgs) return;
  const { container, args } = pendingRenderArgs;
  pendingRenderArgs = null;
  renderTable(container, args);
}

/** Mode 3D actif pour CET état : jamais en même temps que "mains dévoilées" (showFaces, texte/faces réelles que la 3D ne sait pas dessiner pour un adversaire) — cas volontairement laissé en 2D. */
function shouldUse3D(state, player) {
  const me = state.players.find((p) => p.id === player.id);
  const isSafe = me.hand.length === 0;
  const showFaces = isSafe && getRevealHands();
  return is3DEnabled('pouilleux') && !showFaces;
}

export function renderTable(container, args) {
  // Une révélation de tirage est encore affichée : ne pas la couper en la
  // remplaçant tout de suite, on rejoue ce rendu (avec son état le plus
  // récent) une fois qu'elle se termine — voir flushPendingRender.
  if (performance.now() < revealActiveUntil) {
    pendingRenderArgs = { container, args };
    return;
  }
  renderTableImpl(container, args);
}

function renderTableImpl(container, { room, player, state, onLeave }) {
  const previous = lastRenderedState;
  const isNewDraw = previous && state.lastDraw && (!previous.lastDraw || previous.lastDraw.id !== state.lastDraw.id);
  const use3D = shouldUse3D(state, player);

  if (isNewDraw) {
    lastRenderedState = state;
    if (use3D) renderDrawReveal3D(container, { previousState: previous, newState: state, player, room, onLeave });
    else renderDrawReveal2D(container, { previousState: previous, newState: state, player, room, onLeave });
    return;
  }
  lastRenderedState = state;

  if (state.status === 'finished') {
    renderEndScreen(container, { room, player, onLeave });
    return;
  }
  if (use3D) renderTableNow3D(container, { room, player, state, onLeave });
  else renderTableNow2D(container, { room, player, state, onLeave });
}

function renderDrawReveal2D(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow2D(container, { room: { ...room, state: previousState }, player, state: previousState, onLeave });

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
  const duration = reduceMotion ? 500 : isOddCard || safeNames.length ? 1900 : 1400;
  revealActiveUntil = performance.now() + duration;
  window.setTimeout(() => {
    if (newState.status === 'finished') {
      renderEndScreen(container, { room, player, onLeave });
    } else {
      renderTableNow2D(container, { room, player, state: newState, onLeave });
    }
    flushPendingRender();
  }, duration);
}

/**
 * Chorégraphie de fin de retournement pour la carte `idx` de "stage",
 * partagée entre "je viens de piocher" (ma propre main visible dans "mine")
 * et "je regarde deux autres joueurs s'affronter" (main cachée du tireur
 * dans "mine", voir renderDrawReveal3D). `secondHandBefore` est la main du
 * joueur qui reçoit la carte, dans le même ordre que ses cartes affichées
 * dans "mine", AVANT le tirage. "À partir de 80% de rotation" (voir demande
 * utilisateur) : paire détectée -> contour doré puis disparition des 2
 * cartes ; sinon la carte descend, direction visuelle vers l'éventail "mine"
 * affiché juste en dessous (pas de déplacement littéral entre les deux
 * canvas indépendants — simplification assumée).
 */
function scheduleFlipConclusion(idx, draw, secondHandBefore) {
  const pairIdx = draw.paired ? secondHandBefore.findIndex((c) => c.rank === draw.card.rank) : -1;
  window.setTimeout(() => {
    if (draw.paired && pairIdx !== -1) {
      setCardHighlight('stage', idx, true);
      setCardHighlight('mine', pairIdx, true);
      window.setTimeout(() => {
        fadeOutCard('stage', idx);
        fadeOutCard('mine', pairIdx);
      }, 250);
    } else {
      descendCard('stage', idx, { duration: 450, distance: 1.2 });
    }
  }, FLIP_DURATION * 0.8);
}

/**
 * Version 3D de la révélation d'un tirage : la carte piochée pivote sur
 * elle-même pour dévoiler sa face (voir flipCardAt) au lieu du grand
 * médaillon 2D — seulement si la main d'où l'on a piocher n'était pas déjà
 * affichée face visible (voir "ta main" quand on est soi-même la cible, plus
 * rien à révéler dans ce cas).
 */
function renderDrawReveal3D(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow3D(container, { room: { ...room, state: previousState }, player, state: previousState, onLeave });

  const draw = newState.lastDraw;
  const drawer = previousState.players.find((p) => p.id === draw.by);
  const target = previousState.players.find((p) => p.id === draw.from);
  const targetWasMe = draw.from === player.id;

  if (!targetWasMe && target) {
    const idx = target.hand.findIndex((c) => c.id === draw.card.id);
    if (idx !== -1) {
      flipCardAt('stage', idx, { rank: draw.card.rank, suit: draw.card.suit }, { duration: FLIP_DURATION });

      // Chorégraphie de fin de retournement (voir scheduleFlipConclusion) :
      // soit c'est MOI qui viens de piocher (draw.by === player.id, ma main
      // face visible est dans "mine" via renderTableNow3D), soit — à 3
      // joueurs ou plus — je regarde deux AUTRES joueurs s'affronter et
      // "mine" montre alors la main cachée du tireur (spectatingOthers dans
      // renderTableNow3D, exactement les mêmes conditions que ce `else`).
      if (draw.by === player.id) {
        const me = previousState.players.find((p) => p.id === player.id);
        const myHandBefore = getOrderedHand('pouilleux', me.hand, sortedHand);
        scheduleFlipConclusion(idx, draw, myHandBefore);
      } else if (drawer) {
        scheduleFlipConclusion(idx, draw, drawer.hand);
      }
    }
  }

  const isOddCard = draw.card.id === newState.oddCardId;
  const isFinalReveal = isOddCard && newState.status === 'finished';
  const safeNames = [draw.drawerFinished ? drawer?.name : null, draw.targetFinished ? target?.name : null].filter(Boolean);

  const messages = [`${drawer?.name || '?'} pioche chez ${target?.name || '?'}${draw.paired ? ' — paire !' : ''}`];
  if (isOddCard) messages.push(isFinalReveal ? `${drawer?.name || '?'} est LE Pouilleux !` : 'Attention, LE Pouilleux !');
  safeNames.forEach((name) => messages.push(`${name} est à l'abri !`));

  const banner = container.querySelector('.turn-banner');
  if (banner) banner.textContent = messages[0];
  const status = container.querySelector('.pouilleux-3d-status');
  if (status && messages.length > 1) status.textContent = messages.slice(1).join(' · ');

  if (isFinalReveal) {
    vibrate([150, 80, 150, 80, 300]);
  } else if (isOddCard) {
    vibrate([80, 40, 80, 40, 150]);
  } else if (safeNames.length) {
    vibrate(200);
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 500 : isOddCard || safeNames.length ? 1900 : 1400;
  revealActiveUntil = performance.now() + duration;
  window.setTimeout(() => {
    if (newState.status === 'finished') {
      renderEndScreen(container, { room, player, onLeave });
    } else {
      renderTableNow3D(container, { room, player, state: newState, onLeave });
    }
    flushPendingRender();
  }, duration);
}

function renderTableNow2D(container, { room, player, state, onLeave }) {
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
  const revealHands = getRevealHands();
  const showFaces = isSafe && revealHands;

  const target = state.players.find((p) => p.id === targetId) || null;
  // Ordre du tour à partir de moi, cible exclue (déjà mise en avant dans sa
  // propre zone ci-dessous — voir .pouilleux-zone--target).
  const restOthers = orderedOpponents(state, player.id).filter((p) => p.id !== targetId);

  const targetPickable = isMyTurn && target && target.hand.length > 0;
  const targetHandHtml = !target
    ? ''
    : targetPickable
      ? Array.from({ length: target.hand.length })
          .map((_, i) => `<button type="button" class="card card--back target-card--pickable" data-pick-index="${i}"></button>`)
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

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
        ${threeDToggleHtml('pouilleux')}
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  // Nécessaire même si main.js masque déjà systématiquement les scènes 3D en
  // tout début de draw() : ce rendu peut aussi être atteint directement par
  // un clic sur la bascule 2D/3D (voir plus bas), sans repasser par draw().
  hideAllFans();

  wireThreeDToggle(container, 'pouilleux', () => renderTable(container, { room, player, state, onLeave }));

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    toggleRevealHands();
    renderTableNow2D(container, { room, player, state, onLeave });
  });
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    enableHandDrag(myHandEl, {
      onDrop: (cardId, index) => {
        moveCard('pouilleux', cardId, index);
        renderTableNow2D(container, { room, player, state, onLeave });
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

/**
 * Rendu 3D : pas de zones 2D à conserver (adversaires, mains séparées) — un
 * seul grand éventail ("stage") qui montre soit sa propre main face visible
 * (quand on est la cible du tour), soit celle du joueur ciblé dos visible
 * (quand on pioche, ou qu'on regarde quelqu'un d'autre piocher).
 */
function renderTableNow3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const targetId = computeTarget(state);
  const target = state.players.find((p) => p.id === targetId) || null;
  const targetIsMe = Boolean(target) && target.id === player.id;
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';
  const orderedHand = getOrderedHand('pouilleux', me.hand, sortedHand);

  const stagePickable = Boolean(isMyTurn && target && !targetIsMe && target.hand.length > 0);
  const pickableButtonsHtml = stagePickable
    ? Array.from({ length: target.hand.length })
        .map((_, i) => `<button type="button" class="card card--back target-card--pickable" data-pick-index="${i}"></button>`)
        .join('')
    : '';

  // Boutons invisibles pour le glisser-déposer de SA PROPRE main (voir plus
  // bas myHandKey/enableHandDrag) — seulement pertinent quand elle est
  // affichée face visible : soit dans "stage" (targetIsMe), soit dans "mine"
  // (iAmDrawing, calculé plus bas). `draggableButtonsHtml` est injecté dans
  // le conteneur du bon éventail au moment de construire le gabarit HTML.
  const draggableButtonsHtml = orderedHand
    .map((c) => `<button type="button" class="card mine-card--draggable" data-card-id="${c.id}"></button>`)
    .join('');

  const statusText = !target
    ? ''
    : targetIsMe
      ? `Ta main (${orderedHand.length})`
      : `${target.name}${connectionBadge(state, target.id)} · ${target.hand.length} carte${target.hand.length > 1 ? 's' : ''}`;

  // Second éventail sous celui du joueur ciblé (toujours "stage" ci-dessus) :
  // soit ma propre main (face visible) pendant que JE pioche chez quelqu'un
  // d'autre, soit — à 3 joueurs ou plus — la main cachée (dos) de celui qui
  // est EN TRAIN de piocher, quand je ne suis ni lui ni sa cible (pur
  // spectateur d'un tour entre deux autres joueurs). Dans les deux cas ce
  // rendu sert aussi d'état initial à renderDrawReveal3D, donc reste actif
  // pendant la révélation qui suit. Quand je suis moi-même la cible, ma main
  // occupe déjà le grand éventail "stage" ci-dessus, pas de second nécessaire.
  const drawer = state.players.find((p) => p.id === state.currentPlayerId) || null;
  const iAmDrawing = Boolean(isMyTurn && target && !targetIsMe);
  const spectatingOthers = Boolean(!isMyTurn && !targetIsMe && target && drawer);
  const showSecondFan = iAmDrawing || spectatingOthers;
  const secondFanLabel = iAmDrawing
    ? `Ta main (${orderedHand.length})`
    : spectatingOthers
      ? `${drawer.name}${connectionBadge(state, drawer.id)} · ${drawer.hand.length} carte${drawer.hand.length > 1 ? 's' : ''}`
      : '';

  // Clé de l'éventail qui montre ACTUELLEMENT ma propre main face visible
  // (jamais les deux à la fois) — sert à la fois à placer les boutons de
  // glisser-déposer ci-dessus dans le bon conteneur et à brancher
  // enableHandDrag plus bas. `null` quand ma main n'est affichée nulle part
  // ce rendu-ci (ex. pur spectateur d'un tour entre deux autres joueurs).
  const myHandKey = targetIsMe ? 'stage' : iAmDrawing ? 'mine' : null;

  container.innerHTML = `
    <div class="screen screen--table pouilleux-screen pouilleux-screen--3d">
      <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
        ${targetIsMe ? 'On pioche chez toi !' : isMyTurn ? `Touche une carte chez ${target?.name || ''}` : `Tour de ${currentPlayerName}`}
      </div>
      ${statusText ? `<p class="pouilleux-3d-status">${statusText}</p>` : ''}
      <div class="pouilleux-3d-stage ${showSecondFan ? 'pouilleux-3d-stage--compact' : ''}">${pickableButtonsHtml}${myHandKey === 'stage' ? draggableButtonsHtml : ''}</div>
      ${showSecondFan ? `<p class="pouilleux-3d-mine-label">${secondFanLabel}</p><div class="pouilleux-3d-mine-stage">${myHandKey === 'mine' ? draggableButtonsHtml : ''}</div>` : ''}

      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
      ${threeDToggleHtml('pouilleux')}
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  mountFan('stage');
  const stageEl = container.querySelector('.pouilleux-3d-stage');
  if (stageEl) positionFan('stage', stageEl.getBoundingClientRect());
  const stageCards = targetIsMe
    ? orderedHand.map((c) => ({ rank: c.rank, suit: c.suit }))
    : Array(target ? target.hand.length : 0).fill(null);
  updateFan('stage', stageCards, { pickable: stagePickable });
  showFan('stage');

  if (showSecondFan) {
    mountFan('mine');
    const mineEl = container.querySelector('.pouilleux-3d-mine-stage');
    if (mineEl) positionFan('mine', mineEl.getBoundingClientRect());
    const secondFanCards = iAmDrawing ? orderedHand.map((c) => ({ rank: c.rank, suit: c.suit })) : Array(drawer.hand.length).fill(null);
    updateFan('mine', secondFanCards);
    showFan('mine');
  } else {
    // Ce rendu peut être atteint sans repasser par hideAllThreeDScenes() (ex.
    // rendu final du setTimeout de révélation, voir renderDrawReveal3D) : un
    // "mine" resté affiché d'un tour précédent ne se cacherait pas tout seul
    // sinon (hideAllFans() cacherait aussi "stage", qu'on veut garder).
    hideFan('mine');
  }

  // Les boutons de clic invisibles doivent recouvrir les VRAIES positions des
  // cartes dessinées en 3D (éventail, pas un simple alignement) — sans ça ils
  // restent empilés dans le flux HTML normal du "stage", loin des cartes
  // visibles, et la pioche devient impossible à toucher.
  if (stagePickable) {
    const rects = getCardScreenRects('stage');
    container.querySelectorAll('.target-card--pickable').forEach((btn, i) => {
      const r = rects[i];
      if (!r) return;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });
  }

  // Glisser-déposer de sa propre main affichée en 3D (voir myHandKey) — même
  // superposition de boutons invisibles sur les cartes réellement dessinées
  // que ci-dessus pour la pioche, et même moveCard('pouilleux', ...) que le
  // glisser-déposer 2D (src/ui/dragReorder.js) : les deux vues partagent le
  // même ordre persisté (handOrder.js), rien de spécifique à la 3D côté tri.
  if (myHandKey) {
    const rects = getCardScreenRects(myHandKey);
    container.querySelectorAll('.mine-card--draggable').forEach((btn, i) => {
      const r = rects[i];
      if (!r) return;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });

    const handEl = container.querySelector(myHandKey === 'stage' ? '.pouilleux-3d-stage' : '.pouilleux-3d-mine-stage');
    if (handEl) {
      enableHandDrag(handEl, {
        // Le `transform` posé par enableHandDrag sur le bouton lui-même
        // (invisible, opacity:0) n'a aucun effet visible : la carte 3D
        // correspondante reçoit à la place un contour doré pendant la prise
        // en main (voir setCardHighlight, déjà utilisé pour la paire).
        onDragStart: (cardId) => {
          const idx = orderedHand.findIndex((c) => c.id === cardId);
          if (idx !== -1) setCardHighlight(myHandKey, idx, true);
        },
        onDragEnd: (cardId) => {
          const idx = orderedHand.findIndex((c) => c.id === cardId);
          if (idx !== -1) setCardHighlight(myHandKey, idx, false);
        },
        onDrop: (cardId, index) => {
          moveCard('pouilleux', cardId, index);
          renderTableNow3D(container, { room, player, state, onLeave });
        }
      });
    }
  }

  wireThreeDToggle(container, 'pouilleux', () => renderTable(container, { room, player, state, onLeave }));
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });

  if (stagePickable) {
    container.querySelectorAll('.target-card--pickable').forEach((btn) => {
      btn.addEventListener('click', async () => {
        vibrate(30);
        const cardIndex = Number(btn.dataset.pickIndex);
        container.querySelectorAll('.target-card--pickable').forEach((b) => (b.disabled = true));
        try {
          await drawForCurrentPlayer(room, player.id, cardIndex);
        } catch (err) {
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

  hideAllFans();

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
