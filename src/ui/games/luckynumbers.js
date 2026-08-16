import { ConflictError } from '../../game/engine.js';
import {
  drawLuckyNumbersFromStock,
  takeLuckyNumbersFromDiscard,
  placeLuckyNumbersDrawn,
  discardLuckyNumbersDrawn,
  validPlacements as luckyValidPlacements,
  DIAGONAL_INDEXES as LUCKY_DIAGONAL
} from '../../game/luckynumbers.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
import { endGameActionsHtml, wireAbandonButton, abandonButtonLabel, wireEndGameActions, orderedOpponents } from '../gameShared.js';

export function resetSelection() {}

export function renderTable(container, { room, player, state, onLeave }) {
  renderLuckyNumbersTable(container, { room, player, state, onLeave });
}

function luckyTileHtml(tile, { selected = false, placeable = false, compact = false } = {}) {
  if (!tile) {
    return `<div class="lucky-cell lucky-cell--empty ${placeable ? 'lucky-cell--placeable' : ''}"></div>`;
  }
  return `<div class="lucky-cell lucky-cell--tile ${compact ? 'lucky-cell--compact' : ''} ${selected ? 'lucky-cell--selected' : ''} ${placeable ? 'lucky-cell--placeable' : ''}">${tile.value}</div>`;
}

function luckyBoardHtml(board, { interactive = false, placeableIndexes = [], selectedIndex = null, diagonal = false } = {}) {
  const cells = board
    .map((tile, i) => {
      const isDiag = diagonal && LUCKY_DIAGONAL.includes(i);
      const placeable = placeableIndexes.includes(i);
      const selected = selectedIndex === i;
      const inner = luckyTileHtml(tile, { selected, placeable: interactive && placeable });
      const dropAttrs =
        interactive && placeable
          ? ` data-dropzone="lucky-cell" data-index="${i}"`
          : '';
      return `<button type="button" class="lucky-cell-btn ${isDiag ? 'lucky-cell-btn--diag' : ''} ${
        interactive && placeable ? 'lucky-cell-btn--placeable' : ''
      }" data-board-index="${i}"${dropAttrs} ${interactive && placeable ? '' : 'disabled'}>${inner}</button>`;
    })
    .join('');
  return `<div class="lucky-grid">${cells}</div>`;
}

function renderLuckyNumbersTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const hasDrawn = Boolean(state.drawnTile);
  const placeableIndexes =
    isMyTurn && hasDrawn ? luckyValidPlacements(me?.board || [], state.drawnTile.value) : [];
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const opponentsHtml = orderedOpponents(state, player.id)
    .map((p) => {
      const empty = p.board.filter((c) => !c).length;
      const isTurn = p.id === state.currentPlayerId;
      return `<div class="lucky-opponent ${isTurn ? 'lucky-opponent--turn' : ''}">
        <p class="lucky-opponent__name">${p.name}${p.isBot ? ' 🤖' : ''} <span class="lucky-opponent__empty">${empty} libre${empty > 1 ? 's' : ''}</span></p>
        ${luckyBoardHtml(p.board, { interactive: false, diagonal: true })}
      </div>`;
    })
    .join('');

  const discardHtml = state.discard.length
    ? state.discard
        .map(
          (t) =>
            `<button type="button" class="lucky-discard-tile" data-tile-id="${t.id}" data-card-id="${t.id}" ${
              isMyTurn && !hasDrawn ? '' : 'disabled'
            }>${t.value}</button>`
        )
        .join('')
    : '<span class="lucky-discard-empty">Aucune</span>';

  const winnerBanner =
    state.status === 'finished' && state.winnerIds?.length
      ? `<p class="flip7-banner flip7-banner--winner">🍀 ${state.winnerIds
          .map((id) => state.players.find((p) => p.id === id)?.name || '?')
          .join(', ')} gagne${state.winnerIds.length > 1 ? 'nt' : ''} !</p>`
      : '';

  const actionHint = !isMyTurn
    ? `Tour de ${currentName || '…'}`
    : hasDrawn
      ? placeableIndexes.length
        ? `Tuile ${state.drawnTile.value} — glisse ou touche une case, ou défausse-la.`
        : `Tuile ${state.drawnTile.value} — aucune case valide, défausse-la.`
      : state.discard.length
        ? 'Pioche, ou glisse un trèfle de la défausse vers une case.'
        : 'Pioche un trèfle caché.';

  const finished = state.status === 'finished';

  container.innerHTML = `
    <div class="screen screen--table lucky-screen">
      <div class="lucky-top">
        ${winnerBanner}
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${actionHint}</div>
        <div class="lucky-opponents">${opponentsHtml || '<p class="lucky-opponents__empty">—</p>'}</div>
      </div>

      <div class="lucky-bottom">
        <div class="lucky-draw-area">
          <button type="button" class="lucky-pile lucky-pile--stock" id="btn-lucky-draw" ${
            isMyTurn && !hasDrawn && state.stock.length > 0 ? '' : 'disabled'
          }>
            <div class="lucky-cell lucky-cell--back">🍀</div>
            <span class="lucky-pile__label">Pioche (${state.stock.length})</span>
          </button>
          ${
            isMyTurn && hasDrawn
              ? `<div class="lucky-pile lucky-pile--drawn" data-card-id="drawn" id="lucky-drawn-tile" title="Glisse vers une case ou la défausse">
                   <div class="lucky-cell lucky-cell--tile lucky-cell--drawn">${state.drawnTile.value}</div>
                   <span class="lucky-pile__label">Piochée</span>
                 </div>
                 <button type="button" class="btn btn--ghost btn--small" id="btn-lucky-discard-drawn" data-dropzone="lucky-discard-drawn">Défausser</button>`
              : ''
          }
          <div class="lucky-discard-row">
            <span class="lucky-discard-label">Défausse</span>
            <div class="lucky-discard-list">${discardHtml}</div>
          </div>
        </div>

        ${
          me
            ? `<div class="lucky-my-board">
                 <p class="lucky-my-board__label">Ton jardin · ${me.board.filter((c) => !c).length} case${
                   me.board.filter((c) => !c).length > 1 ? 's' : ''
                 } libre${me.board.filter((c) => !c).length > 1 ? 's' : ''}</p>
                 ${luckyBoardHtml(me.board, {
                   interactive: isMyTurn,
                   placeableIndexes: hasDrawn
                     ? placeableIndexes
                     : me.board.map((c, i) => (!c ? i : -1)).filter((i) => i >= 0),
                   diagonal: true
                 })}
               </div>`
            : ''
        }

        ${finished ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log
            .slice()
            .reverse()
            .map((l) => `<li>${l.message}</li>`)
            .join('')}</ul>
        </details>

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  const markPlaceableCells = (indexes) => {
    container.querySelectorAll('.lucky-my-board [data-board-index]').forEach((cellBtn) => {
      const idx = Number(cellBtn.dataset.boardIndex);
      const ok = indexes.includes(idx);
      cellBtn.disabled = !ok;
      cellBtn.classList.toggle('lucky-cell-btn--placeable', ok);
      cellBtn.querySelector('.lucky-cell')?.classList.toggle('lucky-cell--placeable', ok);
      if (ok) {
        cellBtn.dataset.dropzone = 'lucky-cell';
        cellBtn.dataset.index = String(idx);
      } else {
        delete cellBtn.dataset.dropzone;
        delete cellBtn.dataset.index;
      }
    });
  };

  container.querySelector('#btn-lucky-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawLuckyNumbersFromStock(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      if (!(err instanceof ConflictError)) alert(err.message || String(err));
    }
  });

  container.querySelector('#btn-lucky-discard-drawn')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await discardLuckyNumbersDrawn(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      if (!(err instanceof ConflictError)) alert(err.message || String(err));
    }
  });

  let pendingDiscardTileId = null;

  const selectDiscardTile = (tileId) => {
    if (!isMyTurn || hasDrawn) return;
    container.querySelectorAll('.lucky-discard-tile').forEach((b) => b.classList.remove('lucky-discard-tile--selected'));
    pendingDiscardTileId = tileId;
    container.querySelector(`.lucky-discard-tile[data-tile-id="${tileId}"]`)?.classList.add('lucky-discard-tile--selected');
    const tile = state.discard.find((t) => t.id === tileId);
    if (!tile || !me) return;
    markPlaceableCells(luckyValidPlacements(me.board, tile.value));
  };

  container.querySelectorAll('.lucky-discard-tile').forEach((btn) => {
    btn.addEventListener('click', () => selectDiscardTile(btn.dataset.tileId));
  });

  container.querySelectorAll('.lucky-my-board [data-board-index]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!isMyTurn) return;
      const index = Number(btn.dataset.boardIndex);
      try {
        if (hasDrawn) {
          await placeLuckyNumbersDrawn(room, player.id, index);
        } else if (pendingDiscardTileId) {
          await takeLuckyNumbersFromDiscard(room, player.id, pendingDiscardTileId, index);
          pendingDiscardTileId = null;
        }
      } catch (err) {
        if (!(err instanceof ConflictError)) alert(err.message || String(err));
      }
    });
  });

  // Glisser-déposer (tuile piochée → case / défausse ; tuile de défausse → case)
  if (isMyTurn && isCardDragEnabled()) {
    const dragRoot = container.querySelector('.lucky-bottom') || container;
    if (hasDrawn) {
      enableDragToZone(dragRoot, {
        dragEnabled: true,
        onTap: () => {},
        onDrop: async (id, zone) => {
          if (id !== 'drawn') return;
          try {
            if (zone?.dropzone === 'lucky-cell') {
              await placeLuckyNumbersDrawn(room, player.id, Number(zone.index));
            } else if (zone?.dropzone === 'lucky-discard-drawn') {
              await discardLuckyNumbersDrawn(room, player.id);
            }
          } catch (err) {
            if (!(err instanceof ConflictError)) alert(err.message || String(err));
          }
        }
      });
    } else {
      enableDragToZone(dragRoot, {
        dragEnabled: true,
        onTap: (id) => {
          // Tap court sur une tuile de défausse = sélection (comme le clic)
          if (state.discard.some((t) => t.id === id)) selectDiscardTile(id);
        },
        onDrop: async (id, zone) => {
          if (zone?.dropzone !== 'lucky-cell') return;
          const tile = state.discard.find((t) => t.id === id);
          if (!tile) return;
          const indexes = luckyValidPlacements(me.board, tile.value);
          const index = Number(zone.index);
          if (!indexes.includes(index)) {
            alert('Cette case n\'accepte pas cette tuile.');
            return;
          }
          try {
            await takeLuckyNumbersFromDiscard(room, player.id, id, index);
          } catch (err) {
            if (!(err instanceof ConflictError)) alert(err.message || String(err));
          }
        }
      });
      // Pour pouvoir déposer sans sélection préalable : toutes les cases vides
      // valides pour *une* des tuiles de défausse restent marquées dynamiquement
      // au drag — au départ on active les cases valides pour chaque tuile au drop check.
    }
  }
}
