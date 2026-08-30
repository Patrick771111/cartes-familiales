import { replaceBotWithPlayer } from '../../game/engine.js';
import { revealTrioCenter, revealTrioRow, confirmTrioTurn } from '../../game/trio.js';
import { openRulesModal } from '../rules.js';
import { gameCardImage } from '../cardThemes.js';
import { is3DEnabled } from '../settings.js';
import {
  connectionBadge,
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
  mountTable,
  positionTable,
  updateTable,
  showTable,
  hideTable,
  flipCard,
  getCardRects,
  getRowLabelAnchors,
  orbitCameraByScreenDelta,
  zoomCameraByFactor,
  resetOrbit
} from '../../three/trioScene.js';

// Durée du retournement 3D (voir flipCard) — nommée ici plutôt que de
// compter sur sa valeur par défaut, pour caler dessus le gel des re-rendus
// (un coup de bot ~0.7-1.3s après, voir trio.bot.js, ne doit pas reconstruire
// la table en plein milieu du pincement).
const FLIP_DURATION = 820;

let lastRenderedState = null;
let revealActiveUntil = 0;
let pendingRenderArgs = null;

// Évite de programmer plusieurs fois le même auto-confirm (une par
// re-rendu) — même principe que la déduplication par signature des bots
// (voir trio.bot.js), mais ici côté joueur humain actif.
let scheduledConfirmSignature = null;

let flipTimer = null;

export function hide3D() {
  hideTable();
}

export function resetSelection() {
  scheduledConfirmSignature = null;
  lastRenderedState = null;
  revealActiveUntil = 0;
  pendingRenderArgs = null;
  if (flipTimer) {
    window.clearTimeout(flipTimer);
    flipTimer = null;
  }
  hideTable();
  resetOrbit();
}

function flushPendingRender() {
  revealActiveUntil = 0;
  flipTimer = null;
  if (!pendingRenderArgs) return;
  const { container, args } = pendingRenderArgs;
  pendingRenderArgs = null;
  renderTable(container, args);
}

export function renderTable(container, args) {
  if (performance.now() < revealActiveUntil) {
    pendingRenderArgs = { container, args };
    // hideAllThreeDScenes() vient de cacher le canvas : le garder visible
    // le temps du retournement, uniquement si on est encore en 3D Trio.
    if (is3DEnabled('trio')) showTable();
    return;
  }

  const { room, player, state, onLeave } = args;
  const use3D = is3DEnabled('trio');
  const previous = lastRenderedState;
  lastRenderedState = state;

  if (use3D && previous) {
    const prevIds = new Set((previous.pendingReveals || []).map((r) => r.source.cardId));
    const flipping = (state.pendingReveals || []).filter(
      (r) => !prevIds.has(r.source.cardId) && (r.source.type === 'center' || r.source.playerId !== player.id)
    );
    if (flipping.length) {
      renderTrioTable3D(container, { room, player, state, onLeave, flipping });
      revealActiveUntil = performance.now() + FLIP_DURATION;
      if (flipTimer) window.clearTimeout(flipTimer);
      flipTimer = window.setTimeout(flushPendingRender, FLIP_DURATION);
      return;
    }
  }

  if (use3D) renderTrioTable3D(container, { room, player, state, onLeave, flipping: [] });
  else {
    hideTable();
    renderTrioTable2D(container, { room, player, state, onLeave });
  }
}

/**
 * Rotation + décalage vertical stables par id de carte (jamais Math.random,
 * qui ferait "sauter" le vrac à chaque re-rendu) — voir centerHtml : le
 * centre est piochable n'importe où (contrairement aux mains, triées, où
 * seules les deux extrémités comptent), le désordre visuel le signale.
 */
export function trioJitter(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return { angle: (Math.abs(h) % 17) - 8, offsetY: (Math.abs(h >> 4) % 7) - 3 };
}

export function trioCardHtml(value, { faceUp = false, lifted = false, jitter = null } = {}) {
  const theme = document.documentElement.dataset.cardTheme;
  // Illustrations 1-12 mutualisées (voir classique/games/numbers/) — Flip 7
  // et La Suite Infernale réutilisent exactement les mêmes fichiers.
  const illustration = faceUp ? gameCardImage(theme, 'numbers', String(value), value) : null;
  const bg = illustration ? `background-image:url('${illustration}');` : '';
  // `lifted` (transform CSS via classe) et `jitter` (transform inline) ne se
  // combinent jamais en pratique : lifted ne s'utilise que sur sa propre
  // main (toujours triée, jamais en vrac), jitter que sur le centre.
  const rotate = jitter ? `transform: rotate(${jitter.angle}deg) translateY(${jitter.offsetY}px);` : '';
  const style = bg || rotate ? ` style="${bg}${rotate}"` : '';
  return `<div class="trio-cell ${faceUp ? 'trio-cell--faceup' : 'trio-cell--facedown'} ${illustration ? 'trio-cell--illustrated' : ''} ${lifted ? 'trio-cell--lifted' : ''}"${style}>${faceUp && !illustration ? value : ''}</div>`;
}

/** 3 trophées à côté du nom d'un joueur, allumés selon son nombre de trios trouvés (objectif : 3 pour gagner, ou 1 seul si c'est le trio de 7). */
export function trioTrophiesHtml(count) {
  return `<span class="trio-trophies">${Array.from({ length: 3 }, (_, i) => `<span class="trio-trophy ${i < count ? 'trio-trophy--lit' : ''}">🏆</span>`).join('')}</span>`;
}

/**
 * Rangée triée d'un joueur. `revealedIds` : cartes de la tentative en cours
 * à afficher face visible *à leur emplacement d'origine* (pas dans une zone
 * séparée — on voit ainsi directement de qui/d'où vient chaque carte
 * révélée). Les extrémités cliquables (`low`/`high`) sont recalculées en
 * ignorant les cartes déjà révélées dans cette tentative : après avoir
 * révélé le plus petit numéro d'une main, le plus petit numéro *restant*
 * devient à son tour la cible "low" — on peut ainsi enchaîner plusieurs
 * cartes du même bout d'une main tant qu'elles correspondent.
 * `alwaysFaceUp` : dans le jeu physique, chacun trie sa propre main
 * lui-même (à la vue de ses propres cartes) — seules les mains des AUTRES
 * et le centre sont réellement cachées ; passer `true` uniquement pour sa
 * propre rangée (`me.row`). Dans ce cas, une carte choisie ce tour-ci ne se
 * retourne pas (elle était déjà face visible pour son propriétaire) : elle
 * se soulève légèrement à la place, pour matérialiser la sélection — ce
 * soulèvement est vu par tout le monde exactement comme `revealedIds` (état
 * partagé), les autres joueurs voyant en plus la carte se retourner de leur
 * côté puisqu'elle leur était, elle, réellement cachée.
 */
export function trioRowHtml(row, { targetPlayerId, clickableEnds = false, revealedIds = new Set(), alwaysFaceUp = false } = {}) {
  if (!row.length) return `<div class="trio-row trio-row--empty">Main vide</div>`;
  const availableIndexes = row.map((_, i) => i).filter((i) => !revealedIds.has(row[i].id));
  const lowIndex = availableIndexes[0];
  const highIndex = availableIndexes[availableIndexes.length - 1];
  const cells = row
    .map((card, i) => {
      const revealed = revealedIds.has(card.id);
      const inner = trioCardHtml(card.value, { faceUp: revealed || alwaysFaceUp, lifted: alwaysFaceUp && revealed });
      if (revealed) return inner; // déjà révélée pour cette tentative : jamais re-cliquable
      const end = i === lowIndex ? 'low' : i === highIndex ? 'high' : null;
      const clickable = clickableEnds && end && !(highIndex === lowIndex && end === 'high'); // évite un doublon low+high sur la dernière carte restante
      if (clickable) {
        return `<button type="button" class="trio-cell-btn" data-row-target="${targetPlayerId}" data-row-end="${end}">${inner}</button>`;
      }
      return inner;
    })
    .join('');
  return `<div class="trio-row">${cells}</div>`;
}

function actionHintFor(state, player) {
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const awaitingConfirm = Boolean(state.turnOutcome);
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;
  let actionHint;
  let actionHintDetail = '';
  if (!isMyTurn) {
    actionHint = awaitingConfirm ? `${currentName || '…'} regarde…` : `Tour de ${currentName || '…'}`;
  } else if (awaitingConfirm) {
    if (state.turnOutcome.type === 'success') {
      actionHint = `Trio de ${state.turnOutcome.trioValue} !`;
    } else {
      actionHint = 'Pas de trio';
      actionHintDetail = 'Pas de correspondance — les cartes retournent se cacher.';
    }
  } else if (state.pendingReveals.length === 0) {
    actionHint = 'Ton tour';
    actionHintDetail = "Révèle une carte : le centre, ou une extrémité (main d'un adversaire ou la tienne).";
  } else {
    actionHint = 'Encore une !';
    actionHintDetail = 'Encore une carte identique à trouver pour valider le trio.';
  }
  return { actionHint, actionHintDetail, isMyTurn, awaitingConfirm };
}

function rowView(row, { alwaysFaceUp = false, canClick = false, revealedIds, finished = false } = {}) {
  const availableIndexes = row.map((_, i) => i).filter((i) => !revealedIds.has(row[i].id));
  const lowIndex = availableIndexes[0];
  const highIndex = availableIndexes[availableIndexes.length - 1];
  return row.map((card, i) => {
    const revealed = revealedIds.has(card.id);
    const pickableEnd =
      canClick && !revealed && i === lowIndex
        ? 'low'
        : canClick && !revealed && i === highIndex && highIndex !== lowIndex
          ? 'high'
          : null;
    return {
      id: card.id,
      value: card.value,
      faceUp: revealed || alwaysFaceUp || finished,
      lifted: alwaysFaceUp && revealed,
      pickableEnd
    };
  });
}

function winnerBannerHtml(state) {
  if (state.status !== 'finished') return '';
  return `<p class="flip7-banner flip7-banner--winner">🃏 ${
    state.winnerId ? `${state.players.find((p) => p.id === state.winnerId)?.name || '?'} gagne la partie !` : 'Égalité — plus aucune carte disponible.'
  }</p>`;
}

function wireCommonHud(container, { room, player, state, onLeave }) {
  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'trio', () => renderTable(container, { room, player, state, onLeave }));
}

function scheduleAutoConfirm(room, player, state, { delay = 1000 } = {}) {
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  if (!isMyTurn || !state.turnOutcome) return;
  const signature = `${room.id}:${room.version}`;
  if (scheduledConfirmSignature === signature) return;
  scheduledConfirmSignature = signature;
  window.setTimeout(async () => {
    try {
      await confirmTrioTurn(room, player.id);
    } catch (err) {
      // Conflit optimiste attendu si un autre appareil a déjà confirmé — la resynchro realtime prend le relais.
    }
  }, delay);
}

function wireRevealClicks(container, { room, player, canReveal }) {
  if (!canReveal) return;
  container.querySelectorAll('[data-center-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await revealTrioCenter(room, player.id, btn.dataset.centerId);
      } catch (err) {
        btn.disabled = false;
        alert(err.message || String(err));
      }
    });
  });
  container.querySelectorAll('[data-row-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await revealTrioRow(room, player.id, btn.dataset.rowTarget, btn.dataset.rowEnd);
      } catch (err) {
        btn.disabled = false;
        alert(err.message || String(err));
      }
    });
  });
}

function hudHtml(state, player) {
  return `
    <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
    <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
    <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
    ${threeDToggleHtml('trio')}
    <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
  `;
}

function renderTrioTable2D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const { actionHint, actionHintDetail, isMyTurn, awaitingConfirm } = actionHintFor(state, player);
  const canReveal = isMyTurn && !awaitingConfirm && state.pendingReveals.length < 3;
  const finished = state.status === 'finished';
  const revealedIds = new Set(state.pendingReveals.map((r) => r.source.cardId));

  const centerHtml = state.center
    .map((c) => {
      const jitter = trioJitter(c.id);
      if (c.taken) return `<div class="trio-cell trio-cell--gone" style="transform: rotate(${jitter.angle}deg) translateY(${jitter.offsetY}px);"></div>`;
      if (revealedIds.has(c.id) || finished) return trioCardHtml(c.value, { faceUp: true, jitter });
      if (canReveal) {
        return `<button type="button" class="trio-cell-btn" data-center-id="${c.id}">${trioCardHtml(0, { faceUp: false, jitter })}</button>`;
      }
      return trioCardHtml(0, { faceUp: false, jitter });
    })
    .join('');

  const opponentsHtml = orderedOpponents(state, player.id)
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `<div class="trio-player ${isTurn ? 'trio-player--turn' : ''}">
        <p class="trio-player__name">${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''} ${trioTrophiesHtml(p.trios.length)}</p>
        ${trioRowHtml(p.row, { targetPlayerId: p.id, clickableEnds: canReveal, revealedIds, alwaysFaceUp: finished })}
      </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table trio-screen">
      <div class="pouilleux-zone pouilleux-zone--others trio-opponents">
        ${opponentsHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt trio-felt">
        ${winnerBannerHtml(state)}
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}"${actionHintDetail ? ` title="${actionHintDetail}"` : ''}>${actionHint}</div>

        <div class="trio-center">
          <p class="trio-center__label">Centre</p>
          <div class="trio-row">${centerHtml}</div>
        </div>

      </div>

      <div class="my-hand">
        ${
          me
            ? `<p class="my-hand__label">Ta main${connectionBadge(state, me.id)} ${trioTrophiesHtml(me.trios.length)}</p>
               ${trioRowHtml(me.row, { targetPlayerId: me.id, clickableEnds: canReveal, revealedIds, alwaysFaceUp: true })}`
            : ''
        }

        ${state.status === 'finished' ? endGameActionsHtml() : ''}

        ${hudHtml(state, player)}
      </div>
    </div>
  `;

  wireCommonHud(container, { room, player, state, onLeave });
  scheduleAutoConfirm(room, player, state);
  wireRevealClicks(container, { room, player, canReveal });
}

/**
 * Rendu 3D : table ronde vue en légère plongée (voir src/three/trioScene.js)
 * — un chevalet par joueur en cercle, cartes communes à plat au centre.
 * Une carte révélée (centre ou main d'un autre) pivote dos → face ; une
 * carte de SA propre main se soulève, comme en 2D (déjà face visible).
 */
function renderTrioTable3D(container, { room, player, state, onLeave, flipping = [] }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const { actionHint, actionHintDetail, isMyTurn, awaitingConfirm } = actionHintFor(state, player);
  const canReveal = isMyTurn && !awaitingConfirm && state.pendingReveals.length < 3;
  const finished = state.status === 'finished';
  const revealedIds = new Set(state.pendingReveals.map((r) => r.source.cardId));
  const flippingIds = new Set(flipping.map((r) => r.source.cardId));

  const myRow = me ? rowView(me.row, { alwaysFaceUp: true, canClick: canReveal, revealedIds, finished }) : [];
  const opponentViews = others.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isTurn: p.id === state.currentPlayerId,
    trios: p.trios.slice(),
    row: rowView(p.row, { alwaysFaceUp: finished, canClick: canReveal, revealedIds, finished })
  }));
  const centerView = state.center.map((c) => ({
    id: c.id,
    value: c.value,
    taken: c.taken,
    faceUp: revealedIds.has(c.id) || finished,
    pickable: canReveal && !c.taken && !revealedIds.has(c.id)
  }));

  const clickableButtons = [];
  for (const card of centerView) {
    if (!card.pickable) continue;
    clickableButtons.push(`<button type="button" class="trio-3d-card" data-card-id="${card.id}" data-center-id="${card.id}"></button>`);
  }
  if (me) {
    for (const card of myRow) {
      if (!card.pickableEnd) continue;
      clickableButtons.push(
        `<button type="button" class="trio-3d-card" data-card-id="${card.id}" data-row-target="${me.id}" data-row-end="${card.pickableEnd}"></button>`
      );
    }
  }
  opponentViews.forEach((opp) => {
    opp.row.forEach((card) => {
      if (!card.pickableEnd) return;
      clickableButtons.push(
        `<button type="button" class="trio-3d-card" data-card-id="${card.id}" data-row-target="${opp.id}" data-row-end="${card.pickableEnd}"></button>`
      );
    });
  });

  const opponentLabels = opponentViews
    .map(
      (opp, i) =>
        `<p class="trio-3d-label ${opp.isTurn ? 'trio-3d-label--turn' : ''}" data-opp-label="${i}">${opp.name}${connectionBadge(state, opp.id)}${
          opp.isBot ? ' 🤖' : ''
        }</p>`
    )
    .join('');

  container.innerHTML = `
    <div class="screen screen--table trio-screen trio-screen--3d">
      ${winnerBannerHtml(state)}
      <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}"${actionHintDetail ? ` title="${actionHintDetail}"` : ''}>${actionHint}</div>

      <div class="trio-3d-table">
        ${opponentLabels}
        ${clickableButtons.join('')}
      </div>

      ${finished ? endGameActionsHtml() : ''}

      ${hudHtml(state, player)}
    </div>
  `;

  mountTable();
  const tableEl = container.querySelector('.trio-3d-table');
  if (tableEl) positionTable(tableEl.getBoundingClientRect());
  updateTable({
    myRow,
    myTrios: me?.trios || [],
    opponents: opponentViews,
    center: centerView,
    flippingIds,
    myIsTurn: isMyTurn && !finished
  });
  showTable();

  for (const reveal of flipping) {
    flipCard(reveal.source.cardId, reveal.value, { duration: FLIP_DURATION });
  }

  if (tableEl) {
    const repositionOverlays = () => {
      const rects = getCardRects();
      const byId = new Map();
      for (const r of rects.mine) byId.set(r.id, r);
      for (const r of rects.center) byId.set(r.id, r);
      for (const group of rects.opponents) {
        for (const r of group) byId.set(r.id, r);
      }
      tableEl.querySelectorAll('.trio-3d-card').forEach((btn) => {
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
    repositionOverlays();
    wireTrioOrbit(tableEl, repositionOverlays);
  }

  wireCommonHud(container, { room, player, state, onLeave });
  scheduleAutoConfirm(room, player, state, { delay: flipping.length ? 1400 : 1000 });
  wireRevealClicks(container, { room, player, canReveal });
}

function wireTrioOrbit(tableEl, onOrbit) {
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

  // Pinch via TouchEvent : sur iOS le 2ᵉ doigt annule souvent le 1er PointerEvent.
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
      // Un clic sur une carte doit aller au bouton, pas à l'orbite —
      // `setPointerCapture` sur la table volait le click souris (Lucky
      // Numbers n'en a pas, et les clics y marchent).
      if (e.target.closest('.trio-3d-card')) {
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

/**
 * Vue spectateur 3D : orbite libre autour de la table. Renvoie `false` si
 * le mode 2D est actif, pour que game.js garde son rendu générique.
 */
export function renderSpectator(container, args) {
  if (!is3DEnabled('trio')) {
    hideTable();
    return false;
  }
  renderTrioSpectator3D(container, args);
  return true;
}

function renderTrioSpectator3D(container, { room, player, gameLabel, onBackToRooms, onRerender }) {
  const state = room.state;
  const finished = state.status === 'finished';
  const revealedIds = new Set((state.pendingReveals || []).map((r) => r.source.cardId));
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const seatViews = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    isTurn: p.id === state.currentPlayerId,
    trios: p.trios.slice(),
    row: rowView(p.row, { alwaysFaceUp: finished, canClick: false, revealedIds, finished })
  }));
  const centerView = (state.center || []).map((c) => ({
    id: c.id,
    value: c.value,
    taken: c.taken,
    faceUp: revealedIds.has(c.id) || finished,
    pickable: false
  }));

  const labels = seatViews
    .map(
      (p, i) =>
        `<p class="trio-3d-label ${p.isTurn ? 'trio-3d-label--turn' : ''}" data-seat-label="${i}">${p.name}${connectionBadge(state, p.id)}${
          p.isBot ? ' 🤖' : ''
        }</p>`
    )
    .join('');
  const replaceBots = seatViews
    .filter((p) => p.isBot)
    .map((p) => `<button type="button" class="btn btn--ghost btn--small" data-replace-bot-id="${p.id}">Prendre la place de ${p.name}</button>`)
    .join('');

  container.innerHTML = `
    <div class="screen screen--table trio-screen trio-screen--3d">
      ${winnerBannerHtml(state)}
      <p class="eyebrow">Tu regardes — ${gameLabel || 'Trio'} en cours</p>
      <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>
      <div class="turn-banner">${currentName ? `Tour de ${currentName}` : 'En attente…'}</div>

      <div class="trio-3d-table">
        ${labels}
      </div>

      ${replaceBots ? `<div class="spectator-join">${replaceBots}</div>` : ''}

      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
      ${threeDToggleHtml('trio')}
    </div>
  `;

  mountTable();
  const tableEl = container.querySelector('.trio-3d-table');
  if (tableEl) positionTable(tableEl.getBoundingClientRect());
  updateTable({
    myRow: [],
    myTrios: [],
    opponents: seatViews,
    center: centerView,
    flippingIds: new Set(),
    spectator: true
  });
  showTable();

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
    repositionOverlays();
    wireTrioOrbit(tableEl, repositionOverlays);
  }

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => onBackToRooms?.());
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireThreeDToggle(container, 'trio', () => onRerender?.());
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
