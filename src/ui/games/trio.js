import { playAgain, continueGame } from '../../game/engine.js';
import { revealTrioCenter, revealTrioRow, confirmTrioTurn } from '../../game/trio.js';
import { openRulesModal } from '../rules.js';

export function resetSelection() {}

export function renderTable(container, { room, player, state, onLeave }) {
  renderTrioTable(container, { room, player, state, onLeave });
}

function trioCardHtml(value, { faceUp = false, small = false } = {}) {
  return `<div class="trio-cell ${faceUp ? 'trio-cell--faceup' : 'trio-cell--facedown'} ${small ? 'trio-cell--small' : ''}">${faceUp ? value : ''}</div>`;
}

/**
 * Rangée triée d'un joueur : seules les deux extrémités (`low`/`high`) sont
 * jamais cliquables (voir trio.js) — les cases du milieu sont de simples
 * cartes cachées, non interactives, pour donner une idée de la longueur de
 * la main sans jamais en révéler le contenu.
 */
function trioRowHtml(row, { targetPlayerId, clickableEnds = false } = {}) {
  if (!row.length) return `<div class="trio-row trio-row--empty">Main vide</div>`;
  const cells = row
    .map((card, i) => {
      const end = i === 0 ? 'low' : i === row.length - 1 ? 'high' : null;
      const clickable = clickableEnds && end && !(row.length === 1 && end === 'high'); // évite un doublon low+high sur 1 seule carte
      if (clickable) {
        return `<button type="button" class="trio-cell-btn" data-row-target="${targetPlayerId}" data-row-end="${end}">${trioCardHtml(card.value, { faceUp: false })}</button>`;
      }
      return trioCardHtml(card.value, { faceUp: false });
    })
    .join('');
  return `<div class="trio-row">${cells}</div>`;
}

function trioSourceLabel(state, source) {
  if (source.type === 'center') return 'centre';
  const p = state.players.find((pl) => pl.id === source.playerId);
  return `${p?.name || '?'} (${source.end === 'low' ? 'petit' : 'grand'} bout)`;
}

function renderTrioTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const awaitingConfirm = Boolean(state.turnOutcome);
  const canReveal = isMyTurn && !awaitingConfirm && state.pendingReveals.length < 3;
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const actionHint = !isMyTurn
    ? awaitingConfirm
      ? `${currentName || '…'} regarde le résultat…`
      : `Tour de ${currentName || '…'}`
    : awaitingConfirm
      ? state.turnOutcome.type === 'success'
        ? `Trio de ${state.turnOutcome.trioValue} ! Clique sur "Continuer".`
        : 'Pas de correspondance — clique sur "Continuer" pour remettre les cartes en place.'
      : state.pendingReveals.length === 0
        ? 'Révèle une carte : le centre, ou une extrémité (main d\'un adversaire ou la tienne).'
        : 'Encore une carte identique à trouver !';

  const winnerBanner =
    state.status === 'finished'
      ? `<p class="flip7-banner flip7-banner--winner">🃏 ${
          state.winnerId ? `${state.players.find((p) => p.id === state.winnerId)?.name || '?'} gagne la partie !` : 'Égalité — plus aucune carte disponible.'
        }</p>`
      : '';

  const centerHtml = state.center
    .map((c) => {
      if (c.taken) return `<div class="trio-cell trio-cell--gone"></div>`;
      const alreadyRevealed = state.pendingReveals.some((r) => r.source.cardId === c.id);
      const clickable = canReveal && !alreadyRevealed;
      const pending = state.pendingReveals.find((r) => r.source.cardId === c.id);
      if (pending) return trioCardHtml(pending.value, { faceUp: true });
      if (clickable) {
        return `<button type="button" class="trio-cell-btn" data-center-id="${c.id}">${trioCardHtml(0, { faceUp: false })}</button>`;
      }
      return trioCardHtml(0, { faceUp: false });
    })
    .join('');

  const revealedHtml = state.pendingReveals.length
    ? `<div class="trio-revealed">
        ${state.pendingReveals
          .map((r) => `<div class="trio-revealed__item">${trioCardHtml(r.value, { faceUp: true, small: true })}<span>${trioSourceLabel(state, r.source)}</span></div>`)
          .join('')}
      </div>`
    : '';

  const opponentsHtml = state.players
    .filter((p) => p.id !== player.id)
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `<div class="trio-player ${isTurn ? 'trio-player--turn' : ''}">
        <p class="trio-player__name">${p.name}${p.isBot ? ' 🤖' : ''} <span class="trio-player__trios">${p.trios.length} trio${p.trios.length > 1 ? 's' : ''}</span></p>
        ${trioRowHtml(p.row, { targetPlayerId: p.id, clickableEnds: canReveal })}
      </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table trio-screen">
      <header class="table-header">
        <div>
          <p class="eyebrow">Trio</p>
          <h1 class="table-title">Mémoire des trios</h1>
        </div>
        <div class="table-header__actions">
          <button id="btn-rules" class="btn btn--ghost btn--small">Règles</button>
          <button id="btn-leave" class="btn btn--ghost btn--small">Quitter</button>
        </div>
      </header>

      <div class="table-felt trio-felt">
        ${winnerBanner}
        <p class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${actionHint}</p>

        <div class="trio-center">
          <p class="trio-center__label">Centre</p>
          <div class="trio-row">${centerHtml}</div>
        </div>

        ${revealedHtml}

        ${awaitingConfirm && isMyTurn ? `<button id="btn-trio-confirm" class="btn btn--primary">Continuer</button>` : ''}

        <div class="trio-opponents">${opponentsHtml}</div>

        ${
          me
            ? `<div class="trio-my-hand">
                 <p class="trio-my-hand__label">Ta main · ${me.trios.length} trio${me.trios.length > 1 ? 's' : ''}</p>
                 ${trioRowHtml(me.row, { targetPlayerId: me.id, clickableEnds: canReveal })}
               </div>`
            : ''
        }

        ${
          state.status === 'finished'
            ? `<div class="lucky-end-actions">
                 <button id="btn-continue" class="btn btn--primary">Rejouer</button>
                 <button id="btn-lobby" class="btn btn--secondary">Salon</button>
               </div>`
            : ''
        }
      </div>

      <details class="log">
        <summary>Journal</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-leave')?.addEventListener('click', () => onLeave?.());

  container.querySelector('#btn-continue')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await continueGame(room);
    } catch (err) {
      alert(err.message || String(err));
      e.target.disabled = false;
    }
  });
  container.querySelector('#btn-lobby')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await playAgain(room);
    } catch (err) {
      alert(err.message || String(err));
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-trio-confirm')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await confirmTrioTurn(room, player.id);
    } catch (err) {
      alert(err.message || String(err));
      e.target.disabled = false;
    }
  });

  if (canReveal) {
    container.querySelectorAll('[data-center-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await revealTrioCenter(room, player.id, btn.dataset.centerId);
        } catch (err) {
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
          alert(err.message || String(err));
        }
      });
    });
  }
}
