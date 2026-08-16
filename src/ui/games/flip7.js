import { hitFlip7, stayFlip7, TARGET_SCORE as FLIP7_TARGET_SCORE } from '../../game/flip7.js';
import { openRulesModal } from '../rules.js';
import { gameCardImage } from '../cardThemes.js';
import {
  connectionBadge,
  endGameActionsHtml,
  wireAbandonButton,
  abandonButtonLabel,
  wireEndGameActions,
  orderedOpponents,
  openLogModal
} from '../gameShared.js';

const FLIP7_STATUS_LABEL = { active: 'En jeu', stayed: 'Resté', busted: 'Passé !' };
const FLIP7_ACTION_LABEL = { freeze: '❄️ Freeze', flipThree: '🔀 Flip Three', secondChance: '🛡️ 2e chance' };

// Un doublon pioché (perdu pour la manche) fait immédiatement passer la main
// au joueur suivant côté état — sans ce gel d'1s, la carte en double
// disparaîtrait de la zone de flip avant même d'avoir pu la voir. On mémorise
// qui flippait au dernier rendu pour détecter la transition, on fige alors
// l'affichage sur sa main finale le temps du délai, puis on laisse la main
// suivante s'afficher normalement.
let flip7PrevCurrentPlayerId = null;
let flip7BustFreeze = null; // { name, display } pendant le gel, sinon null
let flip7BustFreezeTimer = null;

export function resetSelection() {
  flip7PrevCurrentPlayerId = null;
  flip7BustFreeze = null;
  if (flip7BustFreezeTimer) {
    window.clearTimeout(flip7BustFreezeTimer);
    flip7BustFreezeTimer = null;
  }
}

export function renderTable(container, { room, player, state, onLeave }) {
  if (flip7BustFreezeTimer) return; // le gel en cours affiche déjà la bonne vue, rien à refaire

  const bustedPlayer =
    flip7PrevCurrentPlayerId && flip7PrevCurrentPlayerId !== state.currentPlayerId
      ? state.players.find((p) => p.id === flip7PrevCurrentPlayerId && p.status === 'busted')
      : null;

  if (bustedPlayer && state.status !== 'finished') {
    flip7BustFreeze = { name: bustedPlayer.name, display: bustedPlayer.display };
    renderFlip7Table(container, { room, player, state, onLeave });
    flip7BustFreezeTimer = window.setTimeout(() => {
      flip7BustFreezeTimer = null;
      flip7BustFreeze = null;
      flip7PrevCurrentPlayerId = state.currentPlayerId;
      renderTable(container, { room, player, state, onLeave });
    }, 1000);
    return;
  }

  flip7PrevCurrentPlayerId = state.currentPlayerId;
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
  // `roundScore` est réglé dès qu'un joueur termine son tour (voir
  // settlePlayerScore côté moteur), pas seulement à la toute fin de la
  // manche — l'affichage suit donc la même logique, sans attendre `finished`.
  const statusLabelFor = (p) =>
    p.roundScore != null ? `${FLIP7_STATUS_LABEL[p.status]} · ${p.roundScore} pt${p.roundScore > 1 ? 's' : ''} cette manche` : FLIP7_STATUS_LABEL[p.status];

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

  // Les cartes piochées (les miennes comme celles d'un adversaire) s'affichent
  // toutes dans la zone de flip centrale, jamais dans "ma main" — une seule
  // zone commune à tout le monde, cohérente avec le reste de la table.
  const currentFlipper = state.players.find((p) => p.id === state.currentPlayerId);
  const flipDisplay = flip7BustFreeze ? flip7BustFreeze.display : currentFlipper?.display;
  const flipZoneHtml =
    flipDisplay && !finished
      ? `<div class="flip7-hand">${flipDisplay.map(flip7CardHtml).join('') || '<p class="my-hand__empty">Pas encore de carte cette manche.</p>'}</div>`
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
            flip7BustFreeze
              ? `💥 ${flip7BustFreeze.name} pioche un doublon — perdu pour cette manche !`
              : finished
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

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--log" id="btn-log" title="Journal de la partie" aria-label="Journal de la partie">📄</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
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
  container.querySelector('#btn-log')?.addEventListener('click', () => openLogModal(state));
  wireAbandonButton(container, { room, player, state, onLeave });
}
