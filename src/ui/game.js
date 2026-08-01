import { cardFaceHtml, cardBackHtml } from './cards.js';
import { startGame, drawForCurrentPlayer } from '../game/engine.js';
import { playerToDrawFrom as computeTarget } from '../game/pouilleux.js';

function rankSortValue(rank) {
  const order = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  return order.indexOf(rank);
}

function sortedHand(hand) {
  return hand.slice().sort((a, b) => rankSortValue(a.rank) - rankSortValue(b.rank) || a.suit.localeCompare(b.suit));
}

function shareUrl(code) {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  return url.toString();
}

/**
 * Affiche l'écran de partie (salle d'attente / plateau / fin) dans `container`.
 * `room` = ligne courante (state inclus), `player` = joueur local.
 * `onLeave()` optionnel pour revenir au lobby.
 */
export function renderGame(container, { room, player, onLeave } = {}) {
  const state = room.state;

  if (state.status === 'lobby') return renderWaitingRoom(container, { room, player, onLeave });
  if (state.status === 'playing') return renderTable(container, { room, player });
  if (state.status === 'finished') return renderEndScreen(container, { room, player, onLeave });
}

function renderWaitingRoom(container, { room, player, onLeave }) {
  const state = room.state;
  const isHost = state.hostId === player.id;

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card">
        <p class="eyebrow">Table ouverte</p>
        <h1>Code : <span class="room-code">${room.code}</span></h1>
        <p class="lobby-card__intro">Partagez ce code, ou ce lien, avec les autres joueurs.</p>
        <div class="share-row">
          <input readonly value="${shareUrl(room.code)}" onclick="this.select()" />
          <button class="btn btn--ghost btn--small" id="btn-copy">Copier</button>
        </div>

        <ul class="player-list">
          ${state.players
            .map(
              (p) => `<li>${p.name}${p.id === state.hostId ? ' <span class="tag">hôte</span>' : ''}${p.id === player.id ? ' <span class="tag tag--you">toi</span>' : ''}</li>`
            )
            .join('')}
        </ul>

        ${
          isHost
            ? `<button id="btn-start" class="btn btn--primary" ${state.players.length < 2 ? 'disabled' : ''}>
                 ${state.players.length < 2 ? 'En attente d\'un 2ᵉ joueur…' : 'Lancer la partie'}
               </button>`
            : `<p class="waiting-note">En attente que l'hôte lance la partie…</p>`
        }
        ${onLeave ? `<button class="btn btn--link" id="btn-leave">Quitter la table</button>` : ''}
      </div>
    </div>
  `;

  container.querySelector('#btn-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(shareUrl(room.code));
  });

  container.querySelector('#btn-start')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await startGame(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de lancer la partie.');
    }
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => onLeave());
}

function renderTable(container, { room, player }) {
  const state = room.state;
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
        ${onLeave ? `<button class="btn btn--primary" id="btn-again">Retour à l'accueil</button>` : ''}
      </div>
    </div>
  `;

  container.querySelector('#btn-again')?.addEventListener('click', () => onLeave());
}
