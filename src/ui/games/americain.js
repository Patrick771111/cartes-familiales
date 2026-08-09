import { cardFaceHtml, cardBackHtml } from '../cards.js';
import { playAmericainCard, drawAmericainCard, isLegalCard, hasLegalMove } from '../../game/americain.js';
import { suitInfo } from '../../game/deck.js';
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
  orderedOpponents
} from '../gameShared.js';

// Carte "8" en attente du choix de couleur (clic sur l'icône couleur pour valider,
// ou en dehors pour annuler) — distincte de toute autre sélection, remise à zéro
// dès que ce n'est plus mon tour.
let pendingEightCardId = null;

const SUIT_ORDER = ['S', 'H', 'D', 'C'];

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  pendingEightCardId = null;
  resetHandOrder('americain');
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (state.status === 'finished') {
    renderAmericainEnd(container, { room, player, state, onLeave });
    return;
  }
  renderAmericainTable(container, { room, player, state, onLeave });
}

function renderAmericainTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
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
