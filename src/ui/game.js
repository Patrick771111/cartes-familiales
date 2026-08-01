import { cardFaceHtml, cardBackHtml } from './cards.js';
import { AVAILABLE_GAMES, startGame, drawForCurrentPlayer, playCards, passTurn, playAgain, addBot, submitExchangeGift } from '../game/engine.js';
import { playerToDrawFrom as computeTarget } from '../game/pouilleux.js';
import { rankValue as trouducRankValue, rankLabel as trouducRankLabel } from '../game/trouduc.js';
import { getOrderedHand, moveCard, resetHandOrder } from './handOrder.js';
import { enableHandDrag } from './dragReorder.js';

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
    lastCelebratedMoveId = null;
    resetHandOrder('pouilleux');
    resetHandOrder('trouduc');
    return renderWaitingRoom(container, { room, player, onRename, onLeave, onKick });
  }

  if (state.status === 'exchange') {
    return renderTrouducExchange(container, { room, player, state });
  }

  const previous = lastRenderedState;
  const isNewDraw = previous && state.lastDraw && (!previous.lastDraw || previous.lastDraw.id !== state.lastDraw.id);

  if (isNewDraw) {
    return renderDrawReveal(container, { previousState: previous, newState: state, player, room, onLeave });
  }

  lastRenderedState = state;

  const isTrouduc = room.game === 'trouduc';
  if (state.status === 'playing') {
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
                  <span>${p.name}${p.isBot ? ' 🤖' : ''}${p.id === state.hostId ? ' <span class="tag">hôte</span>' : ''}${p.id === player.id ? ' <span class="tag tag--you">toi</span>' : ''}</span>
                  ${isHost && p.id !== player.id ? `<button class="player-list__kick" data-kick-id="${p.id}" title="Retirer ${p.name}" aria-label="Retirer ${p.name}">✕</button>` : ''}
                </li>`
            )
            .join('')}
        </ul>

        ${
          isHost && state.players.length < 4
            ? `<button class="btn btn--ghost btn--small" id="btn-add-bot">+ Ajouter un bot</button>`
            : ''
        }

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

  container.querySelector('#btn-add-bot')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await addBot(room);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible d'ajouter un bot.");
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

function vibrate(pattern) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

function renderDrawReveal(container, { previousState, newState, player, room, onLeave }) {
  renderTableNow(container, { room: { ...room, state: previousState }, player, state: previousState });

  const draw = newState.lastDraw;
  const drawer = previousState.players.find((p) => p.id === draw.by);
  const target = previousState.players.find((p) => p.id === draw.from);

  const isOddCard = draw.card.id === newState.oddCardId;
  const isFinalReveal = isOddCard && newState.status === 'finished';
  const safeNames = [draw.drawerFinished ? drawer?.name : null, draw.targetFinished ? target?.name : null].filter(Boolean);

  const overlayClasses = ['draw-reveal'];
  if (isOddCard) overlayClasses.push('draw-reveal--danger');
  if (safeNames.length) overlayClasses.push('draw-reveal--safe');

  const extraMessages = [];
  if (isOddCard) {
    extraMessages.push(isFinalReveal ? `${drawer?.name || '?'} est LE Pouilleux !` : 'Attention, LE Pouilleux !');
  }
  safeNames.forEach((name) => extraMessages.push(`${name} est à l'abri !`));

  const overlay = document.createElement('div');
  overlay.className = overlayClasses.join(' ');
  overlay.innerHTML = `
    <div class="draw-reveal__card">${cardFaceHtml(draw.card)}</div>
    <p class="draw-reveal__label">
      ${drawer?.name || '?'} pioche chez ${target?.name || '?'}${draw.paired ? ' — paire !' : ''}
    </p>
    ${extraMessages.map((m) => `<p class="draw-reveal__extra">${m}</p>`).join('')}
  `;
  container.querySelector('.table-felt')?.appendChild(overlay);

  if (isFinalReveal) {
    vibrate([150, 80, 150, 80, 300]);
  } else if (isOddCard) {
    vibrate([80, 40, 80, 40, 150]);
  } else if (safeNames.length) {
    vibrate(200);
  }

  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    lastRenderedState = newState;
    if (newState.status === 'finished') {
      renderEndScreen(container, { room, player, onLeave });
    } else {
      renderTableNow(container, { room, player, state: newState });
    }
  }, reduceMotion ? 500 : isOddCard || safeNames.length ? 1900 : 1400);
}

function renderTableNow(container, { room, player, state }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const targetId = isMyTurn ? computeTarget(state) : null;
  const targetName = state.players.find((p) => p.id === targetId)?.name || '';
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';
  const orderedHand = getOrderedHand('pouilleux', me.hand, sortedHand);

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <div class="opponents">
          ${others
            .map((p) => {
              const isTarget = p.id === targetId;
              const isTurn = p.id === state.currentPlayerId;
              const pickable = isMyTurn && isTarget && p.hand.length > 0;
              const handHtml = pickable
                ? Array.from({ length: p.hand.length })
                    .map(
                      (_, i) =>
                        `<button type="button" class="card card--back opponent-card--pickable" data-pick-index="${i}"><span class="card__back-pattern"></span></button>`
                    )
                    .join('')
                : p.hand.length === 0
                  ? ''
                  : Array.from({ length: Math.min(p.hand.length, 7) }).map(() => cardBackHtml()).join('') +
                    (p.hand.length > 7 ? `<span class="opponent__count">+${p.hand.length - 6}</span>` : '');
              return `
                <div class="opponent ${isTurn ? 'opponent--turn' : ''} ${isTarget ? 'opponent--target' : ''}">
                  <div class="opponent__hand ${pickable ? 'opponent__hand--pickable' : ''}">${handHtml}</div>
                  <p class="opponent__name">${p.name}${p.hand.length === 0 ? ' — sorti·e' : ` · ${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`}</p>
                </div>`;
            })
            .join('')}
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${isMyTurn ? `Touche une carte chez ${targetName}` : `Tour de ${currentPlayerName}`}
        </div>
      </div>

      <div class="my-hand">
        <p class="my-hand__label">Ta main (${me.hand.length}) <small>— glisse pour réordonner</small></p>
        <div class="my-hand__cards">
          ${orderedHand.map(cardFaceHtml).join('') || '<p class="my-hand__empty">Tu es sorti·e, bravo !</p>'}
        </div>
      </div>

      <details class="log">
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>

      <button class="btn btn--link" id="btn-abandon">Abandonner la partie</button>
    </div>
  `;

  container.querySelector('#btn-abandon')?.addEventListener('click', () => {
    if (window.confirm("Abandonner la partie en cours et revenir en salle d'attente ? (utile si quelqu'un a quitté sans prévenir)")) {
      playAgain(room).catch((err) => alert(err.message || "Impossible d'abandonner la partie."));
    }
  });

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    enableHandDrag(myHandEl, {
      onDrop: (cardId, index) => {
        moveCard('pouilleux', cardId, index);
        renderTableNow(container, { room, player, state });
      }
    });
  }

  if (isMyTurn) {
    container.querySelectorAll('.opponent-card--pickable').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cardIndex = Number(btn.dataset.pickIndex);
        container.querySelectorAll('.opponent-card--pickable').forEach((b) => (b.disabled = true));
        try {
          await drawForCurrentPlayer(room, player.id, cardIndex);
        } catch (err) {
          // Un conflit ou une action hors-tour se résorbe via la resynchro realtime.
          container.querySelectorAll('.opponent-card--pickable').forEach((b) => (b.disabled = false));
        }
      });
    });
  }
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

// Sélection en cours pendant la phase d'échange (distincte de la sélection de
// jeu ci-dessus, remise à zéro dès que ce n'est plus à cette personne de choisir).
let exchangeSelectedCardIds = new Set();

/**
 * Écran de la phase d'échange : chacun ne voit que ce qui concerne SA propre
 * main. Le Président et le Vice-Président choisissent quoi rendre ; le Trou du
 * Cul et le Secrétaire attendent, sans connaître les cartes précises en jeu
 * chez le binôme adverse.
 */
function renderTrouducExchange(container, { room, player, state }) {
  const ex = state.exchange;
  const me = state.players.find((p) => p.id === player.id);

  const isPresident = player.id === ex.presidentId;
  const isVicePresident = player.id === ex.vicePresidentId;
  const isTrouDuCul = player.id === ex.trouDuCulId;

  const needsToChoose = (isPresident && !ex.presidentGiven) || (isVicePresident && !ex.vicePresidentGiven);
  const requiredCount = isPresident ? ex.presidentGiftCount : isVicePresident ? ex.vicePresidentGiftCount : 0;

  if (!needsToChoose) exchangeSelectedCardIds = new Set();

  let statusMessage;
  if (needsToChoose) {
    const recipientName = isPresident
      ? state.players.find((p) => p.id === ex.trouDuCulId)?.name
      : state.players.find((p) => p.id === ex.secretaireId)?.name;
    statusMessage = `Choisis ${requiredCount} carte${requiredCount > 1 ? 's' : ''} à donner à ${recipientName}.`;
  } else if (isPresident || isVicePresident) {
    statusMessage = "Choix envoyé — en attente de l'autre binôme…";
  } else if (isTrouDuCul) {
    statusMessage = `Tu as donné tes 2 meilleures cartes à ${state.players.find((p) => p.id === ex.presidentId)?.name}. Il/elle va t'en redonner 2 en retour.`;
  } else {
    statusMessage = `Tu as donné ta meilleure carte à ${state.players.find((p) => p.id === ex.vicePresidentId)?.name}. Il/elle va t'en redonner une en retour.`;
  }

  const selectedCount = [...exchangeSelectedCardIds].filter((id) => me.hand.some((c) => c.id === id)).length;

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Nouvelle manche</p>
        <h1 class="exchange-title">Échange de cartes</h1>
        <p class="exchange-status">${statusMessage}</p>
        ${
          needsToChoose
            ? `<button id="btn-give" class="btn btn--primary" ${selectedCount === requiredCount ? '' : 'disabled'}>
                 Donner (${selectedCount}/${requiredCount})
               </button>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length})</p>
        <div class="my-hand__cards">
          ${me.hand
            .map(
              (c) =>
                `<div class="hand-card ${exchangeSelectedCardIds.has(c.id) ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${cardFaceHtml(c)}</div>`
            )
            .join('')}
        </div>
      </div>
    </div>
  `;

  if (needsToChoose) {
    container.querySelectorAll('.hand-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.cardId;
        if (exchangeSelectedCardIds.has(id)) {
          exchangeSelectedCardIds.delete(id);
        } else if (exchangeSelectedCardIds.size < requiredCount) {
          exchangeSelectedCardIds.add(id);
        }
        renderTrouducExchange(container, { room, player, state });
      });
    });

    container.querySelector('#btn-give')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await submitExchangeGift(room, player.id, [...exchangeSelectedCardIds]);
        exchangeSelectedCardIds = new Set();
      } catch (err) {
        e.target.disabled = false;
        alert(err.message || 'Impossible de donner ces cartes.');
      }
    });
  }
}

// Id du dernier coup déjà célébré (accession au poste de Président), pour ne
// pas répéter l'effet à chaque re-rendu.
let lastCelebratedMoveId = null;

function renderTrouducTable(container, { room, player, state }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = state.players.filter((p) => p.id !== player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) selectedCardIds = new Set();

  const selectedCards = me.hand.filter((c) => selectedCardIds.has(c.id));
  const selectedRank = selectedCards[0]?.rank;
  const beatsOrMatchesPile = state.rankLocked
    ? trouducRankValue(selectedRank) === trouducRankValue(state.pileRank)
    : trouducRankValue(selectedRank) >= trouducRankValue(state.pileRank);
  const selectionValid =
    isMyTurn &&
    selectedCards.length > 0 &&
    selectedCards.every((c) => c.rank === selectedRank) &&
    (state.pileCount === 0 ? true : selectedCards.length === state.pileCount && beatsOrMatchesPile);
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
                 <p class="pile__label">${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒 verrouillé</span>' : ''}</p>`
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
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length}) <small>— glisse pour réordonner</small></p>
        <div class="my-hand__cards">
          ${
            getOrderedHand('trouduc', me.hand)
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

      <button class="btn btn--link" id="btn-abandon">Abandonner la partie</button>
    </div>
  `;

  container.querySelector('#btn-abandon')?.addEventListener('click', () => {
    if (window.confirm("Abandonner la partie en cours et revenir en salle d'attente ? (utile si quelqu'un a quitté sans prévenir)")) {
      playAgain(room).catch((err) => alert(err.message || "Impossible d'abandonner la partie."));
    }
  });

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    enableHandDrag(myHandEl, {
      onTap: isMyTurn
        ? (cardId) => {
            if (selectedCardIds.has(cardId)) selectedCardIds.delete(cardId);
            else selectedCardIds.add(cardId);
            renderTrouducTable(container, { room, player, state });
          }
        : undefined,
      onDrop: (cardId, index) => {
        moveCard('trouduc', cardId, index);
        renderTrouducTable(container, { room, player, state });
      }
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

  const move = state.lastMove;
  const justBecamePresident = move && move.finished && state.finishedOrder[0] === move.by && move.id !== lastCelebratedMoveId;
  if (justBecamePresident) {
    lastCelebratedMoveId = move.id;
    const presidentName = state.players.find((p) => p.id === move.by)?.name || '?';
    const celebration = document.createElement('div');
    celebration.className = 'draw-reveal draw-reveal--safe draw-reveal--brief';
    celebration.innerHTML = `<p class="draw-reveal__extra draw-reveal__extra--big">🎉 ${presidentName} est Président !</p>`;
    container.querySelector('.table-felt')?.appendChild(celebration);
    vibrate([100, 60, 200]);
    window.setTimeout(() => celebration.remove(), 1600);
  }
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
