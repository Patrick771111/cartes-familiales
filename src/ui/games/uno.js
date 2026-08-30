import { cardBackHtml } from '../cards.js';
import { playUnoCard, drawUnoCard, callUno, catchUno, isLegalCard, isJumpInCard, hasLegalMove, colorInfo, COLORS } from '../../game/uno.js';
import { getOrderedHand, moveCard, resetHandOrder } from '../handOrder.js';
import { enableHandDrag, applyDynamicHandOverlap } from '../dragReorder.js';
import { openRulesModal } from '../rules.js';
import { unoCardImage } from '../unoCardArt.js';
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
import { is3DEnabled } from '../settings.js';
import { mountTable, positionTable, updateTable, showTable, hideTable, getHandCardRects, getDrawPileRect } from '../../three/unoScene.js';

// Carte Joker/Joker +4 en attente du choix de couleur (clic sur la pastille
// pour valider, ou Annuler) — distincte de toute autre sélection, remise à
// zéro dès que ce n'est plus mon tour.
let pendingWildCardId = null;

// Signature (room.id:room.version) de la dernière annonce "UNO !" déjà
// affichée en grand — évite de rejouer l'animation à chaque re-rendu local
// (ex: ouverture du sélecteur de couleur) qui ne change pas la version.
let lastUnoAnnounceSignature = null;

const KIND_ORDER = { number: 0, skip: 1, reverse: 2, drawTwo: 3, wild: 4, wildDrawFour: 5 };
const COLOR_ORDER = { red: 0, yellow: 1, green: 2, blue: 3 };

/** Ordre par défaut d'une main Uno : couleur, puis type de carte, puis valeur — les Jokers (sans couleur) en dernier. */
function sortedUnoHand(hand) {
  return hand.slice().sort((a, b) => {
    const colorA = a.color ? COLOR_ORDER[a.color] : 99;
    const colorB = b.color ? COLOR_ORDER[b.color] : 99;
    if (colorA !== colorB) return colorA - colorB;
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return (a.value ?? 0) - (b.value ?? 0);
  });
}

export function unoCardHtml(card) {
  const colorClass = card.color ? `uno-card--${card.color}` : 'uno-card--wild';
  const image = unoCardImage(card);
  if (image) {
    return `<div class="uno-card ${colorClass} uno-card--illustrated" data-card-id="${card.id}" style="background-image:url('${image}')"></div>`;
  }
  if (card.kind === 'wild' || card.kind === 'wildDrawFour') {
    const label = card.kind === 'wildDrawFour' ? '+4' : '🌈';
    return `<div class="uno-card uno-card--wild" data-card-id="${card.id}">${label}</div>`;
  }
  const label = card.kind === 'number' ? card.value : card.kind === 'skip' ? '⊘' : card.kind === 'reverse' ? '⇄' : '+2';
  return `<div class="uno-card ${colorClass}" data-card-id="${card.id}">${label}</div>`;
}

/** Réinitialise l'état local propre à ce jeu — appelé au retour en salle d'attente. */
export function resetSelection() {
  pendingWildCardId = null;
  lastUnoAnnounceSignature = null;
  resetHandOrder('uno');
}

// Hook générique lu par src/ui/game.js (hideAllThreeDScenes) — c'est CE
// fichier qui "s'inscrit" à la 3D, les fichiers communs n'ont besoin de
// connaître aucun jeu en particulier pour savoir masquer sa scène au bon moment.
export function hide3D() {
  hideTable();
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (state.status === 'finished') {
    renderUnoEnd(container, { room, player, state, onLeave });
    return;
  }
  if (is3DEnabled('uno')) renderUnoTable3D(container, { room, player, state, onLeave });
  else renderUnoTable2D(container, { room, player, state, onLeave });
}

function renderUnoTable2D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) pendingWildCardId = null;

  const topCard = state.discard[state.discard.length - 1];
  const isWildTop = topCard.kind === 'wild' || topCard.kind === 'wildDrawFour';
  const underAttack = state.pendingDraw > 0;
  const myLegalMove = isMyTurn && hasLegalMove(state, me.hand);
  // Piocher reste le choix du joueur, même avec un coup jouable en main.
  const canDraw = isMyTurn && !pendingWildCardId;

  // Annonce "UNO !" voyante pour tout le monde, une seule fois par version
  // (une nouvelle pose/pioche s'affiche autrement en silence) — l'annonce à
  // tort (pénalité) n'a volontairement pas droit à cet effet.
  const lastLog = state.log[state.log.length - 1];
  const unoAnnounceSignature = `${room.id}:${room.version}`;
  const showUnoAnnouncement =
    !!lastLog && / annonce UNO !$/.test(lastLog.message) && lastUnoAnnounceSignature !== unoAnnounceSignature;
  if (showUnoAnnouncement) lastUnoAnnounceSignature = unoAnnounceSignature;

  // Empile les dernières poses (fenêtre glissante côté state — voir uno.js)
  // les unes sur les autres, décalées vers qui les a posées, comme au Trou du
  // Cul / 8 américain.
  const discardHistory = state.discardHistory && state.discardHistory.length ? state.discardHistory : [{ by: null, cards: [topCard] }];
  const seatShiftFor = (playerId) => {
    if (!playerId) return { x: 0, y: 0 };
    if (playerId === player.id) return { x: 0, y: 26 };
    const seatIndex = others.findIndex((p) => p.id === playerId);
    if (seatIndex === -1) return { x: 0, y: -22 };
    const mid = (others.length - 1) / 2;
    return { x: Math.round((seatIndex - mid) * 16), y: -22 };
  };

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const status = `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}`;
      const handHtml =
        Array.from({ length: Math.min(p.hand.length, 6) }).map(() => cardBackHtml()).join('') +
        (p.hand.length > 6 ? `<span class="opponent__count">+${p.hand.length - 5}</span>` : '');
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <div class="opponent__hand">${handHtml}</div>
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${status}</p>
          <button type="button" class="uno-catch-btn" data-catch-target="${p.id}">Contre-UNO</button>
        </div>`;
    })
    .join('');

  const orderedHand = getOrderedHand('uno', me.hand, sortedUnoHand);

  container.innerHTML = `
    <div class="screen screen--table uno-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt uno-felt">
        <div class="uno-center">
          <div class="trouduc-pile trouduc-pile--active">
            <div class="trouduc-pile__stack">
              ${discardHistory
                .map((entry, i) => {
                  const shift = seatShiftFor(entry.by);
                  const stackOffset = i * 4;
                  const isTopmost = i === discardHistory.length - 1;
                  return `<div class="trouduc-pile__shift" style="transform: translate(${shift.x + stackOffset}px, ${shift.y + stackOffset}px); z-index: ${i}">
                            <div class="trouduc-pile__cards ${isTopmost ? 'uno-discard-top' : ''}">
                              ${entry.cards.map(unoCardHtml).join('')}
                              ${isTopmost && isWildTop ? `<span class="uno-active-color" style="background:${colorInfo(state.activeColor).hex}" title="${colorInfo(state.activeColor).label}"></span>` : ''}
                            </div>
                          </div>`;
                })
                .join('')}
            </div>
          </div>
          <button type="button" class="americain-stock ${canDraw ? 'americain-stock--pickable' : ''}" id="btn-draw" ${canDraw ? '' : 'disabled'}>
            ${cardBackHtml()}
            <span class="americain-stock__count">${state.stock.length}</span>
          </button>
        </div>

        ${showUnoAnnouncement ? `<div class="uno-announcement">🃏 ${lastLog.message}</div>` : ''}

        ${underAttack ? `<p class="uno-pending-draw">⚡ Pile de pioche : +${state.pendingDraw}</p>` : ''}

        ${
          isMyTurn && underAttack
            ? `<div class="turn-banner turn-banner--you">${myLegalMove ? 'Empile une carte +2/+4, ou pioche la pile' : `Pioche la pile (+${state.pendingDraw})`}</div>`
            : !isMyTurn
              ? `<div class="turn-banner">Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}</div>`
              : ''
        }
        <p class="americain-direction">${state.direction === -1 ? '↺ Sens inversé' : '↻ Sens normal'}</p>

        ${
          pendingWildCardId
            ? `<div class="americain-suit-picker">
                 <p class="americain-suit-picker__label">Choisis la couleur :</p>
                 <div class="americain-suit-picker__options">
                   ${COLORS.map((key) => `<button type="button" class="uno-color-picker__option" data-color="${key}" style="background:${colorInfo(key).hex}" title="${colorInfo(key).label}"></button>`).join('')}
                 </div>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-wild">Annuler</button>
               </div>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label">
          Ta main (${me.hand.length}) <small>— glisse pour réordonner</small>
          <button type="button" class="uno-call-btn" id="btn-call-uno">UNO !</button>
        </p>
        <div class="my-hand__cards uno-hand">
          ${orderedHand
            .map((c) => {
              const legalForTurn = isMyTurn && isLegalCard(state, c);
              // Interruption : jouable hors tour si strictement identique au sommet
              // de la défausse (voir isJumpInCard) — visible uniquement sur ses
              // propres cartes, aucune fuite d'info sur la main d'autrui.
              const jumpInEligible = !isMyTurn && isJumpInCard(state, c);
              const playable = legalForTurn || jumpInEligible;
              return `<div class="hand-card ${playable ? '' : 'hand-card--unplayable'} ${jumpInEligible ? 'hand-card--jumpin' : ''} ${pendingWildCardId === c.id ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${unoCardHtml(c)}</div>`;
            })
            .join('') || '<p class="my-hand__empty">Tu as fini, bravo ! Suis la suite de la partie ci-dessus.</p>'}
        </div>

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
        ${threeDToggleHtml('uno')}
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'uno', () => renderTable(container, { room, player, state, onLeave }));

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawUnoCard(room, player.id);
    } catch (err) {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-cancel-wild')?.addEventListener('click', () => {
    pendingWildCardId = null;
    renderUnoTable2D(container, { room, player, state, onLeave });
  });

  container.querySelector('#btn-call-uno')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await callUno(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de signaler UNO.');
    }
  });

  container.querySelectorAll('[data-catch-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await catchUno(room, player.id, btn.dataset.catchTarget);
      } catch (err) {
        // Contre-UNO inutile (fenêtre pas ouverte pour ce joueur) : refusé
        // sans conséquence — pas de popup, on laisse le joueur retenter.
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('.uno-color-picker__option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.color;
      const cardId = pendingWildCardId;
      container.querySelectorAll('.uno-color-picker__option').forEach((b) => (b.disabled = true));
      try {
        await playUnoCard(room, player.id, cardId, color);
        pendingWildCardId = null;
      } catch (err) {
        container.querySelectorAll('.uno-color-picker__option').forEach((b) => (b.disabled = false));
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  // Pas de garde sur isMyTurn ici : une carte reste sélectionnable dans le
  // DOM hors tour uniquement si elle est éligible à l'interruption (voir le
  // calcul de `playable` ci-dessus) — les Jokers en sont exclus, donc la
  // branche pendingWildCardId ci-dessous n'est jamais atteinte hors tour.
  container.querySelectorAll('.my-hand .hand-card:not(.hand-card--unplayable)').forEach((el) => {
    el.addEventListener('click', async () => {
      const id = el.dataset.cardId;
      const card = me.hand.find((c) => c.id === id);
      if (card.kind === 'wild' || card.kind === 'wildDrawFour') {
        pendingWildCardId = id;
        renderUnoTable2D(container, { room, player, state, onLeave });
        return;
      }
      try {
        await playUnoCard(room, player.id, id);
      } catch (err) {
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  const myHandEl = container.querySelector('.my-hand__cards');
  if (myHandEl) {
    applyDynamicHandOverlap(myHandEl);
    enableHandDrag(myHandEl, {
      onDrop: (cardId, index) => {
        moveCard('uno', cardId, index);
        renderUnoTable2D(container, { room, player, state, onLeave });
      }
    });
  }
}

/**
 * Rendu 3D : une seule scène de table (voir src/three/unoScene.js) au lieu
 * des zones 2D séparées (adversaires/feutre/main) — pioche et défausse "en
 * vrac" au centre, adversaires en petits éventails dos visible "au loin",
 * ma main en grand éventail face visible en bas. Le sélecteur de couleur
 * Joker et les boutons Contre-UNO restent de vrais overlays DOM 2D (pas
 * utile de les sortir en 3D pour cette première tranche).
 */
function renderUnoTable3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  if (!isMyTurn) pendingWildCardId = null;

  const topCard = state.discard[state.discard.length - 1];
  const underAttack = state.pendingDraw > 0;
  const myLegalMove = isMyTurn && hasLegalMove(state, me.hand);
  const canDraw = isMyTurn && !pendingWildCardId;
  const currentPlayerName = state.players.find((p) => p.id === state.currentPlayerId)?.name || '';

  const orderedHand = getOrderedHand('uno', me.hand, sortedUnoHand);
  const discardHistory = state.discardHistory && state.discardHistory.length ? state.discardHistory : [{ by: null, cards: [topCard] }];
  const discardCards = discardHistory.flatMap((entry) => entry.cards).slice(-4);

  container.innerHTML = `
    <div class="screen screen--table uno-screen uno-screen--3d">
      <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
        ${
          isMyTurn
            ? underAttack
              ? myLegalMove
                ? 'Empile une carte +2/+4, ou pioche la pile'
                : `Pioche la pile (+${state.pendingDraw})`
              : 'À toi de jouer'
            : `Tour de ${currentPlayerName}`
        }
      </div>
      <p class="americain-direction">${state.direction === -1 ? '↺ Sens inversé' : '↻ Sens normal'}${underAttack ? ` · ⚡ Pile de pioche : +${state.pendingDraw}` : ''}</p>

      <div class="uno-3d-table">
        <span class="uno-3d-draw-count">${state.stock.length}</span>
      </div>

      ${
        pendingWildCardId
          ? `<div class="americain-suit-picker">
               <p class="americain-suit-picker__label">Choisis la couleur :</p>
               <div class="americain-suit-picker__options">
                 ${COLORS.map((key) => `<button type="button" class="uno-color-picker__option" data-color="${key}" style="background:${colorInfo(key).hex}" title="${colorInfo(key).label}"></button>`).join('')}
               </div>
               <button type="button" class="btn btn--link btn--small" id="btn-cancel-wild">Annuler</button>
             </div>`
          : ''
      }

      ${others.length ? `<div class="uno-3d-catch-row">${others.map((p) => `<button type="button" class="uno-catch-btn" data-catch-target="${p.id}">Contre-UNO ${p.name}</button>`).join('')}</div>` : ''}

      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
      ${threeDToggleHtml('uno')}
      <button class="game-hud__bubble game-hud__bubble--uno" id="btn-call-uno" title="Annoncer UNO" aria-label="Annoncer UNO">UNO!</button>
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  mountTable();
  const tableEl = container.querySelector('.uno-3d-table');
  if (tableEl) positionTable(tableEl.getBoundingClientRect());
  updateTable({
    hand: orderedHand,
    handPlayable: orderedHand.map((c) => (isMyTurn && isLegalCard(state, c)) || (!isMyTurn && isJumpInCard(state, c))),
    opponents: others.map((p) => ({ count: p.hand.length })),
    discardCards
  });
  showTable();

  // Boutons invisibles superposés aux VRAIES positions des cartes dessinées
  // en 3D (éventail, pas un simple alignement) — même technique que
  // .target-card--pickable au Pouilleux (voir getHandCardRects).
  if (tableEl) {
    const handButtonsHtml = orderedHand.map((c) => `<button type="button" class="card uno-3d-hand-card" data-card-id="${c.id}"></button>`).join('');
    const drawRect = getDrawPileRect();
    const drawButtonHtml = drawRect ? `<button type="button" class="uno-3d-draw" id="btn-draw" ${canDraw ? '' : 'disabled'}></button>` : '';
    tableEl.insertAdjacentHTML('beforeend', handButtonsHtml + drawButtonHtml);

    getHandCardRects().forEach((r, i) => {
      const btn = tableEl.querySelectorAll('.uno-3d-hand-card')[i];
      if (!btn || !r) return;
      btn.style.left = `${r.left}px`;
      btn.style.top = `${r.top}px`;
      btn.style.width = `${r.width}px`;
      btn.style.height = `${r.height}px`;
    });
    if (drawRect) {
      const drawBtn = tableEl.querySelector('#btn-draw');
      drawBtn.style.left = `${drawRect.left}px`;
      drawBtn.style.top = `${drawRect.top}px`;
      drawBtn.style.width = `${drawRect.width}px`;
      drawBtn.style.height = `${drawRect.height}px`;

      const countEl = tableEl.querySelector('.uno-3d-draw-count');
      if (countEl) {
        countEl.style.left = `${drawRect.left + drawRect.width / 2}px`;
        countEl.style.top = `${drawRect.top + drawRect.height + 4}px`;
      }
    }
  }

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'uno', () => renderTable(container, { room, player, state, onLeave }));

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawUnoCard(room, player.id);
    } catch (err) {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-cancel-wild')?.addEventListener('click', () => {
    pendingWildCardId = null;
    renderUnoTable3D(container, { room, player, state, onLeave });
  });

  container.querySelector('#btn-call-uno')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await callUno(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de signaler UNO.');
    }
  });

  container.querySelectorAll('[data-catch-target]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await catchUno(room, player.id, btn.dataset.catchTarget);
      } catch (err) {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll('.uno-color-picker__option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const color = btn.dataset.color;
      const cardId = pendingWildCardId;
      container.querySelectorAll('.uno-color-picker__option').forEach((b) => (b.disabled = true));
      try {
        await playUnoCard(room, player.id, cardId, color);
        pendingWildCardId = null;
      } catch (err) {
        container.querySelectorAll('.uno-color-picker__option').forEach((b) => (b.disabled = false));
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  container.querySelectorAll('.uno-3d-hand-card').forEach((btn) => {
    const id = btn.dataset.cardId;
    const card = me.hand.find((c) => c.id === id);
    const legalForTurn = isMyTurn && isLegalCard(state, card);
    const jumpInEligible = !isMyTurn && isJumpInCard(state, card);
    if (!legalForTurn && !jumpInEligible) return;
    btn.addEventListener('click', async () => {
      if (card.kind === 'wild' || card.kind === 'wildDrawFour') {
        pendingWildCardId = id;
        renderUnoTable3D(container, { room, player, state, onLeave });
        return;
      }
      try {
        await playUnoCard(room, player.id, id);
      } catch (err) {
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  if (tableEl) {
    enableHandDrag(tableEl, {
      onDrop: (cardId, index) => {
        moveCard('uno', cardId, index);
        renderUnoTable3D(container, { room, player, state, onLeave });
      }
    });
  }
}

function renderUnoEnd(container, { room, player, state, onLeave }) {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const youWon = state.winnerId === player.id;

  container.innerHTML = `
    <div class="screen screen--end">
      <div class="lobby-card lobby-card--end">
        <p class="eyebrow">Partie terminée</p>
        <h1>${youWon ? 'Tu as gagné !' : `${winner?.name || '?'} a gagné !`}${youWon ? ' 🏆' : ''}</h1>
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
