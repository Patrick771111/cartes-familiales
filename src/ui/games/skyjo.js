import {
  drawSkyjoFromDeck,
  drawSkyjoFromDiscard,
  placeSkyjoCard,
  discardSkyjoAndReveal,
  TARGET_SCORE as SKYJO_TARGET_SCORE
} from '../../game/skyjo.js';
import { flipButtonImage } from '../cardThemes.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled, is3DEnabled } from '../settings.js';
import { openRulesModal } from '../rules.js';
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
  getCardRects,
  getSeatHitRects,
  getRowLabelAnchors,
  orbitCameraByScreenDelta,
  zoomCameraByFactor,
  resetOrbit,
  setOverlaySync,
  setFocusedSeat,
  getFocusedSeat,
  skyjoFaceUrl
} from '../../three/skyjoScene.js';

// Une carte piochée du sabot peut être posée (1 touche/glisser) ou défaussée
// en retournant une case cachée à la place (2 touches rapprochées sur cette
// case) — ce petit état suit la dernière case touchée pour distinguer les
// deux, sans délai ajouté sur les cases où l'ambiguïté n'existe pas (déjà
// face visible, ou carte piochée de la défausse — jamais défaussable) : un
// bouton Flip dédié, à côté de la carte piochée, sert de seconde "source" au
// glisser-déposer/tap-puis-tap à côté de la carte elle-même — voir
// renderSkyjoTable. `null` = aucune action armée (le tap sur une case pose
// directement, comme avant) ; `'flip'` = armé après un tap sur le bouton
// Flip, en attente d'une case cachée à toucher.
let skyjoPendingMode = null;

function applySkyjoFocus(players) {
  if (getFocusedSeat() >= players.length) setFocusedSeat(0);
  const focusIdx = getFocusedSeat();
  return { home: 0, focusIdx, inspecting: focusIdx !== 0 };
}

function returnSkyjoHome() {
  setFocusedSeat(0);
}

function inspectSkyjoSeat(index) {
  setFocusedSeat(index);
}

export function resetSelection() {
  skyjoPendingMode = null;
  hideTable();
  resetOrbit();
}

export function hide3D() {
  hideTable();
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (is3DEnabled('skyjo')) renderSkyjoTable3D(container, { room, player, state, onLeave });
  else {
    hideTable();
    renderSkyjoTable(container, { room, player, state, onLeave });
  }
}

function skyjoValueClass(v) {
  if (v <= -1) return 'skyjo-cell--neg';
  if (v === 0) return 'skyjo-cell--zero';
  if (v <= 4) return 'skyjo-cell--low';
  if (v <= 8) return 'skyjo-cell--mid';
  return 'skyjo-cell--high';
}

// `enableDrop`, uniquement pour sa propre grille : marque chaque case non
// vide comme zone de dépôt (`data-dropzone="skyjo-cell"`) pour le
// glisser-déposer de la carte piochée ou du bouton Flip (voir plus bas).
// `flipTargetFor` (idem, uniquement sa propre grille) surligne les cases
// cachées valides comme cible pendant que le mode Flip est armé.
export function skyjoGridHtml(grid, clickableClassFor, enableDrop, flipTargetFor) {
  return `<div class="skyjo-grid">
    ${grid
      .map((cell, i) => {
        let classes = 'skyjo-cell';
        let content = '';
        if (!cell) {
          classes += ' skyjo-cell--empty';
        } else if (!cell.faceUp) {
          classes += ' skyjo-cell--facedown';
        } else {
          classes += ` skyjo-cell--faceup ${skyjoValueClass(cell.card.value)}`;
          content = cell.card.value;
        }
        if (clickableClassFor) classes += ` ${clickableClassFor(cell, i) || ''}`;
        if (flipTargetFor?.(cell, i)) classes += ' skyjo-cell--flip-target';
        const dropAttrs = enableDrop && cell ? 'data-dropzone="skyjo-cell"' : '';
        return `<div class="${classes}" data-index="${i}" ${dropAttrs}>${content}</div>`;
      })
      .join('')}
  </div>`;
}

// Somme des cases déjà retournées d'une grille (0 pour les cases cachées ou
// effacées) : donne un aperçu du score de manche en cours, avant que la
// grille ne soit entièrement révélée.
function skyjoVisibleSum(grid) {
  return grid.reduce((sum, cell) => sum + (cell && cell.faceUp ? cell.card.value : 0), 0);
}

function renderSkyjoTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  if (!isMyTurn || !state.drawnCard) skyjoPendingMode = null;

  const canDraw = isMyTurn && !state.drawnCard && !finished;
  const canAct = isMyTurn && !!state.drawnCard && !finished;
  const topDiscard = state.discard[state.discard.length - 1];

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const roundLabel = finished ? ` · ${p.roundScore ?? 0} pt${(p.roundScore ?? 0) > 1 ? 's' : ''} cette manche` : '';
      const visibleSum = skyjoVisibleSum(p.grid);
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <p class="skyjo-visible-sum">${visibleSum} pt${visibleSum > 1 ? 's' : ''} visible${visibleSum > 1 ? 's' : ''}</p>
          ${skyjoGridHtml(p.grid)}
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}${roundLabel}</p>
        </div>`;
    })
    .join('');

  const myClickableClassFor = (cell, i) => (canAct && cell ? 'skyjo-cell--placeable' : '');
  const canFlip = canAct && state.drawnCard.source === 'deck';
  const myFlipTargetFor = (cell) => Boolean(canFlip && skyjoPendingMode === 'flip' && cell && !cell.faceUp);
  const skyjoFlipIllustration = flipButtonImage(document.documentElement.dataset.cardTheme);
  const myVisibleSum = skyjoVisibleSum(me.grid);

  container.innerHTML = `
    <div class="screen screen--table skyjo-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt skyjo-felt">
        ${
          state.gameWinnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.gameWinnerId)?.name || '?'} termine sous ${SKYJO_TARGET_SCORE} points cumulés et gagne la partie !</p>`
            : ''
        }
        <div class="skyjo-draw-area">
          <button type="button" class="skyjo-pile skyjo-pile--discard ${canDraw ? 'skyjo-pile--pickable' : ''} ${canAct ? 'skyjo-pile--dimmed' : ''}" id="btn-draw-discard" ${canDraw ? '' : 'disabled'} ${canDraw && topDiscard ? 'data-card-id="discard-pile"' : ''}>
            ${topDiscard ? `<div class="skyjo-cell skyjo-cell--faceup ${skyjoValueClass(topDiscard.value)}">${topDiscard.value}</div>` : ''}
            <span class="skyjo-pile__label">Défausse</span>
          </button>

          ${
            canAct
              ? `<div class="skyjo-pile skyjo-pile--drawn" id="skyjo-drawn-card">
                   <div class="skyjo-cell skyjo-cell--faceup ${skyjoValueClass(state.drawnCard.card.value)}" data-card-id="drawn">${state.drawnCard.card.value}</div>
                   <span class="skyjo-pile__label">Piochée</span>
                 </div>`
              : `<button type="button" class="skyjo-pile skyjo-pile--deck ${canDraw ? 'skyjo-pile--pickable' : ''}" id="btn-draw-deck" ${canDraw ? '' : 'disabled'}>
                   <div class="skyjo-cell skyjo-cell--facedown"></div>
                   <span class="skyjo-pile__label">Pioche (${state.deck.length})</span>
                 </button>`
          }

          <!-- Toujours affiché à une position fixe (grisé quand non jouable),
               plutôt que d'apparaître/disparaître — évite que la ligne se
               redimensionne selon l'état. -->
          <button type="button" class="skyjo-flip-btn ${skyjoPendingMode === 'flip' ? 'skyjo-flip-btn--armed' : ''} ${canFlip ? '' : 'skyjo-flip-btn--dimmed'} ${skyjoFlipIllustration ? 'skyjo-flip-btn--illustrated' : ''}" id="skyjo-flip-btn" ${canFlip ? 'data-card-id="flip"' : 'disabled'} ${skyjoFlipIllustration ? `style="background-image:url('${skyjoFlipIllustration}')"` : ''}>
            ${skyjoFlipIllustration ? '' : '<span class="skyjo-flip-btn__icon">🔄</span><span>Flip</span>'}
          </button>
        </div>

        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">
          ${
            finished
              ? 'Manche terminée'
              : isMyTurn
                ? canDraw
                  ? 'Choisis la défausse ou la pioche'
                  : skyjoPendingMode === 'flip'
                    ? 'Touche une case cachée à retourner'
                    : canFlip
                      ? 'Place ta carte, ou utilise Flip'
                      : 'Place ta carte'
                : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`
          }
        </div>
      </div>

      <div class="my-hand">
        ${finished ? endGameActionsHtml() : ''}

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter un ami" aria-label="Inviter un ami">📤</button>
        ${threeDToggleHtml('skyjo')}
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>

      <div class="skyjo-my-grid-dock">
        <p class="my-hand__label">Ta grille${connectionBadge(state, me.id)} · Score total : ${me.score}${me.id === state.gameWinnerId ? ' 🏆' : ''}${finished ? ` · ${me.roundScore ?? 0} pts cette manche` : ''}</p>
        <p class="skyjo-visible-sum">${myVisibleSum} pt${myVisibleSum > 1 ? 's' : ''} visible${myVisibleSum > 1 ? 's' : ''}</p>
        ${skyjoGridHtml(me.grid, myClickableClassFor, canAct || canDraw, myFlipTargetFor)}
      </div>
    </div>
  `;

  container.querySelector('#btn-draw-deck')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawSkyjoFromDeck(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de piocher.');
    }
  });

  const placeCard = (index) => {
    placeSkyjoCard(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };
  const discardAndReveal = (index) => {
    discardSkyjoAndReveal(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };

  if (canAct) {
    container.querySelectorAll('.skyjo-my-grid-dock .skyjo-cell--placeable').forEach((el) => {
      el.addEventListener('click', () => {
        const index = Number(el.dataset.index);
        const cell = me.grid[index];
        // Mode Flip armé (bouton Flip touché juste avant) : cette case doit
        // être cachée pour pouvoir défausser-et-retourner dessus. Sinon
        // (comportement par défaut, le plus courant) : pose directement.
        if (skyjoPendingMode === 'flip') {
          if (!canFlip || !cell || cell.faceUp) {
            alert('Choisis une case cachée pour la retourner.');
            return;
          }
          skyjoPendingMode = null;
          discardAndReveal(index);
          return;
        }
        placeCard(index);
      });
    });
  }

  // Zone de pioche unifiée : selon la phase, la "source" glissable/tapable
  // est soit la défausse (avant pioche), soit la carte piochée + le bouton
  // Flip (après) — jamais les deux en même temps, donc un seul
  // enableDragToZone couvre tout le cycle sans se soucier de canDraw/canAct
  // (querySelectorAll('[data-card-id]') ne trouve que ce qui existe vraiment
  // dans le DOM à ce rendu).
  const drawArea = container.querySelector('.skyjo-draw-area');
  if (drawArea) {
    enableDragToZone(drawArea, {
      dragEnabled: isCardDragEnabled(),
      onTap: async (id) => {
        if (id === 'discard-pile') {
          const btn = container.querySelector('#btn-draw-discard');
          if (btn) btn.disabled = true;
          try {
            await drawSkyjoFromDiscard(room, player.id);
          } catch (err) {
            if (btn) btn.disabled = false;
            alert(err.message || 'Impossible de prendre la défausse.');
          }
          return;
        }
        if (id === 'flip') {
          skyjoPendingMode = skyjoPendingMode !== 'flip' ? 'flip' : null;
          renderSkyjoTable(container, { room, player, state, onLeave });
        }
        // id === 'drawn' : un tap simple sur la carte piochée elle-même ne fait rien, il faut viser une case.
      },
      onDrop: async (id, zone) => {
        if (zone.dropzone !== 'skyjo-cell') return;
        const index = Number(zone.index);
        if (id === 'discard-pile') {
          try {
            // `room` capture le state d'AVANT la pioche (drawnCard encore nul) :
            // il faut enchaîner sur le room mis à jour que renvoie l'appel
            // précédent, sinon la pose suivante croit qu'aucune carte n'a été
            // piochée ("Pioche d'abord une carte.") et échoue systématiquement.
            const drawn = await drawSkyjoFromDiscard(room, player.id);
            await placeSkyjoCard(drawn, player.id, index);
          } catch (err) {
            alert(err.message || 'Impossible de prendre la défausse et de la poser.');
          }
          return;
        }
        if (id === 'flip') {
          const cell = me.grid[index];
          if (!cell || cell.faceUp) {
            alert('Choisis une case cachée pour la retourner.');
            return;
          }
          discardAndReveal(index);
          return;
        }
        if (id === 'drawn') placeCard(index);
      }
    });
  }

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'skyjo', () => renderTable(container, { room, player, state, onLeave }));
}

function syncSkyjoOverlays(tableEl) {
  positionTable(tableEl.getBoundingClientRect());
  const rects = getCardRects();
  const gridRects = rects.focus || rects.mine || [];
  tableEl.querySelectorAll('[data-index]').forEach((btn) => {
    const r = gridRects[Number(btn.dataset.index)];
    if (!r) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'block';
    btn.style.left = `${r.left}px`;
    btn.style.top = `${r.top}px`;
    btn.style.width = `${r.width}px`;
    btn.style.height = `${r.height}px`;
  });
  const placePile = (sel, rect) => {
    const btn = tableEl.querySelector(sel);
    if (!btn || !rect) return;
    btn.style.left = `${rect.left}px`;
    btn.style.top = `${rect.top}px`;
    btn.style.width = `${rect.width}px`;
    btn.style.height = `${rect.height}px`;
  };
  placePile('[data-card-id="discard-pile"]', rects.discard);
  placePile('[data-skyjo-discard]', rects.discard);
  placePile('[data-card-id="deck-pile"]', rects.deck);
  placePile('[data-card-id="drawn"]', rects.drawn);
  getSeatHitRects().forEach((hit) => {
    const el = tableEl.querySelector(`[data-mini-seat="${hit.seat}"]`);
    if (!el) return;
    if (hit.focused || hit.width < 8) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${hit.left}px`;
    el.style.top = `${hit.top}px`;
    el.style.width = `${hit.width}px`;
    el.style.height = `${hit.height}px`;
  });
  const anchors = getRowLabelAnchors();
  tableEl.querySelectorAll('[data-seat-label]').forEach((el) => {
    const i = Number(el.dataset.seatLabel);
    const anchor = anchors.seats[i];
    if (!anchor || i === anchors.focused) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.left = `${anchor.left}px`;
    el.style.top = `${anchor.top}px`;
  });
}

function renderSkyjoTable3D(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const seatPlayers = [me, ...others];
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  if (!isMyTurn || !state.drawnCard) skyjoPendingMode = null;
  const { home, focusIdx, inspecting } = applySkyjoFocus(seatPlayers);
  const focusPlayer = seatPlayers[focusIdx] || me;

  const canDraw = isMyTurn && !state.drawnCard && !finished && !inspecting;
  const canAct = isMyTurn && !!state.drawnCard && !finished && !inspecting;
  const canFlip = canAct && state.drawnCard.source === 'deck';
  const topDiscard = state.discard[state.discard.length - 1];
  const focusSum = skyjoVisibleSum(focusPlayer.grid);

  const cellButtons = (focusPlayer.grid || [])
    .map((cell, i) => {
      if (!cell) return '';
      const drop = !inspecting && (canAct || canDraw) ? 'data-dropzone="skyjo-cell"' : '';
      return `<button type="button" class="skyjo-3d-card" data-index="${i}" ${drop}></button>`;
    })
    .join('');

  const drawnFace = state.drawnCard ? skyjoFaceUrl(state.drawnCard.card.value) : '';
  const discardFace = topDiscard ? skyjoFaceUrl(topDiscard.value) : '';
  const pileButtons = inspecting
    ? ''
    : `
    ${
      canDraw && topDiscard
        ? `<button type="button" class="skyjo-3d-card" data-card-id="discard-pile"${discardFace ? ` style="background-image:url('${discardFace}')"` : ''}></button>`
        : topDiscard
          ? `<button type="button" class="skyjo-3d-card" data-skyjo-discard="1" disabled></button>`
          : ''
    }
    ${
      canDraw && !state.drawnCard
        ? `<button type="button" class="skyjo-3d-card" data-card-id="deck-pile" id="btn-draw-deck"></button>`
        : ''
    }
    ${
      canAct
        ? `<button type="button" class="skyjo-3d-card" data-card-id="drawn"${drawnFace ? ` style="background-image:url('${drawnFace}')"` : ''}></button>`
        : ''
    }
  `;

  const miniButtons = seatPlayers
    .map((_, i) => (i === focusIdx ? '' : `<button type="button" class="skyjo-3d-mini" data-mini-seat="${i}" aria-label="Voir la grille"></button>`))
    .join('');

  const labels = seatPlayers
    .map((p, i) =>
      i === focusIdx
        ? ''
        : `<p class="skyjo-3d-label ${p.id === state.currentPlayerId ? 'skyjo-3d-label--turn' : ''}" data-seat-label="${i}">${p.name}${
            p.isBot ? ' 🤖' : ''
          } · ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}</p>`
    )
    .join('');

  let banner = 'Manche terminée';
  if (!finished) {
    if (inspecting) banner = `Grille de ${focusPlayer.name} · touche pour revenir`;
    else if (isMyTurn) {
      if (canDraw) banner = 'Choisis la défausse ou la pioche';
      else if (canFlip) banner = 'Glisse ta carte pour remplacer, ou touche une carte cachée pour la retourner';
      else banner = 'Glisse ta carte sur une case pour remplacer';
    } else banner = `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
  }

  const scoreLine =
    focusIdx === 0
      ? `Ta grille · ${focusSum} pt${focusSum > 1 ? 's' : ''} visible${focusSum > 1 ? 's' : ''} · total ${me.score}`
      : `${focusPlayer.name} · ${focusSum} pt${focusSum > 1 ? 's' : ''} visible${focusSum > 1 ? 's' : ''} · total ${focusPlayer.score}`;

  const redraw = () => renderSkyjoTable3D(container, { room, player, state, onLeave });

  container.innerHTML = `
    <div class="screen screen--table skyjo-screen skyjo-screen--3d">
      ${
        state.gameWinnerId
          ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.gameWinnerId)?.name || '?'} gagne la partie !</p>`
          : ''
      }
      <div class="turn-banner ${isMyTurn && !inspecting ? 'turn-banner--you' : ''}">${banner}</div>
      <div class="skyjo-3d-table ${inspecting ? 'skyjo-3d-table--inspecting' : ''}">
        ${labels}
        ${miniButtons}
        ${cellButtons}
        ${pileButtons}
      </div>
      <p class="skyjo-3d-score">${scoreLine}</p>
      ${finished ? endGameActionsHtml() : ''}
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal">📄</button>
      <button class="game-hud__bubble game-hud__bubble--invite" id="btn-invite-game" title="Inviter">📤</button>
      ${threeDToggleHtml('skyjo')}
      <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}">✕</button>
    </div>
  `;

  mountTable();
  updateTable({
    seats: seatPlayers.map((p) => ({ grid: p.grid, isTurn: p.id === state.currentPlayerId && !finished })),
    discardTop: topDiscard || null,
    discard: state.discard || [],
    deckCount: state.deck.length,
    drawn: state.drawnCard?.card || null,
    drawnSource: state.drawnCard?.source || null
  });
  showTable();

  const tableEl = container.querySelector('.skyjo-3d-table');
  if (tableEl) {
    const sync = () => syncSkyjoOverlays(tableEl);
    sync();
    setOverlaySync(sync);
    wireSkyjoOrbit(tableEl, sync, {
      onIdleClick: inspecting
        ? () => {
            returnSkyjoHome();
            redraw();
          }
        : null
    });
    new ResizeObserver(sync).observe(tableEl);
  }

  const placeCard = (index) => {
    placeSkyjoCard(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };
  const discardAndReveal = (index) => {
    discardSkyjoAndReveal(room, player.id, index).catch((err) => alert(err.message || 'Coup impossible.'));
  };

  if (!inspecting && canAct) {
    container.querySelectorAll('.skyjo-3d-table [data-index]').forEach((el) => {
      el.addEventListener('click', () => {
        const index = Number(el.dataset.index);
        const cell = me.grid[index];
        if (canFlip && cell && !cell.faceUp) {
          discardAndReveal(index);
          return;
        }
        if (!isCardDragEnabled()) placeCard(index);
      });
    });
  }

  if (!inspecting) {
    container.querySelector('#btn-draw-deck')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        await drawSkyjoFromDeck(room, player.id);
      } catch (err) {
        e.target.disabled = false;
        alert(err.message || 'Impossible de piocher.');
      }
    });
  }

  tableEl?.querySelectorAll('[data-mini-seat]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const seat = Number(el.dataset.miniSeat);
      if (inspecting || seat === home) returnSkyjoHome();
      else inspectSkyjoSeat(seat);
      redraw();
    });
  });

  if (tableEl && !inspecting) {
    enableDragToZone(tableEl, {
      dragEnabled: isCardDragEnabled(),
      onTap: async (id) => {
        if (id === 'discard-pile') {
          try {
            await drawSkyjoFromDiscard(room, player.id);
          } catch (err) {
            alert(err.message || 'Impossible de prendre la défausse.');
          }
        }
      },
      onDrop: async (id, zone) => {
        if (zone.dropzone !== 'skyjo-cell') return;
        const index = Number(zone.index);
        if (id === 'discard-pile') {
          try {
            const drawn = await drawSkyjoFromDiscard(room, player.id);
            await placeSkyjoCard(drawn, player.id, index);
          } catch (err) {
            alert(err.message || 'Impossible de prendre la défausse et de la poser.');
          }
          return;
        }
        if (id === 'drawn') placeCard(index);
      }
    });
  }

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  container.querySelector('#btn-invite-game')?.addEventListener('click', () => shareInviteLink(room));
  wireAbandonButton(container, { room, player, state, onLeave });
  wireThreeDToggle(container, 'skyjo', () => renderTable(container, { room, player, state, onLeave }));
}

function wireSkyjoOrbit(tableEl, onOrbit, { onIdleClick } = {}) {
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
      moved = false;
      if (pinching || e.target.closest('.skyjo-3d-card, .skyjo-3d-mini')) {
        dragging = false;
        return;
      }
      dragging = true;
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
  tableEl.addEventListener(
    'pointerup',
    () => {
      const idle = !moved && !pinching;
      dragging = false;
      if (idle) onIdleClick?.();
    },
    true
  );
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

export function renderSpectator(container, args) {
  if (!is3DEnabled('skyjo')) {
    hideTable();
    return false;
  }
  const { room, gameLabel, onBackToRooms, onRerender } = args;
  const state = room.state;
  const finished = state.status === 'finished';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;
  const topDiscard = state.discard[state.discard.length - 1];
  const { home, focusIdx, inspecting } = applySkyjoFocus(state.players);
  const focusPlayer = state.players[focusIdx] || state.players[0];
  const labels = state.players
    .map((p, i) =>
      i === focusIdx
        ? ''
        : `<p class="skyjo-3d-label ${p.id === state.currentPlayerId ? 'skyjo-3d-label--turn' : ''}" data-seat-label="${i}">${p.name}${
            p.isBot ? ' 🤖' : ''
          } · ${p.score}</p>`
    )
    .join('');
  const miniButtons = state.players
    .map((_, i) => (i === focusIdx ? '' : `<button type="button" class="skyjo-3d-mini" data-mini-seat="${i}"></button>`))
    .join('');
  const cellButtons = (focusPlayer?.grid || [])
    .map((cell, i) => (cell ? `<button type="button" class="skyjo-3d-card" data-index="${i}"></button>` : ''))
    .join('');

  const redraw = () => renderSpectator(container, args);

  container.innerHTML = `
    <div class="screen screen--table skyjo-screen skyjo-screen--3d">
      <p class="eyebrow">Tu regardes — ${gameLabel || 'Skyjo'} en cours</p>
      <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>
      <div class="turn-banner">${inspecting ? `Grille de ${focusPlayer?.name || '…'} · touche pour revenir` : currentName ? `Tour de ${currentName}` : 'En attente…'}</div>
      <div class="skyjo-3d-table ${inspecting ? 'skyjo-3d-table--inspecting' : ''}">${labels}${miniButtons}${cellButtons}</div>
      <p class="skyjo-3d-score">${focusPlayer ? `${focusPlayer.name} · ${skyjoVisibleSum(focusPlayer.grid)} pts visibles · total ${focusPlayer.score}` : ''}</p>
      <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules">?</button>
      <button class="game-hud__bubble game-hud__bubble--log" id="btn-log">📄</button>
      ${threeDToggleHtml('skyjo')}
    </div>
  `;

  mountTable();
  updateTable({
    seats: state.players.map((p) => ({
      grid: p.grid,
      isTurn: p.id === state.currentPlayerId && !finished
    })),
    discardTop: topDiscard || null,
    discard: state.discard || [],
    deckCount: state.deck.length,
    drawn: state.drawnCard?.card || null,
    drawnSource: state.drawnCard?.source || null,
    spectator: true
  });
  showTable();
  const tableEl = container.querySelector('.skyjo-3d-table');
  if (tableEl) {
    const sync = () => syncSkyjoOverlays(tableEl);
    sync();
    setOverlaySync(sync);
    wireSkyjoOrbit(tableEl, sync, {
      onIdleClick: inspecting
        ? () => {
            returnSkyjoHome();
            redraw();
          }
        : null
    });
    new ResizeObserver(sync).observe(tableEl);
    tableEl.querySelectorAll('[data-mini-seat]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const seat = Number(el.dataset.miniSeat);
        if (inspecting || seat === home) returnSkyjoHome();
        else inspectSkyjoSeat(seat);
        redraw();
      });
    });
  }
  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => onBackToRooms?.());
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireThreeDToggle(container, 'skyjo', () => onRerender?.());
  return true;
}
