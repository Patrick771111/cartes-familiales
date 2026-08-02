import { cardFaceHtml, cardBackHtml } from './cards.js';
import { AVAILABLE_GAMES, startGame, drawForCurrentPlayer, playCards, passTurn, playAgain, addBot, submitExchangeGift, claimHost, HOST_STALE_MS } from '../game/engine.js';
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
    revealHands = false;
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
  const currentHost = state.players.find((p) => p.id === state.hostId);
  const hostIsBot = currentHost?.isBot === true;
  const hostIsStale = !hostIsBot && Date.now() - (state.hostLastSeen || 0) > HOST_STALE_MS;
  const hostUnavailable = hostIsBot || hostIsStale;

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Table ouverte</h1>
        <p class="lobby-card__intro">
          ${
            hostIsBot
              ? "L'hôte est un bot — quelqu'un doit reprendre la main pour lancer la partie."
              : hostIsStale
                ? "L'hôte semble inactif depuis un moment — tu peux reprendre la main."
                : isHost
                  ? "Attends que les autres arrivent, choisis le jeu, puis lance la partie."
                  : "En attente que l'hôte lance la partie…"
          }
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

        ${hostUnavailable && !isHost ? `<button class="btn btn--ghost btn--small" id="btn-claim-host">Devenir l'hôte</button>` : ''}

        ${
          isHost && state.players.length < 6
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

  container.querySelector('#btn-claim-host')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await claimHost(room, player);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible de devenir l'hôte.");
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
  container.querySelector('.pouilleux-screen')?.appendChild(overlay);

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
  const isMyTurn = state.currentPlayerId === player.id;
  // La cible (chez qui on pioche ce tour-ci) est toujours calculable, pas
  // seulement quand c'est mon tour — ça permet de la mettre en avant même en
  // train de regarder jouer quelqu'un d'autre.
  const targetId = computeTarget(state);
  const targetName = state.players.find((p) => p.id === targetId)?.name || '';
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';
  const orderedHand = getOrderedHand('pouilleux', me.hand, sortedHand);
  const isSafe = me.hand.length === 0;
  const showFaces = isSafe && revealHands;

  const target = state.players.find((p) => p.id === targetId) || null;
  const restOthers = state.players.filter((p) => p.id !== player.id && p.id !== targetId);

  const targetPickable = isMyTurn && target && target.hand.length > 0;
  const targetHandHtml = !target
    ? ''
    : targetPickable
      ? Array.from({ length: target.hand.length })
          .map(
            (_, i) =>
              `<button type="button" class="card card--back target-card--pickable" data-pick-index="${i}"><span class="card__back-pattern"></span></button>`
          )
          .join('')
      : target.hand.length === 0
        ? ''
        : showFaces
          ? target.hand.map(cardFaceHtml).join('')
          : Array.from({ length: target.hand.length }).map(() => cardBackHtml()).join('');

  const restHtml = restOthers
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const status = p.hand.length === 0 ? 'sorti·e' : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
      const handHtml = p.hand.length === 0
        ? ''
        : showFaces
          ? p.hand.map(cardFaceHtml).join('')
          : Array.from({ length: Math.min(p.hand.length, 6) }).map(() => cardBackHtml()).join('') +
            (p.hand.length > 6 ? `<span class="opponent__count">+${p.hand.length - 5}</span>` : '');
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand ${showFaces ? 'opponent__hand--revealed' : ''}">${handHtml}</div>
          <p class="opponent__name">${p.name}${p.hand.length === 0 ? ' — sorti·e' : ` · ${status}`}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table pouilleux-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="pouilleux-zone pouilleux-zone--target">
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${isMyTurn ? `Touche une carte chez ${targetName}` : `Tour de ${currentPlayerName}`}
        </div>
        ${target ? `<p class="pouilleux-target__name">${target.name}${target.hand.length === 0 ? ' — sorti·e' : ` · ${target.hand.length} carte${target.hand.length > 1 ? 's' : ''}`}</p>` : ''}
        <div class="pouilleux-target__hand ${targetPickable ? 'pouilleux-target__hand--pickable' : ''} ${showFaces ? 'opponent__hand--revealed' : ''}">
          ${targetHandHtml}
        </div>
        ${isSafe ? `<button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>` : ''}
      </div>

      <div class="pouilleux-zone pouilleux-zone--mine">
        <div class="my-hand">
          <p class="my-hand__label">Ta main (${me.hand.length}) <small>— glisse pour réordonner</small></p>
          <div class="my-hand__cards">
            ${orderedHand.map(cardFaceHtml).join('') || '<p class="my-hand__empty">Tu es sorti·e, bravo ! Suis la suite de la partie ci-dessus.</p>'}
          </div>
        </div>

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="btn btn--link" id="btn-abandon">Abandonner la partie</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderTableNow(container, { room, player, state });
  });
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
    container.querySelectorAll('.target-card--pickable').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const cardIndex = Number(btn.dataset.pickIndex);
        container.querySelectorAll('.target-card--pickable').forEach((b) => (b.disabled = true));
        try {
          await drawForCurrentPlayer(room, player.id, cardIndex);
        } catch (err) {
          // Un conflit ou une action hors-tour se résorbe via la resynchro realtime.
          container.querySelectorAll('.target-card--pickable').forEach((b) => (b.disabled = false));
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

// Bouton "Afficher les mains" : uniquement proposé à quelqu'un qui ne peut plus
// jouer (à l'abri, fini, ou simple spectateur) — aucun souci d'équité puisqu'il
// ne peut plus agir sur la partie en cours.
let revealHands = false;

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

  const handCountsByRank = new Map();
  for (const c of me.hand) handCountsByRank.set(c.rank, (handCountsByRank.get(c.rank) || 0) + 1);
  const isRankPlayable = (rank) => {
    if (state.pileCount === 0) return true;
    if ((handCountsByRank.get(rank) || 0) < state.pileCount) return false;
    const rv = trouducRankValue(rank);
    const pileRv = trouducRankValue(state.pileRank);
    return state.rankLocked ? rv === pileRv : rv >= pileRv;
  };

  // Regroupe les cartes consécutives de même rang (la main est déjà triée par rang
  // par le serveur), puis répartit les groupes sur deux rangées sans jamais couper
  // un groupe en deux. L'espacement entre groupes est calculé pour que chaque
  // rangée tienne toujours dans la largeur de l'écran, même dans le pire des cas
  // (aucune paire en main : autant de groupes que de cartes).
  const CARD_W = 64;
  const TIGHT_STEP = 26; // largeur visible d'une carte "empilée" dans le même groupe
  // Largeur dispo estimée pour une rangée : s'adapte à l'écran réel (mobile étroit
  // comme desktop plus large), avec une marge de sécurité pour le cadre autour.
  const ROW_WIDTH_BUDGET = Math.min(window.innerWidth - 40, 620);

  const groupHand = (hand) => {
    const groups = [];
    for (const card of hand) {
      const last = groups[groups.length - 1];
      if (last && last[0].rank === card.rank) last.push(card);
      else groups.push([card]);
    }
    return groups;
  };

  const splitIntoRows = (groups, total) => {
    const targetRow1 = Math.ceil(total / 2);
    const rows = [[], []];
    let count = 0;
    let rowIndex = 0;
    for (const group of groups) {
      if (rowIndex === 0 && count >= targetRow1 && count > 0) rowIndex = 1;
      rows[rowIndex].push(group);
      count += group.length;
    }
    return rows;
  };

  const renderRow = (rowGroups) => {
    if (!rowGroups.length) return '';
    const n = rowGroups.reduce((s, g) => s + g.length, 0);
    const nGroupStarts = rowGroups.length - 1; // hors tout premier groupe de la rangée
    const nContinuations = n - rowGroups.length; // cartes qui prolongent un groupe existant
    const remaining = ROW_WIDTH_BUDGET - CARD_W - nContinuations * TIGHT_STEP;
    const lightStep = nGroupStarts > 0 ? Math.max(TIGHT_STEP, Math.min(CARD_W - 4, remaining / nGroupStarts)) : 0;

    let html = '';
    let cardPos = 0;
    rowGroups.forEach((group) => {
      group.forEach((c, iInGroup) => {
        const isFirstInRow = cardPos === 0;
        const isFirstInGroup = iInGroup === 0;
        let marginLeft;
        if (isFirstInRow) marginLeft = 0;
        else if (isFirstInGroup) marginLeft = -(CARD_W - lightStep);
        else marginLeft = -(CARD_W - TIGHT_STEP);
        const playable = !isMyTurn || isRankPlayable(c.rank);
        html += `<div class="hand-card ${selectedCardIds.has(c.id) ? 'hand-card--selected' : ''} ${playable ? '' : 'hand-card--unplayable'}" data-card-id="${c.id}" style="margin-left:${marginLeft}px">${cardFaceHtml(c)}</div>`;
        cardPos++;
      });
    });
    return html;
  };

  const handGroups = groupHand(me.hand);
  const handRows = splitIntoRows(handGroups, me.hand.length);
  const isSafe = me.finished;
  const showFaces = isSafe && revealHands;

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt trouduc-felt">
        <div class="trouduc-opponents">
          ${others
            .map((p, i) => {
              const isTurn = p.id === state.currentPlayerId;
              const isCurrentPileOwner = p.id === state.lastPlayerToPlay && state.pileCount > 0;
              const status = p.finished
                ? trouducRankLabel(p.rank)
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const label = p.role ? `${p.role} · ${status}` : status;
              const ghost = state.lastPlayedByPlayer?.[p.id];
              const showGhost = ghost && !isCurrentPileOwner;
              const previewCount = Math.min(p.hand.length, 5);
              const handPreview = p.finished
                ? ''
                : showFaces
                  ? p.hand.slice(0, previewCount).map(cardFaceHtml).join('') +
                    (p.hand.length > previewCount ? `<span class="opponent__count">+${p.hand.length - previewCount}</span>` : '')
                  : Array.from({ length: previewCount }).map(() => cardBackHtml()).join('');
              return `
                <div class="trouduc-seat trouduc-seat--${i} ${isTurn ? 'trouduc-seat--turn' : ''} ${p.finished ? 'trouduc-seat--finished' : ''}">
                  <p class="trouduc-seat__name">${p.name}</p>
                  <p class="trouduc-seat__status">${label}</p>
                  <div class="trouduc-seat__row">
                    <div class="trouduc-seat__hand ${showFaces ? 'trouduc-seat__hand--revealed' : ''}">${handPreview}</div>
                    <div class="trouduc-seat__ghost ${showGhost ? '' : 'trouduc-seat__ghost--empty'}">
                      ${showGhost ? ghost.cards.map(cardFaceHtml).join('') : ''}
                    </div>
                  </div>
                </div>`;
            })
            .join('')}
        </div>

        <div class="trouduc-center">
          <div class="trouduc-pile ${state.pileCount > 0 ? 'trouduc-pile--active' : ''}">
            ${
              state.pileCount > 0
                ? `<div class="trouduc-pile__cards">${state.pile.map(cardFaceHtml).join('')}</div>
                   <p class="trouduc-pile__label">${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}</p>`
                : `<p class="trouduc-pile__empty">Pli libre — pose ce que tu veux</p>`
            }
          </div>

          <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
            ${isMyTurn ? "C'est ton tour" : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`}
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

          ${isSafe ? `<button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>` : ''}
        </div>
      </div>

      <div class="my-hand trouduc-hand">
        <p class="my-hand__label">${me.role ? `${me.role} · ` : ''}Ta main (${me.hand.length})</p>
        ${
          me.hand.length
            ? `<div class="trouduc-hand-rows">
                 <div class="trouduc-hand-row">${renderRow(handRows[0])}</div>
                 <div class="trouduc-hand-row trouduc-hand-row--2">${renderRow(handRows[1])}</div>
               </div>`
            : '<p class="my-hand__empty">Tu as fini, bravo ! Suis la suite de la partie ci-dessus.</p>'
        }
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

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderTrouducTable(container, { room, player, state });
  });

  if (isMyTurn) {
    container.querySelectorAll('.hand-card:not(.hand-card--unplayable)').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.cardId;
        const card = me.hand.find((c) => c.id === id);
        if (selectedCardIds.has(id)) {
          selectedCardIds.delete(id);
        } else if (state.pileCount > 0 && isRankPlayable(card.rank)) {
          // Le pli en cours impose un nombre de cartes précis (paire, triple, carré) :
          // un seul clic sur une carte du bon rang suffit à sélectionner tout le lot.
          selectedCardIds = new Set(
            me.hand.filter((c) => c.rank === card.rank).slice(0, state.pileCount).map((c) => c.id)
          );
        } else {
          selectedCardIds.add(id);
        }
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

/**
 * Vue lecture seule d'une partie en cours, pour quelqu'un qui n'y participe pas
 * (arrivé après le lancement, ou en attente de la manche suivante). Volontairement
 * simplifiée par rapport à la table "joueur" (pas de main perso à afficher, pas
 * besoin de gérer les cas où le spectateur ne fait pas partie de `state.players`).
 */
export function renderSpectatorGame(container, { room, gameLabel }) {
  const state = room.state;
  const isTrouduc = room.game === 'trouduc';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const pileHtml = isTrouduc
    ? state.pileCount > 0
      ? `<div class="trouduc-pile trouduc-pile--active">
           <div class="trouduc-pile__cards">${state.pile.map(cardFaceHtml).join('')}</div>
           <p class="trouduc-pile__label">${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}</p>
         </div>`
      : `<p class="trouduc-pile__empty">Pli libre</p>`
    : '';

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Tu regardes — ${gameLabel || 'partie'} en cours</p>

        <ul class="spectator-players">
          ${state.players
            .map((p) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = p.finished
                ? isTrouduc
                  ? trouducRankLabel(p.rank)
                  : 'sorti·e'
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const roleLabel = p.role ? `${p.role} · ` : '';
              const handHtml = revealHands && p.hand.length ? `<div class="spectator-player__hand">${p.hand.map(cardFaceHtml).join('')}</div>` : '';
              return `
                <li class="spectator-player ${isTurn ? 'spectator-player--turn' : ''}">
                  <div class="spectator-player__row">
                    <span class="spectator-player__name">${p.name}${p.isBot ? ' 🤖' : ''}</span>
                    <span class="spectator-player__status">${roleLabel}${status}</span>
                  </div>
                  ${handHtml}
                </li>`;
            })
            .join('')}
        </ul>

        <button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>

        ${pileHtml}

        <div class="turn-banner">${currentName ? `Tour de ${currentName}` : 'En attente…'}</div>
      </div>

      <details class="log" open>
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    revealHands = !revealHands;
    renderSpectatorGame(container, { room, gameLabel });
  });
}
