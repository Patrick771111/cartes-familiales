import { cardFaceHtml, cardBackHtml } from '../cards.js';
import table2dUrl from '../../assets/games/blackjack/table-2d.jpg';
import {
  hitBlackjack,
  standBlackjack,
  doubleBlackjack,
  splitBlackjack,
  takeInsurance,
  addChip,
  clearBet,
  confirmBet,
  handTotal,
  playerHands,
  activeHand,
  canDouble,
  canSplit,
  canTakeInsurance,
  isBlackjack,
  chipsForAmount,
  CHIP_VALUES,
  DEFAULT_BET,
  MIN_BET
} from '../../game/blackjack.js';
import { openRulesModal } from '../rules.js';
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
  getChipRects,
  getRowLabelAnchors,
  orbitCameraByScreenDelta,
  zoomCameraByFactor,
  resetOrbit
} from '../../three/blackjackScene.js';

const STATUS_LABEL = {
  playing: 'En jeu',
  stood: 'Reste',
  bust: 'Sauté',
  blackjack: 'Blackjack !',
  doubled: 'Double'
};
const RESULT_LABEL = { win: 'Gagné 🎉', lose: 'Perdu', push: 'Égalité', mixed: 'Mitigé' };

export function hide3D() {
  hideTable();
}

export function resetSelection() {
  hideTable();
  resetOrbit();
}

export function renderTable(container, args) {
  if (is3DEnabled('blackjack')) renderBlackjack3D(container, args);
  else {
    hideTable();
    renderBlackjack2D(container, args);
  }
}

function moneyLabel(p, finished, results) {
  const r = results?.[p.id];
  if (!finished || !r) return `${p.money} 💰`;
  return `${p.money} 💰 · ${RESULT_LABEL[r] || r}`;
}

function handBlock(h, { active = false, hide = false } = {}) {
  const total = hide ? '' : ` (${handTotal(h.cards)})`;
  const cards = hide
    ? cardFaceHtml(h.cards[0]) + (h.cards[1] ? cardBackHtml() : '')
    : h.cards.map(cardFaceHtml).join('');
  return `<div class="blackjack-spot ${active ? 'blackjack-spot--active' : ''}">
    <div class="blackjack-hand">${cards}</div>
    <p class="blackjack-spot__meta">${STATUS_LABEL[h.status] || h.status}${total} · mise ${h.bet}</p>
  </div>`;
}

function chipStackHtml(amount) {
  const chips = chipsForAmount(amount);
  if (!chips.length) return `<div class="bj-chips bj-chips--empty">—</div>`;
  return `<div class="bj-chips">${chips
    .map((v, i) => `<span class="bj-chip bj-chip--${v}" style="--i:${i}">${v}</span>`)
    .join('')}</div>`;
}

const BOARD_SEAT_TO_SPOT = [2, 3, 1, 4, 0];

function boardCardsHtml(cards, { hide = false } = {}) {
  if (!cards?.length) return '';
  if (hide) return cardFaceHtml(cards[0]) + (cards[1] ? cardBackHtml() : '');
  return cards.map(cardFaceHtml).join('');
}

function renderBlackjack2D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const seats = me ? [me, ...others] : others;
  const betting = state.status === 'betting';
  const finished = state.status === 'finished';
  const insurance = Boolean(state.offerInsurance);
  const isMyTurn = state.currentPlayerId === player.id;
  const myActive = me ? activeHand(me) : null;
  const canAct = isMyTurn && !finished && !betting && !insurance && myActive?.status === 'playing';
  const canIns = insurance && isMyTurn && me && canTakeInsurance(state, me);

  const dealerCardsHtml = !state.dealer?.hand?.length
    ? ''
    : state.dealer.hidden
      ? boardCardsHtml(state.dealer.hand, { hide: true })
      : boardCardsHtml(state.dealer.hand);
  const dealerTotalLabel =
    state.dealer?.hand?.length && !state.dealer.hidden ? ` (${handTotal(state.dealer.hand)})` : '';

  const spots = ['', '', '', '', ''];
  seats.forEach((p, i) => {
    const spot = BOARD_SEAT_TO_SPOT[i] ?? 0;
    const hands = playerHands(p);
    const isTurn = p.id === state.currentPlayerId;
    const isMe = p.id === player.id;
    const handsHtml = hands
      .map(
        (h, hi) =>
          `<div class="blackjack-hand ${isMe && hi === (p.handIndex || 0) ? 'blackjack-hand--active' : ''}">${boardCardsHtml(
            h.cards
          )}</div>`
      )
      .join('');
    const bet = hands.reduce((s, h) => s + (h.bet || 0), 0) || p.bet || 0;
    spots[spot] = `
      <div class="bj-spot ${isTurn ? 'bj-spot--turn' : ''} ${isMe ? 'bj-spot--me' : ''}" data-spot="${spot}">
        <div class="bj-spot__hands">${handsHtml}</div>
        ${bet ? `<div class="bj-spot__bet">${chipStackHtml(bet)}</div>` : ''}
        <p class="bj-spot__name"><span class="bj-spot__nick">${p.name}${p.isBot ? ' 🤖' : ''}${connectionBadge(
          state,
          p.id
        )}${betting && p.betReady ? ' · OK' : ''}</span><span class="bj-spot__bank">${moneyLabel(
          p,
          finished,
          state.results
        )}</span></p>
      </div>`;
  });

  let banner = 'Manche terminée';
  if (betting) banner = me?.betReady ? 'En attente des autres mises…' : 'Place tes jetons, puis valide';
  else if (insurance) banner = canIns ? 'Assurance ? (la banque a un As)' : `Assurance — ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
  else if (!finished) banner = isMyTurn ? 'À toi de jouer' : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || 'la banque'}`;

  container.innerHTML = `
    <div class="screen screen--table blackjack-screen blackjack-screen--board">
      <div class="turn-banner ${isMyTurn && !betting ? 'turn-banner--you' : ''}">${banner}</div>
      <div class="blackjack-board-wrap">
        <div class="bj-board">
          <img class="bj-board__art" src="${table2dUrl}" alt="">
          <div class="bj-board__layer">
            <div class="bj-dealer">
              ${dealerCardsHtml ? `<div class="blackjack-hand">${dealerCardsHtml}</div>` : ''}
              <p class="bj-dealer__label">Banque${dealerTotalLabel}</p>
            </div>
            ${spots.join('')}
          </div>
        </div>
      </div>
      <div class="blackjack-hud">
        ${
          betting && me && !me.betReady
            ? `<div class="bj-bet-board">
                 <p class="my-hand__label">Ta mise : <strong>${me.bet}</strong> 💰</p>
                 <div class="bj-chip-tray">
                   ${CHIP_VALUES.map(
                     (v) =>
                       `<button type="button" class="bj-chip bj-chip--${v}" data-chip="${v}" ${
                         me.betReady || me.bet + v > Math.min(500, me.money) ? 'disabled' : ''
                       }>${v}</button>`
                   ).join('')}
                 </div>
                 <div class="blackjack-actions">
                   <button type="button" class="btn btn--ghost" id="btn-clear-bet" ${!me.bet ? 'disabled' : ''}>Retirer</button>
                   <button type="button" class="btn btn--primary" id="btn-confirm-bet">${
                     me.money < MIN_BET ? 'Passer' : 'Valider'
                   }</button>
                 </div>
               </div>`
            : ''
        }
        ${
          canIns
            ? `<div class="blackjack-actions">
                 <button id="btn-ins-yes" class="btn btn--primary">Assurance (${Math.floor(me.bet / 2)})</button>
                 <button id="btn-ins-no" class="btn btn--ghost">Non</button>
               </div>`
            : ''
        }
        ${
          canAct
            ? `<div class="blackjack-actions">
                 <button id="btn-hit" class="btn btn--primary">Tirer</button>
                 <button id="btn-stand" class="btn btn--ghost">Rester</button>
                 ${canDouble(me) ? '<button id="btn-double" class="btn btn--ghost">Doubler</button>' : ''}
                 ${canSplit(me) ? '<button id="btn-split" class="btn btn--ghost">Split</button>' : ''}
               </div>`
            : ''
        }
        ${finished ? endGameActionsHtml() : ''}
      </div>
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles" aria-label="Règles">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal" aria-label="Journal">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter" aria-label="Inviter">📤</button>
      ${threeDToggleHtml('blackjack')}
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  wireBlackjackActions(container, { room, player, state, onLeave, mode: '2d' });
}

function wireBlackjackActions(container, { room, player, state, onLeave, mode }) {
  const act = (sel, fn) => {
    container.querySelector(sel)?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await fn();
      } catch (err) {
        e.target.disabled = false;
        alert(err.message || 'Action impossible.');
      }
    });
  };
  act('#btn-hit', () => hitBlackjack(room, player.id));
  act('#btn-stand', () => standBlackjack(room, player.id));
  act('#btn-double', () => doubleBlackjack(room, player.id));
  act('#btn-split', () => splitBlackjack(room, player.id));
  act('#btn-ins-yes', () => takeInsurance(room, player.id, true));
  act('#btn-ins-no', () => takeInsurance(room, player.id, false));
  act('#btn-clear-bet', () => clearBet(room, player.id));
  act('#btn-confirm-bet', () => confirmBet(room, player.id));
  container.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await addChip(room, player.id, Number(btn.dataset.chip));
      } catch (err) {
        alert(err.message || 'Impossible d’ajouter ce jeton.');
      }
    });
  });
  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'blackjack', () => renderTable(container, { room, player, state, onLeave }));
}

function renderBlackjack3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const betting = state.status === 'betting';
  const finished = state.status === 'finished';
  const insurance = Boolean(state.offerInsurance);
  const isMyTurn = state.currentPlayerId === player.id;
  const myActive = me ? activeHand(me) : null;
  const canAct = isMyTurn && !finished && !betting && !insurance && myActive?.status === 'playing';
  const canIns = insurance && isMyTurn && me && canTakeInsurance(state, me);

  let banner = 'Manche terminée';
  if (betting) banner = me?.betReady ? 'En attente des autres mises…' : 'Place tes jetons';
  else if (insurance) banner = canIns ? 'Assurance ?' : 'Assurance…';
  else if (!finished) banner = isMyTurn ? 'À toi de jouer' : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || 'la banque'}`;

  const others = orderedOpponents(state, player.id);
  const labels = others
    .map(
      (p, i) =>
        `<p class="bj-3d-label ${p.id === state.currentPlayerId ? 'bj-3d-label--turn' : ''}" data-opp-label="${i}">${p.name}${
          p.isBot ? ' 🤖' : ''
        } · ${p.money}💰</p>`
    )
    .join('');

  const chipBtns = betting && me && !me.betReady
    ? CHIP_VALUES.map((v) => `<button type="button" class="bj-3d-chip" data-chip="${v}" data-chip-val="${v}"></button>`).join('')
    : '';

  container.innerHTML = `
    <div class="screen screen--table blackjack-screen blackjack-screen--3d">
      <div class="turn-banner ${isMyTurn && !betting ? 'turn-banner--you' : ''}">${banner}</div>
      <div class="bj-3d-table">
        ${labels}
        ${chipBtns}
      </div>
      ${
        betting && me && !me.betReady
          ? `<div class="blackjack-actions">
               <button type="button" class="btn btn--ghost" id="btn-clear-bet" ${!me.bet ? 'disabled' : ''}>Retirer</button>
               <button type="button" class="btn btn--primary" id="btn-confirm-bet">${me.money < MIN_BET ? 'Passer' : `Valider (${me.bet})`}</button>
             </div>`
          : ''
      }
      ${
        canIns
          ? `<div class="blackjack-actions">
               <button id="btn-ins-yes" class="btn btn--primary">Assurance</button>
               <button id="btn-ins-no" class="btn btn--ghost">Non</button>
             </div>`
          : ''
      }
      ${
        canAct
          ? `<div class="blackjack-actions">
               <button id="btn-hit" class="btn btn--primary">Tirer</button>
               <button id="btn-stand" class="btn btn--ghost">Rester</button>
               ${canDouble(me) ? '<button id="btn-double" class="btn btn--ghost">Doubler</button>' : ''}
               ${canSplit(me) ? '<button id="btn-split" class="btn btn--ghost">Split</button>' : ''}
             </div>`
          : ''
      }
      ${finished ? endGameActionsHtml() : ''}
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game">📤</button>
      ${threeDToggleHtml('blackjack')}
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  mountTable();
  const tableEl = container.querySelector('.bj-3d-table');
  updateTable({
    me,
    opponents: others,
    dealer: state.dealer,
    betting,
    finished,
    currentPlayerId: state.currentPlayerId
  });
  showTable();
  if (tableEl) {
    const sync = () => {
      positionTable(tableEl.getBoundingClientRect());
      const chips = getChipRects();
      tableEl.querySelectorAll('.bj-3d-chip').forEach((btn) => {
        const r = chips.find((c) => c.value === Number(btn.dataset.chipVal));
        if (!r) return;
        btn.style.left = `${r.left}px`;
        btn.style.top = `${r.top}px`;
        btn.style.width = `${r.width}px`;
        btn.style.height = `${r.height}px`;
      });
      getRowLabelAnchors().opponents.forEach((anchor, i) => {
        const el = tableEl.querySelector(`[data-opp-label="${i}"]`);
        if (!el || !anchor) return;
        el.style.left = `${anchor.left}px`;
        el.style.top = `${anchor.top}px`;
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(tableEl);
    wireBjOrbit(tableEl, sync);
  }
  wireBlackjackActions(container, { room, player, state, onLeave, mode: '3d' });
}

function wireBjOrbit(tableEl, onOrbit) {
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
      moved = true;
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
      if (pinching || e.target.closest('.bj-3d-chip')) {
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
