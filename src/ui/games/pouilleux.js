import { cardFaceHtml, cardBackHtml } from '../cards.js';
import { drawForCurrentPlayer, formAdjacentPairs, discardAdjacentPairs, playerToDrawFrom as computeTarget } from '../../game/pouilleux.js';
import { replaceBotWithPlayer } from '../../game/engine.js';
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
  mountTable,
  positionTable,
  updateTable,
  showTable,
  hideTable,
  hideAllFans,
  flipCard,
  fadeOutCard,
  descendCard,
  alarmCard,
  getCardRects,
  getRowLabelAnchors,
  orbitCameraByScreenDelta,
  zoomCameraByFactor,
  resetOrbit
} from '../../three/pouilleuxScene.js';

// Durée du retournement 3D (voir flipCard) — nommée ici plutôt que de
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
  hideTable();
}

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  lastRenderedState = null;
  revealActiveUntil = 0;
  pendingRenderArgs = null;
  resetHandOrder('pouilleux');
  hideTable();
  resetOrbit();
}

async function tryDiscardAdjacentPairs(container, { room, player, state, onLeave, mode }) {
  const me = state.players.find((p) => p.id === player.id);
  if (!me) return;
  const ordered = getOrderedHand('pouilleux', me.hand, sortedHand);
  const { discarded } = discardAdjacentPairs(ordered);
  if (!discarded.length) {
    if (mode === '3d') renderTableNow3D(container, { room, player, state, onLeave });
    else renderTableNow2D(container, { room, player, state, onLeave });
    return;
  }
  if (mode === '3d') discarded.forEach((c) => fadeOutCard(c.id));
  try {
    await formAdjacentPairs(
      room,
      player.id,
      ordered.map((c) => c.id)
    );
  } catch (err) {
    if (mode === '3d') renderTableNow3D(container, { room, player, state, onLeave });
    else renderTableNow2D(container, { room, player, state, onLeave });
  }
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
 * Chorégraphie de fin de retournement : `receiverHandBefore` est la main
 * de celui qui reçoit la carte, AVANT le tirage. À 80 % de rotation :
 * paire → contour doré puis disparition des 2 cartes ; sinon la carte
 * descend vers la table (elle rejoint le chevalet du tireur au prochain rendu).
 */
function scheduleFlipConclusion(drawnCardId, draw, receiverHandBefore, { isOddCard = false } = {}) {
  const pairCard = draw.paired ? receiverHandBefore.find((c) => c.rank === draw.card.rank) : null;
  if (isOddCard) {
    window.setTimeout(() => alarmCard(drawnCardId, { duration: 1200 }), FLIP_DURATION);
    return;
  }
  window.setTimeout(() => {
    if (draw.paired && pairCard) {
      fadeOutCard(drawnCardId);
      fadeOutCard(pairCard.id);
    } else {
      descendCard(drawnCardId);
    }
  }, FLIP_DURATION * 0.8);
}

/**
 * Version 3D de la révélation d'un tirage : la carte piochée pivote dos →
 * face (voir flipCard) — rien à révéler si on est soi-même la cible (main
 * déjà face visible sur notre chevalet).
 */
function renderDrawReveal3D(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow3D(container, { room: { ...room, state: previousState }, player, state: previousState, onLeave });

  const draw = newState.lastDraw;
  const drawer = previousState.players.find((p) => p.id === draw.by);
  const target = previousState.players.find((p) => p.id === draw.from);
  const targetWasMe = draw.from === player.id;
  const isOddCard = draw.card.id === newState.oddCardId;
  const isFinalReveal = isOddCard && newState.status === 'finished';
  const oddMessage = isFinalReveal ? `${drawer?.name || '?'} est LE Pouilleux !` : 'Attention, LE Pouilleux !';

  if (!targetWasMe && target && draw.card?.id) {
    flipCard(draw.card.id, { rank: draw.card.rank, suit: draw.card.suit }, { duration: FLIP_DURATION });
    if (draw.by === player.id) {
      const me = previousState.players.find((p) => p.id === player.id);
      const myHandBefore = getOrderedHand('pouilleux', me.hand, sortedHand);
      scheduleFlipConclusion(draw.card.id, draw, myHandBefore, { isOddCard });
    } else if (drawer) {
      scheduleFlipConclusion(draw.card.id, draw, drawer.hand, { isOddCard });
    }
  } else if (isOddCard && draw.card?.id) {
    alarmCard(draw.card.id, { duration: 1200 });
  }

  const safeNames = [draw.drawerFinished ? drawer?.name : null, draw.targetFinished ? target?.name : null].filter(Boolean);

  const messages = [`${drawer?.name || '?'} pioche chez ${target?.name || '?'}${draw.paired ? ' — paire !' : ''}`];
  if (isOddCard) messages.push(oddMessage);
  safeNames.forEach((name) => messages.push(`${name} est à l'abri !`));

  const banner = container.querySelector('.turn-banner');
  if (banner) banner.textContent = messages.join(' · ');

  if (isOddCard) {
    const overlay = document.createElement('div');
    overlay.className = 'pouilleux-3d-danger';
    overlay.innerHTML = `<p class="pouilleux-3d-danger__msg">${oddMessage}</p>`;
    container.querySelector('.pouilleux-3d-table')?.appendChild(overlay);
  }

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
          <p class="my-hand__label">Ta main (${me.hand.length}) <small>— glisse deux cartes de même rang côte à côte (ou l'une sur l'autre) pour défausser</small></p>
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
        tryDiscardAdjacentPairs(container, { room, player, state, onLeave, mode: '2d' });
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

function handCards(hand, { faceUp = false, pickable = false } = {}) {
  return hand.map((c, i) => ({
    id: c.id,
    rank: c.rank,
    suit: c.suit,
    faceUp,
    pickable,
    pickIndex: i
  }));
}

function pouilleuxHudHtml(state, player) {
  return `
    <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
    <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
    <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
    ${threeDToggleHtml('pouilleux')}
    <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
  `;
}

/**
 * Rendu 3D : table ronde, un chevalet par joueur (voir pouilleuxScene.js).
 * La main cible s'ouvre et se rapproche quand on peut piocher.
 */
function renderTableNow3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const targetId = computeTarget(state);
  const target = state.players.find((p) => p.id === targetId) || null;
  const targetIsMe = Boolean(target) && target.id === player.id;
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';
  const orderedHand = me ? getOrderedHand('pouilleux', me.hand, sortedHand) : [];
  const canPick = Boolean(isMyTurn && target && !targetIsMe && target.hand.length > 0);
  const others = orderedOpponents(state, player.id);

  const myHand = handCards(orderedHand, { faceUp: true, pickable: false });
  const opponentViews = others.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isTurn: p.id === state.currentPlayerId,
    isTarget: p.id === targetId,
    hand: handCards(p.hand, { faceUp: false, pickable: canPick && p.id === targetId })
  }));

  const clickableButtons = [];
  if (canPick && target) {
    target.hand.forEach((c, i) => {
      clickableButtons.push(
        `<button type="button" class="pouilleux-3d-card target-card--pickable" data-card-id="${c.id}" data-pick-index="${i}"></button>`
      );
    });
  }
  orderedHand.forEach((c) => {
    clickableButtons.push(`<button type="button" class="pouilleux-3d-card mine-card--draggable" data-card-id="${c.id}"></button>`);
  });

  const opponentLabels = opponentViews
    .map(
      (opp, i) =>
        `<p class="pouilleux-3d-label ${opp.isTarget ? 'pouilleux-3d-label--turn' : ''}" data-opp-label="${i}">${opp.name}${connectionBadge(
          state,
          opp.id
        )}${opp.isBot ? ' 🤖' : ''}${opp.hand.length ? ` · ${opp.hand.length}` : ' — sorti·e'}</p>`
    )
    .join('');

  container.innerHTML = `
    <div class="screen screen--table pouilleux-screen pouilleux-screen--3d">
      <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
        ${targetIsMe ? 'On pioche chez toi !' : isMyTurn ? `Touche une carte chez ${target?.name || ''}` : `Tour de ${currentPlayerName}`}
      </div>

      <div class="pouilleux-3d-table">
        ${opponentLabels}
        ${clickableButtons.join('')}
      </div>

      ${pouilleuxHudHtml(state, player)}
    </div>
  `;

  mountTable();
  updateTable({
    myHand,
    opponents: opponentViews,
    myIsTarget: targetIsMe
  });
  showTable();

  const tableEl = container.querySelector('.pouilleux-3d-table');
  if (tableEl) {
    const repositionOverlays = () => {
      const rects = getCardRects();
      const byId = new Map();
      for (const r of rects.mine) byId.set(r.id, r);
      for (const group of rects.opponents) {
        for (const r of group) byId.set(r.id, r);
      }
      tableEl.querySelectorAll('.pouilleux-3d-card').forEach((btn) => {
        const r = byId.get(btn.dataset.cardId);
        if (!r) return;
        btn.style.left = `${r.left}px`;
        btn.style.top = `${r.top}px`;
        btn.style.width = `${r.width}px`;
        btn.style.height = `${r.height}px`;
      });
      const anchors = getRowLabelAnchors();
      anchors.opponents.forEach((anchor, i) => {
        if (!anchor) return;
        const el = tableEl.querySelector(`[data-opp-label="${i}"]`);
        if (!el) return;
        el.style.left = `${anchor.left}px`;
        el.style.top = `${anchor.top}px`;
      });
    };
    attachPouilleuxViewport(tableEl, repositionOverlays);

    enableHandDrag(tableEl, {
      selector: '.mine-card--draggable',
      onDrop: (cardId, index) => {
        moveCard('pouilleux', cardId, index);
        tryDiscardAdjacentPairs(container, { room, player, state, onLeave, mode: '3d' });
      }
    });
  }

  wireThreeDToggle(container, 'pouilleux', () => renderTable(container, { room, player, state, onLeave }));
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });

  if (canPick) {
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

function wirePouilleuxOrbit(tableEl, onOrbit) {
  let dragging = false;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragMoved = false;
  const DRAG_THRESHOLD = 10;
  let pinching = false;
  let pinchDist = 0;

  const touchGap = (touches) => {
    if (touches.length < 2) return 0;
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  };

  tableEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length < 2) return;
      pinching = true;
      dragging = false;
      dragMoved = true;
      pinchDist = touchGap(e.touches);
    },
    { passive: true, capture: true }
  );
  tableEl.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      pinching = true;
      dragging = false;
      dragMoved = true;
      const dist = touchGap(e.touches);
      if (pinchDist > 8 && dist > 8) {
        zoomCameraByFactor(dist / pinchDist);
        onOrbit?.();
      }
      pinchDist = dist;
    },
    { passive: false, capture: true }
  );
  const endPinch = (e) => {
    if (e.touches.length < 2) pinching = false;
  };
  tableEl.addEventListener('touchend', endPinch, true);
  tableEl.addEventListener('touchcancel', endPinch, true);
  tableEl.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  tableEl.addEventListener(
    'pointerdown',
    (e) => {
      if (pinching) return;
      if (e.target.closest('.pouilleux-3d-card')) {
        dragging = false;
        dragMoved = false;
        return;
      }
      dragging = true;
      dragMoved = false;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
    },
    true
  );
  tableEl.addEventListener(
    'pointermove',
    (e) => {
      if (pinching || !dragging) return;
      const dx = e.clientX - dragLastX;
      const dy = e.clientY - dragLastY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
      if (dragMoved) {
        orbitCameraByScreenDelta(dx, dy);
        dragLastX = e.clientX;
        dragLastY = e.clientY;
        onOrbit?.();
      }
    },
    true
  );
  const endDrag = () => {
    dragging = false;
  };
  tableEl.addEventListener('pointerup', endDrag, true);
  tableEl.addEventListener('pointercancel', endDrag, true);
  tableEl.addEventListener(
    'click',
    (e) => {
      if (!dragMoved) return;
      dragMoved = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );
  tableEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomCameraByFactor(Math.exp(-e.deltaY * 0.0015));
      onOrbit?.();
    },
    { passive: false }
  );
}

function attachPouilleuxViewport(tableEl, repositionOverlays) {
  const sync = () => {
    positionTable(tableEl.getBoundingClientRect());
    repositionOverlays?.();
  };
  sync();
  wirePouilleuxOrbit(tableEl, repositionOverlays);
  const ro = new ResizeObserver(sync);
  ro.observe(tableEl);
}

export function renderSpectator(container, args) {
  if (!is3DEnabled('pouilleux')) {
    hideTable();
    return false;
  }
  renderPouilleuxSpectator3D(container, args);
  return true;
}

function renderPouilleuxSpectator3D(container, { room, player, gameLabel, onBackToRooms, onRerender }) {
  const state = room.state;
  const finished = state.status === 'finished';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;
  const targetId = computeTarget(state);

  const seatViews = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isTurn: p.id === state.currentPlayerId,
    isTarget: p.id === targetId,
    hand: handCards(p.hand, { faceUp: finished, pickable: false })
  }));

  const labels = seatViews
    .map(
      (p, i) =>
        `<p class="pouilleux-3d-label ${p.isTarget ? 'pouilleux-3d-label--turn' : ''}" data-seat-label="${i}">${p.name}${connectionBadge(
          state,
          p.id
        )}${p.isBot ? ' 🤖' : ''}${p.hand.length ? ` · ${p.hand.length}` : ' — sorti·e'}</p>`
    )
    .join('');
  const replaceBots = seatViews
    .filter((p) => p.isBot)
    .map((p) => `<button type="button" class="btn btn--ghost btn--small" data-replace-bot-id="${p.id}">Prendre la place de ${p.name}</button>`)
    .join('');

  container.innerHTML = `
    <div class="screen screen--table pouilleux-screen pouilleux-screen--3d">
      <p class="eyebrow">Tu regardes — ${gameLabel || 'Pouilleux'} en cours</p>
      <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>
      <div class="turn-banner">${currentName ? `Tour de ${currentName}` : 'En attente…'}</div>
      <div class="pouilleux-3d-table">
        ${labels}
      </div>
      ${replaceBots ? `<div class="spectator-join">${replaceBots}</div>` : ''}
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
      ${threeDToggleHtml('pouilleux')}
    </div>
  `;

  mountTable();
  updateTable({ myHand: [], opponents: seatViews, spectator: true });
  showTable();

  const tableEl = container.querySelector('.pouilleux-3d-table');
  if (tableEl) {
    const repositionOverlays = () => {
      const anchors = getRowLabelAnchors();
      (anchors.seats || []).forEach((anchor, i) => {
        if (!anchor) return;
        const el = tableEl.querySelector(`[data-seat-label="${i}"]`);
        if (!el) return;
        el.style.left = `${anchor.left}px`;
        el.style.top = `${anchor.top}px`;
      });
    };
    attachPouilleuxViewport(tableEl, repositionOverlays);
  }

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => onBackToRooms?.());
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireThreeDToggle(container, 'pouilleux', () => onRerender?.());
  container.querySelectorAll('[data-replace-bot-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await replaceBotWithPlayer(room, btn.dataset.replaceBotId, player);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `Prendre la place de ce bot`;
        alert(err.message || 'Impossible de remplacer ce bot.');
      }
    });
  });
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
