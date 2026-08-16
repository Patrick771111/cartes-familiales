import { cardFaceHtml, cardBackHtml } from '../cards.js';
import {
  hitBlackjack,
  standBlackjack,
  setBlackjackBet,
  handTotal,
  DEFAULT_BET as BLACKJACK_DEFAULT_BET,
  MIN_BET as BLACKJACK_MIN_BET,
  MAX_BET as BLACKJACK_MAX_BET
} from '../../game/blackjack.js';
import { openRulesModal } from '../rules.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents,
  openLogModal
} from '../gameShared.js';

const BLACKJACK_STATUS_LABEL = { playing: 'En jeu', stood: 'Reste', bust: 'Passé !' };
const BLACKJACK_RESULT_LABEL = { win: 'Gagné 🎉', lose: 'Perdu', push: 'Égalité' };

export function resetSelection() {}

export function renderTable(container, { room, player, state, onLeave }) {
  renderBlackjackTable(container, { room, player, state, onLeave });
}

function renderBlackjackTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';

  const dealerCardsHtml = state.dealer.hidden
    ? cardFaceHtml(state.dealer.hand[0]) + cardBackHtml()
    : state.dealer.hand.map(cardFaceHtml).join('');
  const dealerTotalLabel = state.dealer.hidden ? '' : ` (${handTotal(state.dealer.hand)})`;

  const betFor = (p) => p.bet ?? BLACKJACK_DEFAULT_BET;
  const moneyDeltaFor = (id) => {
    const r = state.results?.[id];
    const target = state.players.find((p) => p.id === id);
    const bet = betFor(target || {});
    return r === 'win' ? bet : r === 'lose' ? -bet : 0;
  };
  const moneyLabelFor = (p) => {
    if (!finished) return `${p.money} 💰 (mise : ${betFor(p)})`;
    const delta = moneyDeltaFor(p.id);
    const deltaLabel = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '±0';
    return `${p.money} 💰 (${deltaLabel})`;
  };

  const restHtml = others
    .map((p) => {
      const total = handTotal(p.hand);
      const label = finished ? BLACKJACK_RESULT_LABEL[state.results?.[p.id]] || BLACKJACK_STATUS_LABEL[p.status] : BLACKJACK_STATUS_LABEL[p.status];
      const isTurn = p.id === state.currentPlayerId;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand opponent__hand--revealed">${p.hand.map(cardFaceHtml).join('')}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${total} · ${label}</p>
          <p class="opponent__name">${moneyLabelFor(p)}</p>
        </div>`;
    })
    .join('');

  const meTotal = handTotal(me.hand);
  const myResultLabel = finished ? BLACKJACK_RESULT_LABEL[state.results?.[me.id]] || BLACKJACK_STATUS_LABEL[me.status] : BLACKJACK_STATUS_LABEL[me.status];
  const canAct = isMyTurn && me.status === 'playing' && !finished;

  container.innerHTML = `
    <div class="screen screen--table blackjack-screen">
      <div class="table-felt blackjack-felt">
        <div class="blackjack-dealer">
          <p class="blackjack-dealer__label">🏦 Banque${dealerTotalLabel}</p>
          <div class="blackjack-hand">${dealerCardsHtml}</div>
        </div>

        <div class="pouilleux-zone pouilleux-zone--others">
          ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? 'À toi de jouer'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || 'la banque'}`
          }
        </div>
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${meTotal}) · ${myResultLabel}</p>
        <p class="my-hand__label">${moneyLabelFor(me)}</p>
        <div class="my-hand__cards">${me.hand.map(cardFaceHtml).join('')}</div>

        ${
          canAct
            ? `<div class="blackjack-actions">
                 <button id="btn-hit" class="btn btn--primary">Tirer</button>
                 <button id="btn-stand" class="btn btn--ghost">Rester</button>
               </div>`
            : ''
        }

        ${
          finished
            ? `<div class="blackjack-bet-picker">
                 <label for="bet-slider">Ta mise pour la prochaine manche : <strong id="bet-slider-value">${betFor(me)}</strong> 💰</label>
                 <input type="range" id="bet-slider" min="${BLACKJACK_MIN_BET}" max="${BLACKJACK_MAX_BET}" step="5" value="${betFor(me)}" />
               </div>`
            : ''
        }

        ${finished ? endGameActionsHtml() : ''}

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-hit')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await hitBlackjack(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de tirer une carte.');
    }
  });

  container.querySelector('#btn-stand')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await standBlackjack(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de rester.');
    }
  });

  const betSlider = container.querySelector('#bet-slider');
  betSlider?.addEventListener('input', (e) => {
    container.querySelector('#bet-slider-value').textContent = e.target.value;
  });
  betSlider?.addEventListener('change', async (e) => {
    try {
      await setBlackjackBet(room, player.id, Number(e.target.value));
    } catch (err) {
      alert(err.message || 'Impossible de changer la mise.');
    }
  });

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireAbandonButton(container, { room, player, state, onLeave });
}
