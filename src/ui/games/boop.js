import { placeBoopPiece, poolCounts, GRID_SIZE } from '../../game/boop.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
import {
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents,
  openLogModal,
  shareInviteLink
} from '../gameShared.js';
import {
  mountTable,
  positionTable,
  updateTable,
  showTable,
  hideTable,
  getCellRects,
  getBasketRects,
  orbitCameraByScreenDelta,
  zoomCameraByFactor,
  resetOrbit,
  setOverlaySync
} from '../../three/boopScene.js';

let selectedType = null;

export function resetSelection() {
  selectedType = null;
  hideTable();
  resetOrbit();
}

export function hide3D() {
  hideTable();
}

export function renderTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const winner = state.winnerId ? state.players.find((p) => p.id === state.winnerId) : null;
  const opponent = others[0];

  if (me) {
    const counts = poolCounts(me.pool);
    if (selectedType === 'kitten' && !counts.kitten) selectedType = null;
    if (selectedType === 'cat' && !counts.cat) selectedType = null;
    if (!selectedType) {
      if (counts.kitten) selectedType = 'kitten';
      else if (counts.cat) selectedType = 'cat';
    }
  }

  const canPlace = isMyTurn && !finished && selectedType;
  let banner = 'Partie terminée';
  if (!finished) {
    banner = isMyTurn
      ? selectedType === 'cat'
        ? 'Les chats courent : touche une case ou glisse depuis le panier'
        : 'Les chatons courent : touche une case ou glisse depuis le panier'
      : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
  }

  const cellButtons = Array.from(
    { length: GRID_SIZE },
    (_, i) =>
      `<button type="button" class="boop-3d-hit" data-index="${i}" ${
        canPlace && !state.board[i] ? 'data-dropzone="boop-cell"' : 'disabled'
      }></button>`
  ).join('');

  container.innerHTML = `
    <div class="screen screen--table boop-screen boop-screen--3d">
      ${winner ? `<p class="flip7-banner flip7-banner--winner">🐈 ${winner.name} gagne !</p>` : ''}
      <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${banner}</div>
      ${opponent ? `<p class="boop-3d-name" data-opp="1">${opponent.name}${opponent.isBot ? ' 🤖' : ''}</p>` : ''}
      <div class="boop-3d-table">
        ${cellButtons}
        <button type="button" class="boop-3d-hit" data-card-id="kitten" data-piece-type="kitten" data-seat="0" ${
          isMyTurn && !finished && poolCounts(me?.pool || []).kitten ? '' : 'disabled'
        }></button>
        <button type="button" class="boop-3d-hit" data-card-id="cat" data-piece-type="cat" data-seat="0" ${
          isMyTurn && !finished && poolCounts(me?.pool || []).cat ? '' : 'disabled'
        }></button>
        <p class="boop-3d-basket-label" data-basket="0-kitten"></p>
        <p class="boop-3d-basket-label" data-basket="0-cat"></p>
        <p class="boop-3d-basket-label" data-basket="1-kitten"></p>
        <p class="boop-3d-basket-label" data-basket="1-cat"></p>
      </div>
      ${finished ? endGameActionsHtml() : ''}
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter">📤</button>
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  const seats = [me, opponent].filter(Boolean);
  mountTable();
  updateTable({
    board: state.board,
    players: seats,
    lastMove: state.lastMove || null
  });
  showTable();

  const tableEl = container.querySelector('.boop-3d-table');
  const sync = () => {
    if (!tableEl) return;
    positionTable(tableEl.getBoundingClientRect());
    const cells = getCellRects();
    tableEl.querySelectorAll('[data-index]').forEach((btn) => {
      const r = cells[Number(btn.dataset.index)];
      if (!r) {
        btn.style.display = 'none';
        return;
      }
      btn.style.display = 'block';
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });
    getBasketRects().forEach((r) => {
      if (r.left == null) return;
      if (r.seat === 0) {
        const btn = tableEl.querySelector(`[data-seat="0"][data-piece-type="${r.type}"]`);
        if (btn) {
          btn.style.left = `${r.left}px`;
          btn.style.top = `${r.top}px`;
          btn.style.width = `${r.width}px`;
          btn.style.height = `${r.height}px`;
        }
      }
      const label = tableEl.querySelector(`[data-basket="${r.seat}-${r.type}"]`);
      if (!label) return;
      const pool = seats[r.seat]?.pool || [];
      const n = poolCounts(pool)[r.type] || 0;
      const word = r.type === 'cat' ? 'chat' : 'chaton';
      label.textContent = `${n} ${word}${n > 1 ? 's' : ''}`;
      label.style.left = `${r.left + r.width / 2}px`;
      label.style.top = `${r.top + r.height + 4}px`;
    });
  };
  sync();
  setOverlaySync(sync);
  if (tableEl) {
    wireBoopOrbit(tableEl, sync);
    new ResizeObserver(sync).observe(tableEl);
  }

  const placeAt = (index, type) => {
    const pieceType = type || selectedType;
    if (!pieceType) {
      alert('Choisis un chaton ou un chat dans un panier.');
      return;
    }
    placeBoopPiece(room, player.id, index, pieceType).catch((err) => alert(err.message || 'Coup impossible.'));
  };

  if (canPlace) {
    container.querySelectorAll('.boop-3d-table [data-index]').forEach((el) => {
      if (el.disabled) return;
      el.addEventListener('click', () => placeAt(Number(el.dataset.index)));
    });
  }
  container.querySelectorAll('.boop-3d-table [data-piece-type]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.disabled) return;
      selectedType = el.dataset.pieceType;
      renderTable(container, { room, player, state, onLeave });
    });
  });

  if (tableEl && isMyTurn && !finished) {
    enableDragToZone(tableEl, {
      dragEnabled: isCardDragEnabled(),
      onTap: (id) => {
        selectedType = id;
        renderTable(container, { room, player, state, onLeave });
      },
      onDrop: (id, zone) => {
        if (zone.dropzone !== 'boop-cell') return;
        placeAt(Number(zone.index), id);
      }
    });
  }

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
}

function wireBoopOrbit(tableEl, onOrbit) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = false;
  let pinching = false;
  let pinchDist = 0;
  const gap = (touches) =>
    touches.length < 2 ? 0 : Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  tableEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length < 2) return;
      pinching = true;
      dragging = false;
      pinchDist = gap(e.touches);
    },
    { passive: true, capture: true }
  );
  tableEl.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length < 2) return;
      e.preventDefault();
      const d = gap(e.touches);
      if (pinchDist > 8 && d > 8) {
        zoomCameraByFactor(d / pinchDist);
        onOrbit?.();
      }
      pinchDist = d;
    },
    { passive: false, capture: true }
  );
  tableEl.addEventListener(
    'touchend',
    (e) => {
      if (e.touches.length < 2) pinching = false;
    },
    true
  );
  tableEl.addEventListener(
    'pointerdown',
    (e) => {
      if (pinching || e.target.closest('.boop-3d-hit')) {
        dragging = false;
        return;
      }
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
    },
    true
  );
  tableEl.addEventListener(
    'pointermove',
    (e) => {
      if (pinching || !dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) moved = true;
      if (moved) {
        orbitCameraByScreenDelta(dx, dy);
        lastX = e.clientX;
        lastY = e.clientY;
        onOrbit?.();
      }
    },
    true
  );
  tableEl.addEventListener('pointerup', () => {
    dragging = false;
  }, true);
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
