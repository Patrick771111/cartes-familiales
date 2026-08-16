import {
  drawSuiteInfernale,
  playSuiteInfernaleSequenceCard,
  playSuiteInfernaleRejouer,
  playSuiteInfernaleAttack,
  respondToSuiteInfernaleAttack,
  discardSuiteInfernale,
  SEQUENCE_TARGET as SUITE_INFERNALE_TARGET,
  SPECIAL_TYPES as SUITE_INFERNALE_SPECIAL_TYPES
} from '../../game/suiteinfernale.js';
import { cardBackHtml } from '../cards.js';
import { gameCardImage } from '../cardThemes.js';
import { enableDragToZone } from '../dragToZone.js';
import { isCardDragEnabled } from '../settings.js';
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

const SUITE_INFERNALE_SLOT_TARGETED_TYPES = ['retirerUne', 'volerUne'];

// Carte en cours de sélection d'une cible (et, pour "retirer/voler 1 carte",
// d'une case précise dans la suite de la cible une fois choisie) — mémorisé
// en dehors du rendu, sur le même principe que `pendingEightCardId` au 8
// américain. `suiteInfernaleDiscardMode` bascule le clic sur une carte en
// main vers une défausse plutôt qu'une tentative de jeu.
let pendingSuiteInfernaleCardId = null;
let pendingSuiteInfernaleTargetId = null;
let suiteInfernaleDiscardMode = false;

// Une attaque en attente reste visible de tous (pas seulement de la cible)
// pendant qu'elle attend une réponse ; une fois résolue (bloquée ou non), le
// message de résolution reste affiché ~1,5s pour que tout le monde le voie
// avant de disparaître.
let suiteInfernaleAttackWasPending = false;
let suiteInfernaleResolutionBanner = null;

export function resetSelection() {
  pendingSuiteInfernaleCardId = null;
  pendingSuiteInfernaleTargetId = null;
  suiteInfernaleDiscardMode = false;
  suiteInfernaleAttackWasPending = false;
  suiteInfernaleResolutionBanner = null;
}

export function renderTable(container, { room, player, state, onLeave }) {
  renderSuiteInfernaleTable(container, { room, player, state, onLeave });
}

function suiteInfernaleCardHtml(card) {
  const theme = document.documentElement.dataset.cardTheme;
  if (card.kind === 'number') {
    // Illustrations 1-10 mutualisées avec le Trio/Flip 7 (voir classique/games/numbers/).
    const illustration = gameCardImage(theme, 'numbers', String(card.value), card.value);
    const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
    return `<div class="suiteinfernale-card suiteinfernale-card--number ${illustration ? 'suiteinfernale-card--illustrated' : ''}"${style}>${illustration ? '' : card.value}</div>`;
  }
  const label = SUITE_INFERNALE_SPECIAL_TYPES[card.type]?.label || card.type;
  const illustration = gameCardImage(theme, 'suiteinfernale', card.type, card.id);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="suiteinfernale-card suiteinfernale-card--special ${illustration ? 'suiteinfernale-card--illustrated' : ''}" title="${label}"${style}>${illustration ? '' : label}</div>`;
}

// Une case remplie par un Joker doit rester visuellement distincte d'un
// numéro normal (on ne voit sinon pas qu'on attaque un Joker +2 plutôt
// qu'un vrai numéro, par exemple) : contenu + info-bulle différents.
function suiteInfernaleSlotContent(card) {
  if (!card) return '';
  if (card.kind === 'number') return card.value;
  return card.type === 'jokerPlus2' ? '🃏²' : '🃏';
}

// Miniature de la carte réellement jouée dans la case (même illustration que
// dans la main), plutôt qu'un simple chiffre — repli sur `suiteInfernaleSlotContent`
// si aucune illustration n'est disponible pour ce thème de cartes.
function suiteInfernaleSlotIllustration(card) {
  if (!card) return null;
  const theme = document.documentElement.dataset.cardTheme;
  if (card.kind === 'number') return gameCardImage(theme, 'numbers', String(card.value), card.value);
  return gameCardImage(theme, 'suiteinfernale', card.type, card.id);
}

function suiteInfernaleSlotTitle(card, index) {
  if (!card) return `Case ${index + 1} (vide)`;
  if (card.kind === 'number') return `${card.value}`;
  return SUITE_INFERNALE_SPECIAL_TYPES[card.type]?.label || card.type;
}

/**
 * `targetId`, uniquement pour la suite d'un adversaire : marque chaque case
 * remplie comme zone de dépôt précise (`opponent-slot`) pour le
 * glisser-déposer d'une attaque ciblée (ex : retirer/voler LA carte visée),
 * en plus de la zone globale posée sur `.opponent` (voir `restHtml`).
 */
export function suiteInfernaleSequenceHtml(sequence, { clickableIndexes, targetId } = {}) {
  return `<div class="suiteinfernale-sequence">
    ${sequence
      .map((card, i) => {
        const clickable = clickableIndexes && clickableIndexes.includes(i);
        const isJoker = card && card.kind === 'special';
        const dropAttrs = targetId && card ? `data-dropzone="opponent-slot" data-target-id="${targetId}" data-slot-index="${i}"` : '';
        const illustration = suiteInfernaleSlotIllustration(card);
        const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
        return `<div class="suiteinfernale-slot ${card ? 'suiteinfernale-slot--filled' : ''} ${isJoker ? 'suiteinfernale-slot--joker' : ''} ${illustration ? 'suiteinfernale-slot--illustrated' : ''} ${clickable ? 'suiteinfernale-slot--pickable' : ''}" data-index="${i}" ${dropAttrs}${style} title="${suiteInfernaleSlotTitle(card, i)}">${illustration ? '' : (suiteInfernaleSlotContent(card) || i + 1)}</div>`;
      })
      .join('')}
  </div>`;
}

function suiteInfernaleHighestFilledIndex(sequence) {
  for (let i = sequence.length - 1; i >= 0; i--) {
    if (sequence[i]) return i;
  }
  return -1;
}

function suiteInfernalePlayable(card, me) {
  const neededIndex = me.sequence.findIndex((c) => !c);
  const filledCount = me.sequence.filter(Boolean).length;
  if (card.kind === 'number') return neededIndex !== -1 && card.value === neededIndex + 1;
  if (card.type === 'jokerPlus1') return neededIndex !== -1;
  if (card.type === 'jokerPlus2') return neededIndex !== -1 && filledCount > 0 && neededIndex < 8;
  if (card.type === 'stop') return false; // uniquement jouable en réaction à une attaque
  return true; // rejouer + les 6 types ciblés
}

function renderSuiteInfernaleTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const reaction = state.pendingAttack && state.pendingAttack.targetId === player.id ? state.pendingAttack : null;
  if (!isMyTurn || state.pendingAttack) {
    pendingSuiteInfernaleCardId = null;
    pendingSuiteInfernaleTargetId = null;
  }
  if (!isMyTurn) suiteInfernaleDiscardMode = false;

  if (state.pendingAttack) {
    suiteInfernaleAttackWasPending = true;
  } else if (suiteInfernaleAttackWasPending) {
    suiteInfernaleAttackWasPending = false;
    const message = state.log[state.log.length - 1]?.message;
    if (message) {
      suiteInfernaleResolutionBanner = message;
      window.setTimeout(() => {
        suiteInfernaleResolutionBanner = null;
        renderSuiteInfernaleTable(container, { room, player, state, onLeave });
      }, 1500);
    }
  }

  const pendingAttackInfo = state.pendingAttack
    ? {
        attackerName: state.players.find((p) => p.id === state.pendingAttack.byId)?.name || '?',
        targetName: state.players.find((p) => p.id === state.pendingAttack.targetId)?.name || '?',
        label: SUITE_INFERNALE_SPECIAL_TYPES[state.pendingAttack.type]?.label || state.pendingAttack.type
      }
    : null;

  const canDraw = isMyTurn && !state.hasDrawnThisTurn && !finished && !state.pendingAttack;
  const canAct = isMyTurn && state.hasDrawnThisTurn && !finished && !state.pendingAttack;

  const pendingCard = pendingSuiteInfernaleCardId ? me.hand.find((c) => c.id === pendingSuiteInfernaleCardId) : null;
  const validTargets = pendingCard
    ? others.filter((o) => {
        if (pendingCard.type === 'volerDerniere') return suiteInfernaleHighestFilledIndex(o.sequence) !== -1;
        if (pendingCard.type === 'retirerDeux') {
          const h = suiteInfernaleHighestFilledIndex(o.sequence);
          return h >= 1 && o.sequence[h] && o.sequence[h - 1];
        }
        if (SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type)) return o.sequence.some(Boolean);
        return true; // echangerJeu, changerPlace
      })
    : [];
  const pendingTarget = pendingSuiteInfernaleTargetId ? others.find((o) => o.id === pendingSuiteInfernaleTargetId) : null;
  const awaitingSlotChoice = pendingCard && pendingTarget && SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type);

  const myStopCard = me.hand.find((c) => c.kind === 'special' && c.type === 'stop');
  const dragMode = isCardDragEnabled();

  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      const isPendingTarget = pendingTarget?.id === p.id;
      const clickableIndexes = awaitingSlotChoice && isPendingTarget ? p.sequence.map((c, i) => (c ? i : -1)).filter((i) => i !== -1) : null;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}" data-player-id="${p.id}" data-dropzone="opponent" data-target-id="${p.id}">
          ${suiteInfernaleSequenceHtml(p.sequence, { clickableIndexes, targetId: p.id })}
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${p.sequence.filter(Boolean).length}/${SUITE_INFERNALE_TARGET} · ${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}</p>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table suiteinfernale-screen">
      <div class="pouilleux-zone pouilleux-zone--others">
        ${restHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt suiteinfernale-felt">
        ${
          state.winnerId
            ? `<p class="flip7-banner flip7-banner--winner">🏆 ${state.players.find((p) => p.id === state.winnerId)?.name || '?'} termine sa suite et gagne la partie !</p>`
            : ''
        }
        <div class="suiteinfernale-piles">
          <button type="button" class="suiteinfernale-stock ${canDraw ? 'suiteinfernale-stock--pickable' : ''}" id="btn-draw" ${canDraw ? '' : 'disabled'}>
            ${cardBackHtml()}
            <span class="suiteinfernale-stock__count">Pioche (${state.deck.length})</span>
          </button>
          <div class="suiteinfernale-discard-pile" data-dropzone="discard" title="Dépose une carte ici pour la défausser.">
            ${state.lastDiscarded ? suiteInfernaleCardHtml(state.lastDiscarded) : '<div class="suiteinfernale-discard-pile__empty"></div>'}
            <span class="suiteinfernale-discard-pile__label">Défausse</span>
          </div>
        </div>

        ${
          (() => {
            const text = finished
              ? 'Partie terminée'
              : state.pendingAttack
                ? '' // le bandeau d'attaque ci-dessous suffit
                : isMyTurn
                  ? canDraw
                    ? 'Touche la pioche'
                    : 'Joue une carte, ou défausses-en une'
                  : `Tour de ${state.players.find((p) => p.id === state.currentPlayerId)?.name || '…'}`;
            return text ? `<div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}">${text}</div>` : '';
          })()
        }

        ${
          pendingAttackInfo
            ? `<div class="suiteinfernale-attack-banner">
                 <p>${pendingAttackInfo.attackerName} attaque ${pendingAttackInfo.targetName} avec ${pendingAttackInfo.label} !</p>
               </div>`
            : suiteInfernaleResolutionBanner
              ? `<div class="suiteinfernale-attack-banner suiteinfernale-attack-banner--resolved"><p>${suiteInfernaleResolutionBanner}</p></div>`
              : ''
        }

        ${
          reaction
            ? `<div class="suiteinfernale-reaction">
                 <div class="suiteinfernale-reaction__options">
                   <button type="button" class="btn btn--primary btn--small" id="btn-stop" ${myStopCard ? '' : 'disabled'}>🛑 Bloquer avec un STOP</button>
                   <button type="button" class="btn btn--ghost btn--small" id="btn-allow">Laisser passer</button>
                 </div>
               </div>`
            : ''
        }

        ${
          pendingCard && !awaitingSlotChoice
            ? `<div class="suiteinfernale-target-picker">
                 <p class="suiteinfernale-target-picker__label">Choisis la cible :</p>
                 <div class="suiteinfernale-target-picker__options">
                   ${validTargets.map((p) => `<button type="button" class="btn btn--ghost btn--small suiteinfernale-target-picker__option" data-target-id="${p.id}">${p.name}</button>`).join('') || '<p class="suiteinfernale-target-picker__empty">Aucune cible valide pour cette carte.</p>'}
                 </div>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-special">Annuler</button>
               </div>`
            : ''
        }
        ${
          awaitingSlotChoice
            ? `<div class="suiteinfernale-target-picker">
                 <p class="suiteinfernale-target-picker__label">Touche la carte de ${pendingTarget.name} à cibler, ci-dessus.</p>
                 <button type="button" class="btn btn--link btn--small" id="btn-cancel-special">Annuler</button>
               </div>`
            : ''
        }
      </div>

      <div class="my-hand">
        <p class="my-hand__label" ${dragMode ? `title="Dépose une carte ici pour la jouer."` : ''}>Ta suite (${me.sequence.filter(Boolean).length}/${SUITE_INFERNALE_TARGET})${dragMode ? ' <small>ℹ️</small>' : ''}</p>
        <div data-dropzone="own-sequence">${suiteInfernaleSequenceHtml(me.sequence)}</div>

        ${
          canAct && !pendingCard
            ? `<div class="suiteinfernale-actions">
                 ${!dragMode ? `<button id="btn-discard-mode" class="btn ${suiteInfernaleDiscardMode ? 'btn--primary' : 'btn--ghost'}">${suiteInfernaleDiscardMode ? 'Touche une carte à défausser' : 'Défausser une carte'}</button>` : ''}
               </div>`
            : ''
        }

        <p class="my-hand__label" ${dragMode ? `title="Glisse une carte vers ta suite, un adversaire ou la défausse."` : `title="Touche une carte pour la jouer, ou choisir sa cible."`}>Ta main (${me.hand.length}) <small>ℹ️</small></p>
        <div class="my-hand__cards suiteinfernale-hand" id="suiteinfernale-hand">
          ${me.hand
            .map((c) => {
              const playable = canAct && !suiteInfernaleDiscardMode && suiteInfernalePlayable(c, me);
              const discardable = canAct && suiteInfernaleDiscardMode;
              return `<div class="hand-card ${playable || discardable ? '' : 'hand-card--unplayable'} ${pendingSuiteInfernaleCardId === c.id ? 'hand-card--selected' : ''}" data-card-id="${c.id}">${suiteInfernaleCardHtml(c)}</div>`;
            })
            .join('') || '<p class="my-hand__empty">Main vide.</p>'}
        </div>

        ${finished ? endGameActionsHtml() : ''}

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-draw')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await drawSuiteInfernale(room, player.id);
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de piocher.');
    }
  });

  container.querySelector('#btn-discard-mode')?.addEventListener('click', () => {
    suiteInfernaleDiscardMode = !suiteInfernaleDiscardMode;
    renderSuiteInfernaleTable(container, { room, player, state, onLeave });
  });

  container.querySelector('#btn-stop')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await respondToSuiteInfernaleAttack(room, player.id, { block: true, stopCardId: myStopCard.id });
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || 'Impossible de bloquer cette attaque.');
    }
  });

  container.querySelector('#btn-allow')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await respondToSuiteInfernaleAttack(room, player.id, { block: false });
    } catch (err) {
      e.target.disabled = false;
      alert(err.message || "Impossible de laisser passer l'attaque.");
    }
  });

  container.querySelector('#btn-cancel-special')?.addEventListener('click', () => {
    pendingSuiteInfernaleCardId = null;
    pendingSuiteInfernaleTargetId = null;
    renderSuiteInfernaleTable(container, { room, player, state, onLeave });
  });

  container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.targetId;
      const cardId = pendingSuiteInfernaleCardId;
      if (SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(pendingCard.type)) {
        pendingSuiteInfernaleTargetId = targetId;
        renderSuiteInfernaleTable(container, { room, player, state, onLeave });
        return;
      }
      container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((b) => (b.disabled = true));
      try {
        await playSuiteInfernaleAttack(room, player.id, cardId, targetId, null);
        pendingSuiteInfernaleCardId = null;
      } catch (err) {
        container.querySelectorAll('.suiteinfernale-target-picker__option').forEach((b) => (b.disabled = false));
        alert(err.message || 'Impossible de jouer cette carte.');
      }
    });
  });

  if (awaitingSlotChoice) {
    container.querySelectorAll(`.opponent[data-player-id="${pendingTarget.id}"] .suiteinfernale-slot--pickable`).forEach((el) => {
      el.addEventListener('click', async () => {
        const slotIndex = Number(el.dataset.index);
        const cardId = pendingSuiteInfernaleCardId;
        const targetId = pendingSuiteInfernaleTargetId;
        try {
          await playSuiteInfernaleAttack(room, player.id, cardId, targetId, slotIndex);
          pendingSuiteInfernaleCardId = null;
          pendingSuiteInfernaleTargetId = null;
        } catch (err) {
          alert(err.message || 'Impossible de jouer cette carte.');
        }
      });
    });
  }

  if (canAct && !pendingCard) {
    // Tap simple : même flux qu'avant (choix de cible/case via les boutons
    // pour les cartes ciblées). Glisser-déposer : dépôt direct sur la zone
    // visée (sa propre suite, un adversaire — précisément sur sa carte pour
    // "retirer/voler 1 carte" — ou la défausse), en un seul geste.
    const handEl = container.querySelector('#suiteinfernale-hand');
    if (handEl) {
      enableDragToZone(handEl, {
        dragEnabled: dragMode,
        onTap: async (id) => {
          const card = me.hand.find((c) => c.id === id);
          if (!card) return;

          if (suiteInfernaleDiscardMode) {
            try {
              await discardSuiteInfernale(room, player.id, id);
              suiteInfernaleDiscardMode = false;
            } catch (err) {
              alert(err.message || 'Impossible de défausser cette carte.');
            }
            return;
          }

          if (card.kind === 'number' || card.type === 'jokerPlus1' || card.type === 'jokerPlus2') {
            try {
              await playSuiteInfernaleSequenceCard(room, player.id, id);
            } catch (err) {
              alert(err.message || 'Impossible de jouer cette carte.');
            }
            return;
          }
          if (card.type === 'rejouer') {
            try {
              await playSuiteInfernaleRejouer(room, player.id, id);
            } catch (err) {
              alert(err.message || 'Impossible de jouer cette carte.');
            }
            return;
          }

          pendingSuiteInfernaleCardId = id;
          pendingSuiteInfernaleTargetId = null;
          renderSuiteInfernaleTable(container, { room, player, state, onLeave });
        },
        onDrop: async (id, zone) => {
          const card = me.hand.find((c) => c.id === id);
          if (!card) return;

          try {
            if (zone.dropzone === 'discard') {
              await discardSuiteInfernale(room, player.id, id);
              return;
            }
            if (card.kind === 'number' || card.type === 'jokerPlus1' || card.type === 'jokerPlus2') {
              if (zone.dropzone !== 'own-sequence') {
                alert('Dépose cette carte sur ta suite pour la jouer.');
                return;
              }
              await playSuiteInfernaleSequenceCard(room, player.id, id);
              return;
            }
            if (card.type === 'rejouer') {
              if (zone.dropzone !== 'own-sequence') {
                alert('Dépose cette carte sur ta suite pour la jouer.');
                return;
              }
              await playSuiteInfernaleRejouer(room, player.id, id);
              return;
            }
            if (card.type === 'stop') {
              alert('Le STOP ne se joue que pour contrer une attaque adverse, en réaction.');
              return;
            }
            if (zone.dropzone === 'opponent' || zone.dropzone === 'opponent-slot') {
              const needsSlot = SUITE_INFERNALE_SLOT_TARGETED_TYPES.includes(card.type);
              if (needsSlot && zone.dropzone !== 'opponent-slot') {
                alert('Dépose cette carte précisément sur la carte de la suite adverse à cibler.');
                return;
              }
              const slotIndex = needsSlot ? Number(zone.slotIndex) : null;
              await playSuiteInfernaleAttack(room, player.id, id, zone.targetId, slotIndex);
              return;
            }
            alert('Dépose cette carte sur ta suite, sur un adversaire, ou sur la défausse.');
          } catch (err) {
            alert(err.message || 'Impossible de jouer cette carte.');
          }
        }
      });
    }
  }

  wireEndGameActions(container, room);

  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireAbandonButton(container, { room, player, state, onLeave });
}
