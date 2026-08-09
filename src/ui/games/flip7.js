import { hitFlip7, stayFlip7, TARGET_SCORE as FLIP7_TARGET_SCORE } from '../../game/flip7.js';
import { openRulesModal } from '../rules.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions
} from '../gameShared.js';

const FLIP7_STATUS_LABEL = { active: 'En jeu', stayed: 'Resté', busted: 'Passé !' };
const FLIP7_ACTION_LABEL = { freeze: '❄️ Freeze', flipThree: '🔀 Flip Three', secondChance: '🛡️ 2e chance' };

export function resetSelection() {}

export function renderTable(container, { room, player, state, onLeave }) {
  renderFlip7Table(container, { room, player, state, onLeave });
}

function flip7CardHtml(card) {
  if (card.kind === 'number') return `<div class="flip7-card flip7-card--number">${card.value}</div>`;
  if (card.kind === 'modifier') return `<div class="flip7-card flip7-card--modifier">${card.label}</div>`;
  return `<div class="flip7-card flip7-card--action">${FLIP7_ACTION_LABEL[card.kind] || card.label}</div>`;
}

function renderFlip7Table(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const canAct = isMyTurn && me.status === 'active' && !finished;

  const uniqueCountFor = (p) => p.display.filter((c) => c.kind === 'number').length;
  const statusLabelFor = (p) =>
    finished ? `${FLIP7_STATUS_LABEL[p.status]} · ${p.roundScore ?? 0} pt${(p.roundScore ?? 0) > 1 ? 's' : ''} cette manche` : FLIP7_STATUS_LABEL[p.status];

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="flip7-mini-hand">${p.display.map(flip7CardHtml).join('') || '<span class="flip7-mini-hand__empty">—</span>'}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${uniqueCountFor(p)}/7 · ${statusLabelFor(p)}</p>
          <p class="opponent__name">Score total : ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table flip7-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt flip7-felt">
        ${
          state.flip7PlayerId
            ? `<p class="flip7-banner">🎉 ${state.players.find((p) => p.id === state.flip7PlayerId)?.name || '?'} a réalisé un FLIP 7 !</p>`
            : ''
        }
        ${
          state.gameWinnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.gameWinnerId)?.name || '?'} a atteint ${FLIP7_TARGET_SCORE} points et gagne la partie !</p>`
            : ''
        }
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? 'À toi de flipper'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`
          }
        </div>
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${uniqueCountFor(me)}/7) · ${statusLabelFor(me)}</p>
        <p class="my-hand__label">Score total : ${me.score}${me.id === state.gameWinnerId ? ' 🏆' : ''}</p>
        <div class="flip7-hand">${me.display.map(flip7CardHtml).join('') || '<p class="my-hand__empty">Pas encore de carte cette manche.</p>'}</div>

        ${
          canAct
            ? `<div class="flip7-actions">
                 <button id="btn-hit" class="btn btn--primary">Flip !</button>
                 <button id="btn-stay" class="btn btn--ghost">Rester</button>
               </div>`
            : ''
        }

        ${
          finished
            ? state.gameWinnerId
              ? endGameActionsHtml({ continueBtn: false, lobby: true })
              : endGameActionsHtml({ continueBtn: true, lobby: false })
            : ''
        }

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-hit')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await hitFlip7(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de flipper une carte.');
    }
  });

  container.querySelector('#btn-stay')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await stayFlip7(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de rester.');
    }
  });

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });
}
