import { cardFaceHtml, cardBackHtml } from '../cards.js';
import { playCards, passTurn, submitExchangeGift } from '../../game/engine.js';
import { rankValue as trouducRankValue, rankLabel as trouducRankLabel } from '../../game/trouduc.js';
import { openRulesModal } from '../rules.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  vibrate,
  getRevealHands,
  toggleRevealHands
} from '../gameShared.js';

// Sélection de cartes en cours pour le joueur local (remise à zéro dès que ce
// n'est plus son tour). Vit en dehors du DOM pour survivre aux re-rendus.
let selectedCardIds = new Set();

// Sélection en cours pendant la phase d'échange (distincte de la sélection de
// jeu ci-dessus, remise à zéro dès que ce n'est plus à cette personne de choisir).
let exchangeSelectedCardIds = new Set();

// Id du dernier coup déjà célébré (accession au poste de Président), pour ne
// pas répéter l'effet à chaque re-rendu.
let lastCelebratedMoveId = null;

// Suivi du dernier pli "effacé visuellement" côté client (voir pileClearedId
// dans trouduc.js) : le pli reste affiché ~1s après avoir brûlé/été ramassé,
// avant que ces variables ne le fassent disparaître à l'écran.
let expiredPileClearedId = null;
let pileClearTimerFor = null;

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  selectedCardIds = new Set();
  exchangeSelectedCardIds = new Set();
  lastCelebratedMoveId = null;
  expiredPileClearedId = null;
  pileClearTimerFor = null;
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (state.status === 'exchange') {
    renderTrouducExchange(container, { room, player, state, onLeave });
    return;
  }
  if (state.status === 'finished') {
    renderTrouducEnd(container, { room, player, state, onLeave });
    return;
  }
  renderTrouducTable(container, { room, player, state, onLeave });
}

/** Classe CSS de fond selon le rôle au Trou du Cul (illustrations). */
function trouducRoleBgClass(role) {
  switch (role) {
    case 'Président':
      return 'trouduc-screen trouduc-role-president';
    case 'Vice-Président':
      return 'trouduc-screen trouduc-role-vice';
    case 'Secrétaire':
      return 'trouduc-screen trouduc-role-secretaire';
    case 'Trou du Cul':
      return 'trouduc-screen trouduc-role-larbin';
    default:
      return 'trouduc-screen trouduc-role-default';
  }
}

/**
 * Écran de la phase d'échange : chacun ne voit que ce qui concerne SA propre
 * main. Le Président et le Vice-Président choisissent quoi rendre ; le Trou du
 * Cul et le Secrétaire attendent, sans connaître les cartes précises en jeu
 * chez le binôme adverse.
 */
function renderTrouducExchange(container, { room, player, state, onLeave }) {
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

  // Les cartes reçues d'office (Trou du Cul → Président, Secrétaire → Vice-
  // Président) sont entourées de doré, pour aider à choisir quoi rendre.
  const receivedIds = isPresident ? ex.receivedByPresident : isVicePresident ? ex.receivedByVicePresident : [];

  container.innerHTML = `
    <div class="screen screen--table ${trouducRoleBgClass(me?.role)}">
      <div class="table-felt trouduc-felt">
        <p class="eyebrow">Nouvelle manche</p>
        <h1 class="exchange-title">Échange de cartes</h1>
        <p class="exchange-status">${statusMessage}</p>
        ${
          needsToChoose
            ? `<p class="exchange-hint">✨ Entourées de doré : les cartes que tu viens de recevoir.</p>
               <button id="btn-give" class="btn btn--primary" ${selectedCount === requiredCount ? '' : 'disabled'}>
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
                `<div class="hand-card ${exchangeSelectedCardIds.has(c.id) ? 'hand-card--selected' : ''} ${receivedIds.includes(c.id) ? 'hand-card--gifted' : ''}" data-card-id="${c.id}">${cardFaceHtml(c)}</div>`
            )
            .join('')}
        </div>

        <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
        <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  if (needsToChoose) {
    container.querySelectorAll('.hand-card').forEach((el, idx) => {
      el.style.zIndex = String(idx + 1);
      let ptr = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        ptr = { id: el.dataset.cardId, x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointerup', (e) => {
        if (!ptr || ptr.id !== el.dataset.cardId) return;
        const dx = Math.abs(e.clientX - ptr.x);
        const dy = Math.abs(e.clientY - ptr.y);
        ptr = null;
        if (dx > 12 || dy > 12) return;
        const id = el.dataset.cardId;
        if (exchangeSelectedCardIds.has(id)) {
          exchangeSelectedCardIds.delete(id);
        } else if (exchangeSelectedCardIds.size < requiredCount) {
          exchangeSelectedCardIds.add(id);
        }
        renderTrouducExchange(container, { room, player, state, onLeave });
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

function renderTrouducTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  // Place les 3 adversaires dans l'ordre du tour à partir de moi (siège gauche
  // = joueur suivant, milieu = celui d'après, droite = celui juste avant moi),
  // pour que le jeu progresse toujours dans le sens des aiguilles d'une montre
  // en partant du bas (moi) vers la gauche, le haut, puis la droite.
  const myTurnIdx = state.turnOrder.indexOf(player.id);
  const others =
    myTurnIdx === -1
      ? state.players.filter((p) => p.id !== player.id)
      : [1, 2, 3].map((step) => state.players.find((p) => p.id === state.turnOrder[(myTurnIdx + step) % state.turnOrder.length]));
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) selectedCardIds = new Set();

  // Décale légèrement chaque pose vers le siège de celui qui l'a posée (gauche,
  // milieu/en face, droite, ou vers toi en bas), pour un rendu plus vivant qu'un
  // pli toujours parfaitement centré — sans jamais s'éloigner beaucoup du centre.
  const seatShiftFor = (playerId) => {
    if (playerId === player.id) return { x: 0, y: 30 };
    const seatIndex = others.findIndex((p) => p.id === playerId);
    if (seatIndex === 0) return { x: -22, y: -10 };
    if (seatIndex === 2) return { x: 22, y: -10 };
    if (seatIndex === 1) return { x: 0, y: -30 };
    return { x: 0, y: 0 };
  };

  // Le pli en cours (historique complet des poses depuis son ouverture) reste
  // affiché, empilé, tant qu'il n'a pas été explicitement "effacé" côté client
  // (voir plus bas) : ça laisse le temps de voir une carte qui vient de brûler
  // le pli, ou le dernier pli avant qu'il soit ramassé, au lieu qu'il disparaisse
  // instantanément dès que le serveur repasse pileCount à 0.
  const pileVisuallyCleared = state.pileCount === 0 && state.pileClearedId && state.pileClearedId === expiredPileClearedId;
  const pileHistoryForDisplay = pileVisuallyCleared ? [] : state.pileHistory || [];

  if (
    state.pileCount === 0 &&
    state.pileClearedId &&
    state.pileClearedId !== expiredPileClearedId &&
    state.pileClearedId !== pileClearTimerFor
  ) {
    pileClearTimerFor = state.pileClearedId;
    const idToExpire = state.pileClearedId;
    window.setTimeout(() => {
      expiredPileClearedId = idToExpire;
      pileClearTimerFor = null;
      renderTrouducTable(container, { room, player, state, onLeave });
    }, 1000);
  }

  // Pendant le tout premier pli de la manche, entoure de doré les cartes que
  // le Trou du Cul / le Secrétaire viennent de recevoir en retour d'échange.
  const giftedCardIds = state.firstTrickPending ? state.returnGiftIds?.[player.id] || [] : [];

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
        const gifted = giftedCardIds.includes(c.id);
        html += `<div class="hand-card ${selectedCardIds.has(c.id) ? 'hand-card--selected' : ''} ${playable ? '' : 'hand-card--unplayable'} ${gifted ? 'hand-card--gifted' : ''}" data-card-id="${c.id}" style="margin-left:${marginLeft}px">${cardFaceHtml(c)}</div>`;
        cardPos++;
      });
    });
    return html;
  };

  const handGroups = groupHand(me.hand);
  const handRows = splitIntoRows(handGroups, me.hand.length);
  const isSafe = me.finished;
  const revealHands = getRevealHands();
  const showFaces = isSafe && revealHands;

  container.innerHTML = `
    <div class="screen screen--table ${trouducRoleBgClass(me?.role)}">
      <div class="table-felt trouduc-felt">
        <div class="trouduc-opponents">
          ${others
            .map((p, i) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = p.finished
                ? trouducRankLabel(p.rank)
                : `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
              const label = p.role ? `${p.role} · ${status}` : status;
              const previewCount = Math.min(p.hand.length, 5);
              const handPreview = p.finished
                ? ''
                : showFaces
                  ? p.hand.slice(0, previewCount).map(cardFaceHtml).join('') +
                    (p.hand.length > previewCount ? `<span class="opponent__count">+${p.hand.length - previewCount}</span>` : '')
                  : Array.from({ length: previewCount }).map(() => cardBackHtml()).join('');
              return `
                <div class="trouduc-seat trouduc-seat--${i} ${isTurn ? 'trouduc-seat--turn' : ''} ${p.finished ? 'trouduc-seat--finished' : ''}">
                  <p class="trouduc-seat__name">${p.name}${connectionBadge(state, p.id)}</p>
                  <p class="trouduc-seat__status">${label}</p>
                  <div class="trouduc-seat__row">
                    <div class="trouduc-seat__hand ${showFaces ? 'trouduc-seat__hand--revealed' : ''}">${handPreview}</div>
                  </div>
                </div>`;
            })
            .join('')}
        </div>

        <div class="trouduc-center">
          <div class="trouduc-pile ${pileHistoryForDisplay.length ? 'trouduc-pile--active' : ''}">
            ${
              pileHistoryForDisplay.length
                ? `<div class="trouduc-pile__stack">
                     ${pileHistoryForDisplay
                       .map((entry, i) => {
                         const shift = seatShiftFor(entry.by);
                         const stackOffset = i * 4;
                         return `<div class="trouduc-pile__shift" style="transform: translate(${shift.x + stackOffset}px, ${shift.y + stackOffset}px); z-index: ${i}">
                                    <div class="trouduc-pile__cards">${entry.cards.map(cardFaceHtml).join('')}</div>
                                  </div>`;
                       })
                       .join('')}
                   </div>
                   <p class="trouduc-pile__label">
                     ${
                       state.pileCount > 0
                         ? `${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}`
                         : 'Pli terminé'
                     }
                   </p>`
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
        ${giftedCardIds.length ? `<p class="exchange-hint">✨ Entourées de doré : les cartes reçues en retour d'échange.</p>` : ''}
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

      <button class="btn btn--link" id="btn-rules">❓ Règles du jeu</button>
      <button class="btn btn--link" id="btn-abandon">${abandonButtonLabel(state, player)}</button>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  container.querySelector('#btn-toggle-reveal')?.addEventListener('click', () => {
    toggleRevealHands();
    renderTrouducTable(container, { room, player, state, onLeave });
  });

  if (isMyTurn) {
    // Sélection fiable souris + tactile (pointerup), pas seulement `click`.
    container.querySelectorAll('.hand-card:not(.hand-card--unplayable)').forEach((el, idx) => {
      el.style.zIndex = String(idx + 1);
      let ptr = null;
      const selectCard = (id) => {
        const card = me.hand.find((c) => c.id === id);
        if (!card) return;
        if (selectedCardIds.has(id)) {
          selectedCardIds.delete(id);
        } else if (state.pileCount > 0 && isRankPlayable(card.rank)) {
          selectedCardIds = new Set(
            me.hand.filter((c) => c.rank === card.rank).slice(0, state.pileCount).map((c) => c.id)
          );
        } else {
          if ([...selectedCardIds].some((sid) => me.hand.find((c) => c.id === sid)?.rank !== card.rank)) {
            selectedCardIds = new Set([id]);
          } else {
            selectedCardIds.add(id);
          }
        }
        renderTrouducTable(container, { room, player, state, onLeave });
      };
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        ptr = { id: el.dataset.cardId, x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointerup', (e) => {
        if (!ptr || ptr.id !== el.dataset.cardId) return;
        const dx = Math.abs(e.clientX - ptr.x);
        const dy = Math.abs(e.clientY - ptr.y);
        ptr = null;
        if (dx > 12 || dy > 12) return;
        e.preventDefault();
        selectCard(el.dataset.cardId);
      });
      el.addEventListener('click', (e) => { e.preventDefault(); });
    });
  }

  container.querySelector('#btn-play')?.addEventListener('click', async (e) => {
    vibrate(30);
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
    <div class="screen screen--end ${trouducRoleBgClass(me?.role)}">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <h1>${trouducRankLabel(me?.rank)}${me?.rank === 1 ? ' 🏆' : ''}</h1>
        <ol class="rank-list">
          ${ranked
            .map((p) => `<li>${trouducRankLabel(p.rank)} — ${p.name}${p.id === player.id ? ' (toi)' : ''}</li>`)
            .join('')}
        </ol>
        ${endGameActionsHtml()}
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });
}
