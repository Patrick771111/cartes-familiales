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
import { isCardDragEnabled, is3DEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
import {
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents,
  openLogModal,
  shareInviteLink,
  threeDToggleHtml,
  wireThreeDToggle
} from '../gameShared.js';
import {
  mountBoard,
  positionBoard,
  updateScene,
  showBoard,
  hideBoard,
  getMyBoardCellRects,
  getDiscardTileRects,
  getDrawPileRect,
  getBoardLabelRects,
  panCameraByScreenDelta,
  panCameraToMySeat,
  zoomCameraByFactor
} from '../../three/luckyNumbersScene.js';

// Centre la caméra sur MON siège seulement au tout premier rendu 3D de la
// partie — sinon chaque re-rendu (après un coup, y compris d'un bot) ferait
// sauter la caméra et annulerait le glisser manuel de l'utilisateur.
let hasAutoCenteredCamera = false;

export function resetSelection() {}

// Hook générique lu par src/ui/game.js (hideAllThreeDScenes) — c'est CE
// fichier qui "s'inscrit" à la 3D, les fichiers communs n'ont besoin de
// connaître aucun jeu en particulier pour savoir masquer sa scène au bon moment.
export function hide3D() {
  hideBoard();
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (is3DEnabled('luckynumbers')) renderLuckyNumbersTable3D(container, { room, player, state, onLeave });
  else renderLuckyNumbersTable(container, { room, player, state, onLeave });
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

  const finished = state.status === 'finished';

  container.innerHTML = `
    <div class="screen screen--table lucky-screen">
      <div class="lucky-top">
        ${winnerBanner}
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

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
        ${threeDToggleHtml('luckynumbers')}
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  // Nécessaire même si main.js masque déjà systématiquement les scènes 3D en
  // tout début de draw() : ce rendu peut aussi être atteint directement par
  // un clic sur la bascule 2D/3D, sans repasser par draw() (même piège que
  // Pouilleux/Uno) — sans ça, le canvas 3D reste affiché par-dessus le DOM 2D.
  hideBoard();

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'luckynumbers', () => renderTable(container, { room, player, state, onLeave }));

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

/**
 * Rendu 3D : mon plateau en bois avec vraies encoches en bas (grand),
 * plateaux adversaires plus petits/loin en haut, pioche + défausse au
 * milieu (voir src/three/luckyNumbersScene.js). Le sélecteur n'existe pas
 * ici (pas de Joker/couleur comme au Uno) ; le glisser-déposer n'est pas
 * repris pour cette première tranche (le clic couvre déjà tout le flux
 * existant — même simplification que la 1ère tranche du Uno).
 */
function renderLuckyNumbersTable3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const hasDrawn = Boolean(state.drawnTile);
  const others = orderedOpponents(state, player.id);
  const finished = state.status === 'finished';
  const placeableForDrawn = isMyTurn && hasDrawn ? luckyValidPlacements(me?.board || [], state.drawnTile.value) : [];

  const winnerBanner =
    finished && state.winnerIds?.length
      ? `<p class="flip7-banner flip7-banner--winner">🍀 ${state.winnerIds
          .map((id) => state.players.find((p) => p.id === id)?.name || '?')
          .join(', ')} gagne${state.winnerIds.length > 1 ? 'nt' : ''} !</p>`
      : '';
  const myEmpty = me ? me.board.filter((c) => !c).length : 0;
  const statusText = !me
    ? ''
    : isMyTurn
      ? hasDrawn
        ? `Trèfle piochée : ${state.drawnTile.value}`
        : `Ton jardin · ${myEmpty} case${myEmpty > 1 ? 's' : ''} libre${myEmpty > 1 ? 's' : ''}`
      : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;

  // Un plateau à l'écran = un joueur : boardGroups[0] = moi, boardGroups[1..]
  // = adversaires dans l'ordre des sièges déjà calculé (voir `others` /
  // orderedOpponents) — même ordre utilisé pour les bulles de nom que pour
  // le placement des plateaux dans updateScene, sinon un nom se retrouverait
  // sous le mauvais plateau.
  const boardPlayers = [me, ...others].filter(Boolean);
  const nameLabelsHtml = boardPlayers
    .map(
      (p, i) =>
        `<div class="lucky-3d-name ${p.id === state.currentPlayerId ? 'lucky-3d-name--turn' : ''}" data-board-index="${i}">${p.name}</div>`
    )
    .join('');

  container.innerHTML = `
    <div class="screen screen--table lucky-screen lucky-screen--3d">
      ${winnerBanner}
      <p class="lucky-3d-status">${statusText}</p>

      <div class="lucky-3d-table">${nameLabelsHtml}</div>

      ${isMyTurn && hasDrawn ? `<button type="button" class="btn btn--ghost btn--small" id="btn-lucky-discard-drawn">Défausser</button>` : ''}

      ${finished ? endGameActionsHtml() : ''}

      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
      ${threeDToggleHtml('luckynumbers')}
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  let pendingDiscardTileId = null;

  mountBoard();
  const tableEl = container.querySelector('.lucky-3d-table');
  if (tableEl) positionBoard(tableEl.getBoundingClientRect());
  updateScene({
    myBoardTiles: me?.board || [],
    placeableIndexes: placeableForDrawn,
    opponents: others.map((p) => ({ board: p.board })),
    discardTiles: state.discard,
    stockCount: state.stock.length,
    drawnTile: state.drawnTile || null
  });
  if (!hasAutoCenteredCamera) {
    panCameraToMySeat();
    hasAutoCenteredCamera = true;
  }
  showBoard();

  // Boutons invisibles superposés aux VRAIES positions des cases/jetons
  // dessinés en 3D — même technique que Pouilleux/Uno (voir getMyBoardCellRects).
  // Doivent être REPOSITIONNÉS pendant le glisser de caméra (voir plus bas),
  // pas seulement une fois au rendu initial — la caméra peut désormais bouger.
  const repositionOverlayButtons = () => {
    if (!tableEl) return;
    getMyBoardCellRects().forEach((r, i) => {
      const btn = tableEl.querySelectorAll('.lucky-3d-cell')[i];
      if (!btn || !r) return;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });
    getDiscardTileRects().forEach((r, i) => {
      const btn = tableEl.querySelectorAll('.lucky-3d-discard-tile')[i];
      if (!btn || !r) return;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });
    const drawBtn = tableEl.querySelector('#btn-lucky-draw');
    if (drawBtn) {
      const drawRect = getDrawPileRect();
      if (drawRect) {
        drawBtn.style.left = `${drawRect.left}px`;
        drawBtn.style.top = `${drawRect.top}px`;
        drawBtn.style.width = `${drawRect.width}px`;
        drawBtn.style.height = `${drawRect.height}px`;
      }
    }
    getBoardLabelRects().forEach((r, i) => {
      const label = tableEl.querySelector(`.lucky-3d-name[data-board-index="${i}"]`);
      if (!label || !r) return;
      label.style.left = `${r.left + r.width / 2}px`;
      label.style.top = `${r.top}px`;
    });
  };

  if (tableEl) {
    const cellButtonsHtml = Array.from({ length: me?.board.length || 16 }, (_, i) => `<button type="button" class="lucky-3d-cell" data-board-index="${i}"></button>`).join('');
    const discardButtonsHtml = state.discard.map((t) => `<button type="button" class="lucky-3d-discard-tile" data-tile-id="${t.id}"></button>`).join('');
    const canDraw = isMyTurn && !hasDrawn && state.stock.length > 0;
    const drawButtonHtml = canDraw ? `<button type="button" class="lucky-3d-draw" id="btn-lucky-draw"></button>` : '';
    tableEl.insertAdjacentHTML('beforeend', cellButtonsHtml + discardButtonsHtml + drawButtonHtml);
    repositionOverlayButtons();

    // Glisser pour faire défiler la caméra d'un plateau à l'autre, dans les
    // 2 axes (demande explicite : "que la caméra puisse bouger de haut en
    // bas et gauche droite pour voir tous les plateaux") : suit le pointeur
    // en continu, puis empêche le clic-fantôme qui suivrait sur le bouton
    // sous le doigt/curseur si un vrai glisser a eu lieu (sinon un simple
    // tap serait interprété comme un glisser raté).
    let dragging = false;
    let dragLastX = 0;
    let dragLastY = 0;
    let dragMoved = false;
    const DRAG_THRESHOLD = 6;

    // Pinch-to-zoom (demande explicite) : suit chaque pointeur actif par id
    // pour détecter 2 doigts simultanés. Pendant un pinch le glisser 1-doigt
    // est suspendu (sinon les deux gestes se marchent dessus et la caméra
    // saute) ; en relâchant un doigt sur 2, le glisser reprend en douceur
    // avec celui qui reste, sans saut de position.
    const activePointers = new Map(); // pointerId -> {x, y}
    let pinchStartDist = null;
    const pinchDistance = () => {
      const pts = [...activePointers.values()];
      return pts.length < 2 ? null : Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    tableEl.addEventListener(
      'pointerdown',
      (e) => {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size >= 2) {
          dragging = false;
          pinchStartDist = pinchDistance();
        } else {
          dragging = true;
          dragMoved = false;
          dragLastX = e.clientX;
          dragLastY = e.clientY;
        }
      },
      true
    );
    tableEl.addEventListener(
      'pointermove',
      (e) => {
        if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size >= 2) {
          const dist = pinchDistance();
          if (pinchStartDist && dist) {
            zoomCameraByFactor(dist / pinchStartDist);
            pinchStartDist = dist;
            dragMoved = true; // supprime aussi le clic-fantôme après un pinch
            repositionOverlayButtons();
          }
          return;
        }

        if (!dragging) return;
        const dx = e.clientX - dragLastX;
        const dy = e.clientY - dragLastY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) dragMoved = true;
        if (dragMoved) {
          panCameraByScreenDelta(dx, dy);
          dragLastX = e.clientX;
          dragLastY = e.clientY;
          repositionOverlayButtons();
        }
      },
      true
    );
    const endDrag = (e) => {
      activePointers.delete(e.pointerId);
      pinchStartDist = null;
      const remaining = [...activePointers.values()];
      if (remaining.length === 1) {
        dragging = true;
        dragMoved = false;
        dragLastX = remaining[0].x;
        dragLastY = remaining[0].y;
      } else {
        dragging = false;
      }
    };
    tableEl.addEventListener('pointerup', endDrag, true);
    tableEl.addEventListener('pointercancel', endDrag, true);
    tableEl.addEventListener(
      'click',
      (e) => {
        if (dragMoved) {
          e.stopPropagation();
          e.preventDefault();
          dragMoved = false;
        }
      },
      true
    );
  }

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'luckynumbers', () => renderTable(container, { room, player, state, onLeave }));

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

  if (isMyTurn && !hasDrawn && me) {
    container.querySelectorAll('.lucky-3d-discard-tile').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingDiscardTileId = btn.dataset.tileId;
        const tile = state.discard.find((t) => t.id === pendingDiscardTileId);
        if (!tile) return;
        updateScene({
          myBoardTiles: me.board,
          placeableIndexes: luckyValidPlacements(me.board, tile.value),
          opponents: others.map((p) => ({ board: p.board })),
          discardTiles: state.discard,
          stockCount: state.stock.length
        });
      });
    });
  }

  if (isMyTurn) {
    container.querySelectorAll('.lucky-3d-cell').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const index = Number(btn.dataset.boardIndex);
        try {
          if (hasDrawn) {
            if (!placeableForDrawn.includes(index)) return;
            await placeLuckyNumbersDrawn(room, player.id, index);
          } else if (pendingDiscardTileId) {
            const tile = state.discard.find((t) => t.id === pendingDiscardTileId);
            if (!tile || !luckyValidPlacements(me.board, tile.value).includes(index)) return;
            await takeLuckyNumbersFromDiscard(room, player.id, pendingDiscardTileId, index);
            pendingDiscardTileId = null;
          }
        } catch (err) {
          if (!(err instanceof ConflictError)) alert(err.message || String(err));
        }
      });
    });
  }
}
