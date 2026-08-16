import {
  drawCinqRoisFromStock,
  drawCinqRoisFromDiscard,
  discardCinqRois,
  canGoOut as cinqRoisCanGoOut,
  rankLabel as cinqRoisRankLabel
} from '../../game/cinqrois.js';
import { cardFaceHtml, cardBackHtml } from '../cards.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
import { connectionBadge, endGameActionsHtml, wireAbandonButton, abandonButtonLabel, wireEndGameActions, orderedOpponents } from '../gameShared.js';

// Id de la dernière pose de main affichée en overlay (voir bas de fichier) —
// évite de rejouer l'animation à chaque re-rendu tant que le coup n'a pas changé.
let cinqRoisShownLayId = null;

export function resetSelection() {
  cinqRoisShownLayId = null;
}

export function renderTable(container, { room, player, state, onLeave }) {
  renderCinqRoisTable(container, { room, player, state, onLeave });
}

/**
 * Rendu de carte partagé avec tous les autres jeux (pips, figures, dos, thèmes
 * illustrés — voir cards.js) : `cardFaceHtml` sait déjà gérer la 5ᵉ famille
 * (★, `resolveSuit`) et les jokers des Cinq Rois. Seuls l'atout et la
 * sélection sont propres à ce jeu, passés en modificateurs (3ᵉ argument).
 */
function cinqRoisCardHtml(card, trumpRank, selected = false) {
  const isTrump = !card.isJoker && card.rank === trumpRank;
  const extra = [isTrump ? 'card--trump' : '', selected ? 'card--selected' : ''].filter(Boolean).join(' ');
  return cardFaceHtml(card, undefined, extra);
}

function cinqRoisCardBackHtml() {
  return cardBackHtml();
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

  const othersHtml = orderedOpponents(state, player.id)
    .map((p) => {
      const isTurn = state.currentPlayerId === p.id;
      let status = p.laidDown ? 'Posé ✓' : isTurn ? 'À jouer…' : `${p.hand.length} cartes`;
      if (isFinished && state.roundScores) status = `+${state.roundScores[p.id] ?? 0} · total ${p.score}`;

      let cardsHtml;
      if (p.laidDown && p.laidCards?.length) {
        cardsHtml = p.laidCards.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('');
      } else if (isFinished && p.hand.length) {
        // Fin de manche : on révèle les mains non posées le temps de voir les scores.
        cardsHtml = p.hand.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('');
      } else {
        cardsHtml = Array(Math.min(p.hand.length, 13)).fill(cinqRoisCardBackHtml()).join('');
      }

      return `
        <div class="cinqrois-seat ${isTurn ? 'cinqrois-seat--turn' : ''} ${p.laidDown ? 'cinqrois-seat--laid' : ''}">
          <p class="cinqrois-seat__name">${p.name}${connectionBadge(state, p.id)} <span class="cinqrois-seat__score">(${p.score})</span></p>
          <p class="cinqrois-seat__status">${status}</p>
          <div class="cinqrois-seat__backs">${cardsHtml}</div>
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
            : `<p class="cinqrois-winner">Manche terminée — enchaîne ou retourne au salon.</p>`
        }
        ${endGameActionsHtml()}
      </div>`;
  } else if (isMyTurn && state.phase === 'draw') {
    actionsHtml = `<p class="cinqrois-hint">Touche ou glisse depuis la <strong>pioche</strong> ou la <strong>défausse</strong>.</p>`;
  } else if (isMyTurn && state.phase === 'discard') {
    actionsHtml = `<p class="cinqrois-hint">Choisis une carte, puis touche la défausse (ou glisse-la). À droite : défausser et poser si possible.</p>`;
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
        <div class="cinqrois-center__side" aria-hidden="true"></div>
        <div class="cinqrois-center__piles">
          <div class="cinqrois-pile ${isMyTurn && state.phase === 'draw' ? 'cinqrois-pile--active' : ''}"
               id="cinqrois-stock"
               data-dropzone="cinqrois-stock"
               data-card-id="stock"
               title="Pioche">
            ${cinqRoisCardBackHtml()}
            <span class="cinqrois-pile__label">Pioche ${state.stock.length}</span>
          </div>
          <div class="cinqrois-discard ${isMyTurn ? 'cinqrois-discard--active' : ''}"
               id="cinqrois-discard-pile"
               data-dropzone="cinqrois-discard"
               data-card-id="discard"
               title="Défausse">
            ${
              topDiscard
                ? cinqRoisCardHtml(topDiscard, state.trumpRank)
                : '<div class="card card--empty-slot">—</div>'
            }
            <span class="cinqrois-pile__label">Défausse</span>
          </div>
        </div>
        <div class="cinqrois-center__side cinqrois-center__side--action">
          ${
            isMyTurn && state.phase === 'discard'
              ? `<button type="button" id="btn-cinqrois-goout" class="btn btn--ghost btn--small cinqrois-goout" disabled title="Défausser la carte choisie et poser le reste de ta main">Défausser et poser</button>`
              : ''
          }
        </div>
      </div>
      <div class="cinqrois-me ${isMyTurn ? 'cinqrois-me--turn' : ''} ${me?.laidDown ? 'cinqrois-me--laid' : ''}">
        <p class="cinqrois-me__name">Toi${connectionBadge(state, me?.id)} (${me?.score ?? 0} pts)${me?.laidDown ? ' — posé ✓' : ''}${myStatus}</p>
        <div class="cinqrois-me__hand" id="cinqrois-hand">
          ${
            me?.laidDown && me.laidCards?.length
              ? me.laidCards.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('')
              : sortedHand.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('') || '<p class="cinqrois-empty">—</p>'
          }
        </div>
      </div>
      ${actionsHtml}

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>

      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
    </div>`;

  if (isFinished) wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal('cinqrois'));
  wireAbandonButton(container, { room, player, state, onLeave });

  let selectedCardId = null;
  const canGoOutWith = (cardId) => {
    if (!me || !cardId) return false;
    const remaining = me.hand.filter((c) => c.id !== cardId);
    return remaining.length >= 3 && cinqRoisCanGoOut(remaining, state.trumpRank);
  };
  const refreshSelection = () => {
    container.querySelectorAll('#cinqrois-hand .card').forEach((el) => {
      el.classList.toggle('card--selected', el.dataset.cardId === selectedCardId);
    });
    const goOutBtn = container.querySelector('#btn-cinqrois-goout');
    if (goOutBtn) goOutBtn.disabled = !canGoOutWith(selectedCardId);
  };

  let drawBusy = false;
  const doDrawStock = async () => {
    if (drawBusy) return;
    drawBusy = true;
    try {
      await drawCinqRoisFromStock(room, player.id);
    } catch (err) {
      drawBusy = false;
      alert(err.message || 'Impossible de piocher.');
    }
  };
  const doDrawDiscard = async () => {
    if (!topDiscard || drawBusy) return;
    drawBusy = true;
    try {
      await drawCinqRoisFromDiscard(room, player.id);
    } catch (err) {
      drawBusy = false;
      alert(err.message || 'Impossible de prendre la défausse.');
    }
  };
  const doDiscard = async (cardId, goOut) => {
    if (!cardId) return;
    try {
      await discardCinqRois(room, player.id, cardId, goOut);
    } catch (err) {
      alert(err.message || (goOut ? 'Impossible de poser.' : 'Impossible de défausser.'));
    }
  };

  if (isMyTurn && state.phase === 'draw') {
    // Un seul chemin d'entrée (pointerup) pour éviter le double déclenchement
    // clic + onTap qui faisait "Tu as déjà pioché".
    const stockEl = container.querySelector('#cinqrois-stock');
    const discardEl = container.querySelector('#cinqrois-discard-pile');
    // La carte visible de la défausse a son propre data-card-id (id réel) :
    // on le neutralise pour que le tap cible bien la pile "discard".
    discardEl?.querySelectorAll('[data-card-id]').forEach((el) => {
      if (el !== discardEl) el.removeAttribute('data-card-id');
    });
    const bindPileTap = (el, action) => {
      if (!el) return;
      el.style.cursor = 'pointer';
      let ptr = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        ptr = { x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointerup', (e) => {
        if (!ptr) return;
        const dx = Math.abs(e.clientX - ptr.x);
        const dy = Math.abs(e.clientY - ptr.y);
        ptr = null;
        if (dx > 12 || dy > 12) return;
        e.preventDefault();
        e.stopPropagation();
        action();
      });
    };
    bindPileTap(stockEl, doDrawStock);
    bindPileTap(discardEl, doDrawDiscard);
  }

  if (isMyTurn && state.phase === 'discard') {
    const handEl = container.querySelector('#cinqrois-hand');
    handEl?.querySelectorAll('.card[data-card-id]').forEach((el) => {
      el.style.cursor = isCardDragEnabled() ? 'grab' : 'pointer';
    });
    if (handEl) {
      enableDragToZone(handEl, {
        dragEnabled: isCardDragEnabled(),
        onTap: (id) => {
          selectedCardId = selectedCardId === id ? null : id;
          refreshSelection();
        },
        onDrop: (id, zone) => {
          if (zone?.dropzone === 'cinqrois-discard') doDiscard(id, false);
        }
      });
    }
    // Tap sur la défausse pour confirmer la carte sélectionnée (sans double handler)
    const discardEl = container.querySelector('#cinqrois-discard-pile');
    discardEl?.querySelectorAll('[data-card-id]').forEach((el) => {
      if (el !== discardEl) el.removeAttribute('data-card-id');
    });
    let ptr = null;
    discardEl?.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptr = { x: e.clientX, y: e.clientY };
    });
    discardEl?.addEventListener('pointerup', (e) => {
      if (!ptr) return;
      const dx = Math.abs(e.clientX - ptr.x);
      const dy = Math.abs(e.clientY - ptr.y);
      ptr = null;
      if (dx > 12 || dy > 12) return;
      if (selectedCardId) doDiscard(selectedCardId, false);
    });
  }

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

  // Aperçu 2 s de la main posée (tous les appareils) avant de continuer le tour.
  const layMove = state.lastMove;
  if (layMove?.goOut && layMove.id && layMove.id !== cinqRoisShownLayId) {
    const layer = state.players.find((p) => p.id === layMove.by);
    const cards = layer?.laidCards || [];
    if (cards.length) {
      cinqRoisShownLayId = layMove.id;
      const overlay = document.createElement('div');
      overlay.className = 'cinqrois-lay-overlay';
      overlay.innerHTML = `
        <div class="cinqrois-lay-overlay__panel">
          <p class="cinqrois-lay-overlay__title">${layer.name} pose sa main !</p>
          <div class="cinqrois-lay-overlay__cards">
            ${cards.map((c) => cinqRoisCardHtml(c, state.trumpRank)).join('')}
          </div>
        </div>`;
      container.appendChild(overlay);
      window.setTimeout(() => overlay.remove(), 2000);
    }
  }
}
