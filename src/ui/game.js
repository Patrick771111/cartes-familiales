import { cardFaceHtml, cardBackHtml } from './cards.js';
import { AVAILABLE_GAMES, startGame, drawForCurrentPlayer, playCards, passTurn, playAgain } from '../game/engine.js';
import { playerToDrawFrom as computeTarget } from '../game/pouilleux.js';
import { rankValue as trouducRankValue, rankLabel as trouducRankLabel } from '../game/trouduc.js';

function rankSortValue(rank) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(rank);
}

function sortedHand(hand) {
  return hand.slice().sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.suit.localeCompare(b.suit));
}

/**
 * Affiche l'écran de partie (salle d'attente / plateau / fin) dans `container`.
 * `room` = ligne courante (state + type de jeu inclus), `player` = profil local.
 * `onRename(newName)` optionnel, pour corriger le prénom depuis la salle d'attente.
 */
export function renderGame(container, { room, player, onRename, onLeave, onKick } = {}) {
  const state = room.state;

  if (state.status === 'lobby') {
    lastRenderedState = null;
    lastShownExchangeId = null;
    return renderWaitingRoom(container, { room, player, onRename, onLeave, onKick });
  }

  const previous = lastRenderedState;
  const isNewDraw = previous && state.lastDraw && (!previous.lastDraw || previous.lastDraw.id !== state.lastDraw.id);

  if (isNewDraw) {
    return renderDrawReveal(container, { previousState: previous, newState: state, player, room, onLeave });
  }

  lastRenderedState = state;

  const isTrouduc = room.game === 'trouduc';
  if (state.status === 'playing') {
    if (isTrouduc && state.cardExchange && state.cardExchange.id !== lastShownExchangeId) {
      return renderTrouducExchangeReveal(container, { room, player, state });
    }
    return isTrouduc
      ? renderTrouducTable(container, { room, player, state })
      : renderTableNow(container, { room, player, state });
  }
  if (state.status === 'finished') {
    return isTrouduc
      ? renderTrouducEnd(container, { room, player, state, onLeave })
      : renderEndScreen(container, { room, player, onLeave });
  }
}

function renderWaitingRoom(container, { room, player, onRename, onLeave, onKick }) {
  const state = room.state;
  const isHost = state.hostId === player.id;
  const me = state.players.find((p) => p.id === player.id);

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Table ouverte</h1>
        <p class="lobby-card__intro">
          ${isHost ? "Attends que les autres arrivent, choisis le jeu, puis lance la partie." : "En attente que l'hôte lance la partie…"}
        </p>

        <ul class="player-list">
          ${state.players
            .map(
              (p) => `
                <li>
                  <span>${p.name}${p.id === state.hostId ? ' <span class="tag">hôte</span>' : ''}${p.id === player.id ? ' <span class="tag tag--you">toi</span>' : ''}</span>
                  ${isHost && p.id !== player.id ? `<button class="player-list__kick" data-kick-id="${p.id}" title="Retirer ${p.name}" aria-label="Retirer ${p.name}">✕</button>` : ''}
                </li>`
            )
            .join('')}
        </ul>

        ${
          isHost
            ? `
              <div class="game-picker">
                <p class="game-picker__label">Quel jeu ?</p>
                <div class="game-picker__options">
                  ${AVAILABLE_GAMES.map(
                    (g, i) => `
                      <label class="game-picker__option">
                        <input type="radio" name="game" value="${g.id}" ${i === 0 ? 'checked' : ''} />
                        <span>${g.label}<br/><small>${g.hint}</small></span>
                      </label>`
                  ).join('')}
                </div>
              </div>
              <button id="btn-start" class="btn btn--primary" ${state.players.length < 2 ? 'disabled' : ''}>
                ${state.players.length < 2 ? "En attente d'un 2ᵉ joueur…" : `Lancer la partie (${state.players.length} joueurs)`}
              </button>`
            : ''
        }
        <button class="btn btn--link" id="btn-rename">Ce n'est pas ${me?.name || 'toi'} ? Changer de prénom</button>
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-start')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const selectedGame = container.querySelector('input[name="game"]:checked')?.value || 'pouilleux';
    try {
      await startGame(room, selectedGame);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de lancer la partie.');
    }
  });

  container.querySelector('#btn-rename')?.addEventListener('click', () => {
    const newName = window.prompt('Ton prénom :', me?.name || '');
    if (newName && newName.trim() && onRename) onRename(newName.trim());
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });

  container.querySelectorAll('.player-list__kick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.kickId;
      const name = state.players.find((p) => p.id === id)?.name || 'ce joueur';
      if (window.confirm(`Retirer ${name} de la table ?`)) onKick?.(id);
    });
  });
}

/* ============================== Le Pouilleux ============================== */

// Mémorise le dernier état affiché, pour pouvoir comparer et détecter une nouvelle pioche
// à animer avant de basculer sur l'état à jour. Réinitialisé à chaque nouvelle partie.
let lastRenderedState = null;

function renderDrawReveal(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow(container, { room: { ...room, state: previousState }, player, state: previousState });

  const draw = newState.lastDraw;
  const drawer = previousState.players.find((p) => p.id === draw.by);
  const target = previousState.players.find((p) => p.id === draw.from);

  const overlay = document.createElement('div');
  overlay.className = 'draw-reveal';
  overlay.innerHTML = `
    <div class="draw-reveal__card">${cardFaceHtml(draw.card)}</div>
    <p class="draw-reveal__label">
      ${drawer?.name || '?'} pioche chez ${target?.name || '?'}${draw.paired ? ' — paire !' : ''}
    </p>
  `;
  container.querySelector('.table-felt')?.appendChild(overlay);

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    lastRenderedState = newState;
    if (newState.status === 'finished') {
      renderEndScreen(container, { room, player, onLeave });
    } else {
      renderTableNow(container, { room, player, state: newState });
    }
  }, reduceMotion ? 500 : 1400);
}

function renderTableNow(container, { room, player, state }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const targetId = isMyTurn ? computeTarget(state) : null;
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <div class="opponents">
          ${others
            .map((p) => {
              const isTarget = p.id === targetId;
              const isTurn = p.id === state.currentPlayerId;
              return `
                <div class="opponent ${isTurn ? 'opponent--turn' : ''} ${isTarget ? 'opponent--target' : ''}">
                  <div class="opponent__hand">
                    ${p.hand.length === 0 ? '' : Array.from({ length: Math.min(p.hand.length, 7) }).map(() => cardBackHtml()).join('')}
                    ${p.hand.length > 7 ? `<span class="opponent__count">+${p.hand.length - 6}</span>` : ''}
                  </div>
                  <p class="opponent__name">${p.name}${p.hand.length === 0 ? ' — sorti·e' : ` · ${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`}</p>
                </div>`;
            })
            .join('')}
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${isMyTurn ? "C'est ton tour" : `Tour de ${currentPlayerName}`}
        </div>

        ${
          isMyTurn
            ? `<button id="btn-draw" class="btn btn--primary btn--draw">
                 Piocher chez ${state.players.find((p) => p.id === targetId)?.name || '…'}
               </button>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${me.hand.length})</p>
        <div class="my-hand__cards">
          ${sortedHand(me.hand).map(cardFaceHtml).join('') || '<p class="my-hand__empty">Tu es sorti·e, bravo !</p>'}
        </div>
      </div>

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawForCurrentPlayer(room, player.id);
    } catch (err) {
      // Un conflit ou une action hors-tour se résorbe via la resynchro realtime :
      // pas besoin d'alerte bruyante, l'écran se remettra à jour tout seul.
      e.target.disabled = false;
    }
  });
}

function renderEndScreen(container, { room, player, onLeave }) {
  const state = room.state;
  const loser = state.players.find((p) => p.id === state.loserId);
  const youLost = state.loserId === player.id;

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <div class="odd-card-reveal">${cardFaceHtml({ id: state.oddCardId, rank: state.oddCardId.slice(0, -1), suit: state.oddCardId.slice(-1) })}</div>
        <h1>${youLost ? 'Tu es le Pouilleux !' : `${loser?.name || '?'} est le Pouilleux !`}</h1>
        <button class="btn btn--primary" id="btn-again">Rejouer</button>
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-again')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await playAgain(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de relancer une partie.');
    }
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}

/* ============================== Le Trou du Cul ============================== */

// Sélection de cartes en cours pour le joueur local (remise à zéro dès que ce
// n'est plus son tour). Vit en dehors du DOM pour survivre aux re-rendus.
let selectedCardIds = new Set();

// Id du dernier échange de cartes déjà montré sur cet appareil, pour ne pas
// répéter l'écran de révélation à chaque re-rendu pendant la même manche.
let lastShownExchangeId = null;

function renderTrouducExchangeReveal(container, { room, player, state }) {
  const byId = Object.fromEntries(state.players.map((p) => [p.id, p]));

  const pairHtml = (pair) => {
    const from = byId[pair.fromId];
    const to = byId[pair.toId];
    return `
      <div class="exchange-pair">
        <p class="exchange-pair__label">${from?.name} <span class="exchange-pair__role">(${from?.role})</span> → ${to?.name} <span class="exchange-pair__role">(${to?.role})</span></p>
        <div class="exchange-pair__row">
          <div class="exchange-pair__side">
            <p class="exchange-pair__side-label">Donne</p>
            <div class="exchange-pair__cards">${pair.given.map(cardFaceHtml).join('')}</div>
          </div>
          <div class="exchange-pair__arrow">⇄</div>
          <div class="exchange-pair__side">
            <p class="exchange-pair__side-label">Reçoit en retour</p>
            <div class="exchange-pair__cards">${pair.returned.map(cardFaceHtml).join('')}</div>
          </div>
        </div>
      </div>`;
  };

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card lobby-card--exchange">
        <p class="eyebrow">Nouvelle manche</p>
        <h1>Échange de cartes</h1>
        ${state.cardExchange.pairs.map(pairHtml).join('')}
        <button id="btn-continue" class="btn btn--primary">Voir ma main</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-continue').addEventListener('click', () => {
    lastShownExchangeId = state.cardExchange.id;
    renderTrouducTable(container, { room, player, state });
  });
}

function renderTrouducTable(container, { room, player, state }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) selectedCardIds = new Set();

  const selectedCards = me.hand.filter((c) => selectedCardIds.has(c.id));
  const selectedRank = selectedCards[0]?.rank;
  const selectionValid =
    isMyTurn &&
    selectedCards.length > 0 &&
    selectedCards.every((c) => c.rank === selectedRank) &&
    (state.pileCount === 0
      ? true
      : selectedCards.length === state.pileCount && trouducRankValue(selectedRank) > trouducRankValue(state.pileRank));
  const canPass = isMyTurn && state.pileCount > 0;

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <div class="opponents">
          ${others
            .map((p) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = p.finished
                ? trouducRankLabel(p.rank)
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const label = p.role ? `${p.role} · ${status}` : status;
              return `
                <div class="opponent ${isTurn ? 'opponent--turn' : ''} ${p.finished ? 'opponent--finished' : ''}">
                  <div class="opponent__hand">
                    ${p.finished ? '' : Array.from({ length: Math.min(p.hand.length, 7) }).map(() => cardBackHtml()).join('')}
                  </div>
                  <p class="opponent__name">${p.name} · ${label}</p>
                </div>`;
            })
            .join('')}
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${isMyTurn ? "C'est ton tour" : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`}
        </div>

        <div class="pile">
          ${
            state.pileCount > 0
              ? `<div class="pile__cards">${state.pile.map(cardFaceHtml).join('')}</div>
                 <p class="pile__label">${state.pileCount} × ${state.pileRank}</p>`
              : `<p class="pile__empty">Pli libre — pose ce que tu veux</p>`
          }
        </div>

        ${
          isMyTurn
            ? `<div class="trouduc-actions">
                 <button id="btn-play" class="btn btn--primary" ${selectionValid ? '' : 'disabled'}>
                   Jouer${selectedCards.length ? ` (${selectedCards.length})` : ''}
                 </button>
                 <button id="btn-pass" class="btn btn--ghost" ${canPass ? '' : 'disabled'}>Passer</button>
               </div>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length})</p>
        <div class="my-hand__cards">
          ${
            me.hand
              .map(
                (c) =>
                  `<div class="hand-card ${selectedCardIds.has(c.id) ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${cardFaceHtml(c)}</div>`
              )
              .join('') || '<p class="my-hand__empty">Tu as fini, bravo !</p>'
          }
        </div>
      </div>

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  if (isMyTurn) {
    container.querySelectorAll('.hand-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.cardId;
        if (selectedCardIds.has(id)) selectedCardIds.delete(id);
        else selectedCardIds.add(id);
        renderTrouducTable(container, { room, player, state });
      });
    });
  }

  container.querySelector('#btn-play')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    const ids = [...selectedCardIds];
    try {
      await playCards(room, player.id, ids);
      selectedCardIds = new Set();
    } catch (err) {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-pass')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await passTurn(room, player.id);
    } catch (err) {
      e.target.disabled = false;
    }
  });
}

function renderTrouducEnd(container, { room, player, state, onLeave }) {
  const ranked = state.players.slice().sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const me = state.players.find((p) => p.id === player.id);

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <h1>${trouducRankLabel(me?.rank)}${me?.rank === 1 ? ' 🏆' : ''}</h1>
        <ol class="rank-list">
          ${ranked
            .map((p) => `<li>${trouducRankLabel(p.rank)} — ${p.name}${p.id === player.id ? ' (toi)' : ''}</li>`)
            .join('')}
        </ol>
        <button class="btn btn--primary" id="btn-again">Rejouer</button>
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-again')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await playAgain(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de relancer une partie.');
    }
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}
