import { revealTrioCenter, revealTrioRow, confirmTrioTurn } from '../../game/trio.js';
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

// Évite de programmer plusieurs fois le même auto-confirm (une par
// re-rendu) — même principe que la déduplication par signature des bots
// (voir trio.bot.js), mais ici côté joueur humain actif.
let scheduledConfirmSignature = null;

export function resetSelection() {
  scheduledConfirmSignature = null;
}

export function renderTable(container, { room, player, state, onLeave }) {
  renderTrioTable(container, { room, player, state, onLeave });
}

/**
 * Rotation + décalage vertical stables par id de carte (jamais Math.random,
 * qui ferait "sauter" le vrac à chaque re-rendu) — voir centerHtml : le
 * centre est piochable n'importe où (contrairement aux mains, triées, où
 * seules les deux extrémités comptent), le désordre visuel le signale.
 */
export function trioJitter(seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return { angle: (Math.abs(h) % 17) - 8, offsetY: (Math.abs(h >> 4) % 7) - 3 };
}

export function trioCardHtml(value, { faceUp = false, lifted = false, jitter = null } = {}) {
  const theme = document.documentElement.dataset.cardTheme;
  // Illustrations 1-12 mutualisées (voir classique/games/numbers/) — Flip 7
  // et La Suite Infernale réutilisent exactement les mêmes fichiers.
  const illustration = faceUp ? gameCardImage(theme, 'numbers', String(value), value) : null;
  const bg = illustration ? `background-image:url('${illustration}');` : '';
  // `lifted` (transform CSS via classe) et `jitter` (transform inline) ne se
  // combinent jamais en pratique : lifted ne s'utilise que sur sa propre
  // main (toujours triée, jamais en vrac), jitter que sur le centre.
  const rotate = jitter ? `transform: rotate(${jitter.angle}deg) translateY(${jitter.offsetY}px);` : '';
  const style = bg || rotate ? ` style="${bg}${rotate}"` : '';
  return `<div class="trio-cell ${faceUp ? 'trio-cell--faceup' : 'trio-cell--facedown'} ${illustration ? 'trio-cell--illustrated' : ''} ${lifted ? 'trio-cell--lifted' : ''}"${style}>${faceUp && !illustration ? value : ''}</div>`;
}

/** 3 trophées à côté du nom d'un joueur, allumés selon son nombre de trios trouvés (objectif : 3 pour gagner, ou 1 seul si c'est le trio de 7). */
export function trioTrophiesHtml(count) {
  return `<span class="trio-trophies">${Array.from({ length: 3 }, (_, i) => `<span class="trio-trophy ${i < count ? 'trio-trophy--lit' : ''}">🏆</span>`).join('')}</span>`;
}

/**
 * Rangée triée d'un joueur. `revealedIds` : cartes de la tentative en cours
 * à afficher face visible *à leur emplacement d'origine* (pas dans une zone
 * séparée — on voit ainsi directement de qui/d'où vient chaque carte
 * révélée). Les extrémités cliquables (`low`/`high`) sont recalculées en
 * ignorant les cartes déjà révélées dans cette tentative : après avoir
 * révélé le plus petit numéro d'une main, le plus petit numéro *restant*
 * devient à son tour la cible "low" — on peut ainsi enchaîner plusieurs
 * cartes du même bout d'une main tant qu'elles correspondent.
 * `alwaysFaceUp` : dans le jeu physique, chacun trie sa propre main
 * lui-même (à la vue de ses propres cartes) — seules les mains des AUTRES
 * et le centre sont réellement cachées ; passer `true` uniquement pour sa
 * propre rangée (`me.row`). Dans ce cas, une carte choisie ce tour-ci ne se
 * retourne pas (elle était déjà face visible pour son propriétaire) : elle
 * se soulève légèrement à la place, pour matérialiser la sélection — ce
 * soulèvement est vu par tout le monde exactement comme `revealedIds` (état
 * partagé), les autres joueurs voyant en plus la carte se retourner de leur
 * côté puisqu'elle leur était, elle, réellement cachée.
 */
export function trioRowHtml(row, { targetPlayerId, clickableEnds = false, revealedIds = new Set(), alwaysFaceUp = false } = {}) {
  if (!row.length) return `<div class="trio-row trio-row--empty">Main vide</div>`;
  const availableIndexes = row.map((_, i) => i).filter((i) => !revealedIds.has(row[i].id));
  const lowIndex = availableIndexes[0];
  const highIndex = availableIndexes[availableIndexes.length - 1];
  const cells = row
    .map((card, i) => {
      const revealed = revealedIds.has(card.id);
      const inner = trioCardHtml(card.value, { faceUp: revealed || alwaysFaceUp, lifted: alwaysFaceUp && revealed });
      if (revealed) return inner; // déjà révélée pour cette tentative : jamais re-cliquable
      const end = i === lowIndex ? 'low' : i === highIndex ? 'high' : null;
      const clickable = clickableEnds && end && !(highIndex === lowIndex && end === 'high'); // évite un doublon low+high sur la dernière carte restante
      if (clickable) {
        return `<button type="button" class="trio-cell-btn" data-row-target="${targetPlayerId}" data-row-end="${end}">${inner}</button>`;
      }
      return inner;
    })
    .join('');
  return `<div class="trio-row">${cells}</div>`;
}

function renderTrioTable(container, { room, player, state, onLeave }) {
  const me = state.players.find((p) => p.id === player.id);
  const isMyTurn = state.status === 'playing' && state.currentPlayerId === player.id;
  const awaitingConfirm = Boolean(state.turnOutcome);
  const canReveal = isMyTurn && !awaitingConfirm && state.pendingReveals.length < 3;
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;

  const finished = state.status === 'finished';

// Texte visible du bandeau très court (surtout pour "à toi de jouer", le cas
// le plus fréquent) — l'explication complète passe en infobulle (`title`,
// même convention que Cinq Rois/Suite Infernale) plutôt que d'imposer une
// longue phrase à l'écran à chaque tour.
let actionHint;
let actionHintDetail = '';
if (!isMyTurn) {
  actionHint = awaitingConfirm ? `${currentName || '…'} regarde…` : `Tour de ${currentName || '…'}`;
} else if (awaitingConfirm) {
  if (state.turnOutcome.type === 'success') {
    actionHint = `Trio de ${state.turnOutcome.trioValue} !`;
  } else {
    actionHint = 'Pas de trio';
    actionHintDetail = 'Pas de correspondance — les cartes retournent se cacher.';
  }
} else if (state.pendingReveals.length === 0) {
  actionHint = 'Ton tour';
  actionHintDetail = 'Révèle une carte : le centre, ou une extrémité (main d\'un adversaire ou la tienne).';
} else {
  actionHint = 'Encore une !';
  actionHintDetail = 'Encore une carte identique à trouver pour valider le trio.';
}

  const winnerBanner = finished
    ? `<p class="flip7-banner flip7-banner--winner">🃏 ${
        state.winnerId ? `${state.players.find((p) => p.id === state.winnerId)?.name || '?'} gagne la partie !` : 'Égalité — plus aucune carte disponible.'
      }</p>`
    : '';

  const revealedIds = new Set(state.pendingReveals.map((r) => r.source.cardId));

  // En fin de partie, plus aucune carte à cacher : tout reste visible pour
  // pouvoir revoir la répartition finale.
  const centerHtml = state.center
    .map((c) => {
      const jitter = trioJitter(c.id);
      if (c.taken) return `<div class="trio-cell trio-cell--gone" style="transform: rotate(${jitter.angle}deg) translateY(${jitter.offsetY}px);"></div>`;
      if (revealedIds.has(c.id) || finished) return trioCardHtml(c.value, { faceUp: true, jitter });
      const clickable = canReveal;
      if (clickable) {
        return `<button type="button" class="trio-cell-btn" data-center-id="${c.id}">${trioCardHtml(0, { faceUp: false, jitter })}</button>`;
      }
      return trioCardHtml(0, { faceUp: false, jitter });
    })
    .join('');

  const opponentsHtml = orderedOpponents(state, player.id)
    .map((p) => {
      const isTurn = p.id === state.currentPlayerId;
      return `<div class="trio-player ${isTurn ? 'trio-player--turn' : ''}">
        <p class="trio-player__name">${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''} ${trioTrophiesHtml(p.trios.length)}</p>
        ${trioRowHtml(p.row, { targetPlayerId: p.id, clickableEnds: canReveal, revealedIds, alwaysFaceUp: finished })}
      </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="screen screen--table trio-screen">
      <div class="pouilleux-zone pouilleux-zone--others trio-opponents">
        ${opponentsHtml || '<p class="pouilleux-zone__empty">—</p>'}
      </div>

      <div class="table-felt trio-felt">
        ${winnerBanner}
        <div class="turn-banner ${isMyTurn ? 'turn-banner--you' : ''}"${actionHintDetail ? ` title="${actionHintDetail}"` : ''}>${actionHint}</div>

        <div class="trio-center">
          <p class="trio-center__label">Centre</p>
          <div class="trio-row">${centerHtml}</div>
        </div>

      </div>

      <div class="my-hand">
        ${
          me
            ? `<p class="my-hand__label">Ta main${connectionBadge(state, me.id)} ${trioTrophiesHtml(me.trios.length)}</p>
               ${trioRowHtml(me.row, { targetPlayerId: me.id, clickableEnds: canReveal, revealedIds, alwaysFaceUp: true })}`
            : ''
        }

        ${state.status === 'finished' ? endGameActionsHtml() : ''}

        <details class="log">
          <summary>Journal de la partie</summary>
          <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
        </details>

        <button class="game-hud__bubble game-hud__bubble--help" id="btn-rules" title="Règles du jeu" aria-label="Règles du jeu">?</button>
        <button class="game-hud__bubble game-hud__bubble--quit" id="btn-abandon" title="${abandonButtonLabel(state, player)}" aria-label="${abandonButtonLabel(state, player)}">✕</button>
      </div>
    </div>
  `;

  wireEndGameActions(container, room);
  container.querySelector('#btn-rules')?.addEventListener('click', () => openRulesModal(room.game));
  wireAbandonButton(container, { room, player, state, onLeave });

  // Pas de bouton "Continuer" : une pause d'une seconde après la révélation
  // qui termine la tentative (trio trouvé ou non) suffit à laisser le temps
  // de voir le résultat, puis la main passe automatiquement — voir
  // trio.bot.js pour le même principe côté bot (délai fixe, pas aléatoire,
  // quand c'est à son tour de confirmer).
  if (isMyTurn && awaitingConfirm) {
    const signature = `${room.id}:${room.version}`;
    if (scheduledConfirmSignature !== signature) {
      scheduledConfirmSignature = signature;
      window.setTimeout(async () => {
        try {
          await confirmTrioTurn(room, player.id);
        } catch (err) {
          // Conflit optimiste attendu si un autre appareil a déjà confirmé — la resynchro realtime prend le relais.
        }
      }, 1000);
    }
  }

  if (canReveal) {
    container.querySelectorAll('[data-center-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await revealTrioCenter(room, player.id, btn.dataset.centerId);
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    });
    container.querySelectorAll('[data-row-target]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await revealTrioRow(room, player.id, btn.dataset.rowTarget, btn.dataset.rowEnd);
        } catch (err) {
          alert(err.message || String(err));
        }
      });
    });
  }
}
