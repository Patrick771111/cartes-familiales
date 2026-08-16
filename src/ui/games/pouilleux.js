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
  orderedOpponents
} from '../gameShared.js';

let lastRenderedState = null;

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  lastRenderedState = null;
  resetHandOrder('pouilleux');
}

export function renderTable(container, { room, player, state, onLeave }) {
  const previous = lastRenderedState;
  const isNewDraw = previous && state.lastDraw && (!previous.lastDraw || previous.lastDraw.id !== state.lastDraw.id);

  if (isNewDraw) {
    lastRenderedState = state;
    renderDrawReveal(container, { previousState: previous, newState: state, player, room, onLeave });
    return;
  }
  lastRenderedState = state;

  if (state.status === 'finished') {
    renderEndScreen(container, { room, player, onLeave });
    return;
  }
  renderTableNow(container, { room, player, state, onLeave });
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
          .map(
            (_, i) =>
              `<button type="button" class="card card--back target-card--pickable" data-pick-index="${i}"></button>`
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

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    toggleRevealHands();
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
