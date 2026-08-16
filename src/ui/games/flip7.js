import { hitFlip7, stayFlip7, TARGET_SCORE as FLIP7_TARGET_SCORE } from '../../game/flip7.js';
import { openRulesModal } from '../rules.js';
import { gameCardImage } from '../cardThemes.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents
} from '../gameShared.js';

const FLIP7_STATUS_LABEL = { active: 'En jeu', stayed: 'Resté', busted: 'Passé !' };
const FLIP7_ACTION_LABEL = { freeze: '❄️ Freeze', flipThree: '🔀 Flip Three', secondChance: '🛡️ 2e chance' };

export function resetSelection() {}

export function renderTable(container, { room, player, state, onLeave }) {
  renderFlip7Table(container, { room, player, state, onLeave });
}

/** Clé de slot illustration (voir gameCardImage) pour une carte modificateur — évite le `+` de `card.id`/`card.label`, invalide dans un nom de fichier/le regex de buildGameSlotRegistry. */
function flip7ModifierSlotKey(card) {
  return card.modType === 'x2' ? 'x2' : `plus${card.amount}`;
}

/** Clé de slot illustration pour une carte action — par `kind` (pas `card.id`) : les 3 exemplaires de chaque action partagent la même unique illustration. */
function flip7ActionSlotKey(card) {
  if (card.kind === 'freeze') return 'freeze';
  if (card.kind === 'flipThree') return 'flip3';
  if (card.kind === 'secondChance') return 'secondchance';
  return card.kind;
}

export function flip7CardHtml(card) {
  const theme = document.documentElement.dataset.cardTheme;
  // Illustrations 1-12 mutualisées avec le Trio/La Suite Infernale (voir
  // classique/games/numbers/) ; le 0, propre à Flip 7 (aucun autre jeu ne
  // l'utilise), reste dans son propre dossier.
  if (card.kind === 'number') {
    const illustration =
      card.value === 0
        ? gameCardImage(theme, 'flip7', '0', card.value)
        : gameCardImage(theme, 'numbers', String(card.value), card.value);
    const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
    return `<div class="flip7-card flip7-card--number ${illustration ? 'flip7-card--illustrated' : ''}"${style}>${illustration ? '' : card.value}</div>`;
  }
  if (card.kind === 'modifier') {
    const illustration = gameCardImage(theme, 'flip7', flip7ModifierSlotKey(card), card.id);
    const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
    return `<div class="flip7-card flip7-card--modifier ${illustration ? 'flip7-card--illustrated' : ''}"${style}>${illustration ? '' : card.label}</div>`;
  }
  const illustration = gameCardImage(theme, 'flip7', flip7ActionSlotKey(card), card.id);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="flip7-card flip7-card--action ${illustration ? 'flip7-card--illustrated' : ''}"${style}>${illustration ? '' : FLIP7_ACTION_LABEL[card.kind] || card.label}</div>`;
}

function renderFlip7Table(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const others = orderedOpponents(state, player.id);
  const isMyTurn = state.currentPlayerId === player.id;
  const finished = state.status === 'finished';
  const canAct = isMyTurn && me.status === 'active' && !finished;

  const uniqueCountFor = (p) => p.display.filter((c) => c.kind === 'number').length;
  const statusLabelFor = (p) =>
    finished ? `${FLIP7_STATUS_LABEL[p.status]} · ${p.roundScore ?? 0} pt${(p.roundScore ?? 0) > 1 ? 's' : ''} cette manche` : FLIP7_STATUS_LABEL[p.status];

  // Les cartes d'un adversaire ne s'affichent plus dans cette liste du tout
  // — juste nom + score, toujours à jour. La main du joueur en train de
  // flipper (lui inclus) s'affiche à sa place au milieu, dans le feutre
  // (voir plus bas) : une seule "zone de flip" commune plutôt qu'une par
  // adversaire, moins de redite et plus de place pour chacune.
  const restHtml = others
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `
        <div class="opponent opponent--compact ${isTurn ? 'opponent--turn' : ''}">
          <p class="opponent__name">${p.name}${connectionBadge(state, p.id)} · ${uniqueCountFor(p)}/7 · ${statusLabelFor(p)}</p>
          <p class="opponent__name">Score total : ${p.score}${p.id === state.gameWinnerId ? ' 🏆' : ''}</p>
        </div>`;
    })
    .join('');

  // Pendant mon propre tour, ma main est déjà affichée juste en dessous
  // (avec les boutons d'action) — pas la peine de la dupliquer ici. La zone
  // de flip ne montre donc les cartes que quand c'est un adversaire qui flippe.
  const currentFlipper = state.players.find((p) => p.id === state.currentPlayerId);
  const flipZoneHtml =
    currentFlipper && !finished && !isMyTurn
      ? `<div class="flip7-hand">${currentFlipper.display.map(flip7CardHtml).join('') || '<p class="my-hand__empty">Pas encore de carte cette manche.</p>'}</div>`
      : '';

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
        ${flipZoneHtml}
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
