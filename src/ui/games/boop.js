import { placeBoopPiece, poolCounts, GRID, GRID_SIZE } from '../../game/boop.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents,
  openLogModal,
  shareInviteLink
} from '../gameShared.js';

let selectedType = null;

export function resetSelection() {
  selectedType = null;
}

function pieceClass(piece) {
  return `boop-piece boop-piece--${piece.type} boop-piece--${piece.color}`;
}

function pieceHtml(piece) {
  const icon = piece.type === 'cat' ? '🐈' : '🐱';
  return `<span class="${pieceClass(piece)}" title="${piece.type === 'cat' ? 'Chat' : 'Chaton'}">${icon}</span>`;
}

function poolHtml(pool, { selectable = false, selected = null } = {}) {
  const counts = poolCounts(pool);
  const types = [
    { type: 'kitten', label: 'Chatons', icon: '🐱', n: counts.kitten },
    { type: 'cat', label: 'Chats', icon: '🐈', n: counts.cat }
  ];
  return `<div class="boop-pool">
    ${types
      .map((t) => {
        const canSelect = selectable && t.n > 0;
        const armed = selected === t.type;
        const cls = `boop-pool__item ${t.n ? '' : 'boop-pool__item--empty'} ${armed ? 'boop-pool__item--selected' : ''}`;
        const attrs = canSelect
          ? `type="button" data-card-id="${t.type}" data-piece-type="${t.type}"`
          : 'type="button" disabled';
        return `<button ${attrs} class="${cls}"><span class="boop-pool__icon">${t.icon}</span><span class="boop-pool__n">${t.n}</span><span class="boop-pool__label">${t.label}</span></button>`;
      })
      .join('')}
  </div>`;
}

function boardHtml(board, { clickable = false } = {}) {
  const cells = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const piece = board[i];
    const empty = !piece;
    const drop = clickable && empty ? 'data-dropzone="boop-cell"' : '';
    cells.push(
      `<button type="button" class="boop-cell ${empty ? 'boop-cell--empty' : ''}" data-index="${i}" ${drop} ${
        clickable && empty ? '' : 'disabled'
      }>${piece ? pieceHtml(piece) : ''}</button>`
    );
  }
  return `<div class="boop-grid" style="--boop-n:${GRID}">${cells.join('')}</div>`;
}

export function renderTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const winner = state.winnerId ? state.players.find((p) => p.id === state.winnerId) : null;

  if (me) {
    const counts = poolCounts(me.pool);
    if (selectedType === 'kitten' && !counts.kitten) selectedType = null;
    if (selectedType === 'cat' && !counts.cat) selectedType = null;
    if (!selectedType) {
      if (counts.kitten) selectedType = 'kitten';
      else if (counts.cat) selectedType = 'cat';
    }
  }

  const opponent = others[0];
  const canPlace = isMyTurn && !finished && selectedType;

  let banner = 'Partie terminée';
  if (!finished) {
    banner = isMyTurn
      ? selectedType === 'cat'
        ? 'Pose un chat sur une case vide'
        : 'Pose un chaton sur une case vide'
      : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
  }

  container.innerHTML = `
    <div class="screen screen--table boop-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${
          opponent
            ? `<div class="boop-seat ${opponent.id === state.currentPlayerId ? 'boop-seat--turn' : ''}">
                 <p class="boop-seat__name">${opponent.name}${opponent.isBot ? ' 🤖' : ''}${connectionBadge(state, opponent.id)}</p>
                 ${poolHtml(opponent.pool)}
               </div>`
            : '<p class="pouilleux-zone__empty">—</p>'
        }
      </div>

      <div class="table-felt boop-felt">
        ${winner ? `<p class="flip7-banner flip7-banner--winner">🐈 ${winner.name} gagne !</p>` : ''}
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${banner}</div>
        ${boardHtml(state.board, { clickable: Boolean(canPlace) })}
      </div>

      <div class="my-hand">
        ${finished ? endGameActionsHtml() : ''}
        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
        ${
          me
            ? `<div class="boop-my-pool">
                 <p class="my-hand__label">Ta réserve${connectionBadge(state, me.id)}</p>
                 ${poolHtml(me.pool, { selectable: isMyTurn && !finished, selected: selectedType })}
               </div>`
            : ''
        }
      </div>
    </div>
  `;

  const placeAt = (index, type) => {
    const pieceType = type || selectedType;
    if (!pieceType) {
      alert('Choisis un chaton ou un chat dans ta réserve.');
      return;
    }
    placeBoopPiece(room, player.id, index, pieceType).catch((err) => alert(err.message || 'Coup impossible.'));
  };

  if (canPlace) {
    container.querySelectorAll('.boop-cell--empty').forEach((el) => {
      el.addEventListener('click', () => placeAt(Number(el.dataset.index)));
    });
  }

  container.querySelectorAll('.boop-my-pool [data-piece-type]').forEach((el) => {
    el.addEventListener('click', () => {
      selectedType = el.dataset.pieceType;
      renderTable(container, { room, player, state, onLeave });
    });
  });

  const poolEl = container.querySelector('.boop-my-pool');
  if (poolEl && isMyTurn && !finished) {
    enableDragToZone(poolEl, {
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
