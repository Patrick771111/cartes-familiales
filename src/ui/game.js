import { cardFaceHtml } from './cards.js';
import { AVAILABLE_GAMES, startGame, claimHost, addBot, HOST_STALE_MS } from '../game/engine.js';
import { rankLabel as trouducRankLabel } from '../game/trouduc.js';
import { SEQUENCE_TARGET as SUITE_INFERNALE_TARGET } from '../game/suiteinfernale.js';
import { connectionBadge, getRevealHands, toggleRevealHands, resetRevealHands } from './gameShared.js';

// Un fichier par jeu, découvert dynamiquement : ajouter/retirer un jeu ne
// touche jamais ce fichier, il suffit d'ajouter/retirer src/ui/games/<id>.js
// (voir aussi le registre équivalent côté moteur dans game/engine.js et côté
// bots dans main.js).
const gameUiModules = import.meta.glob('./games/*.js', { eager: true });
const GAME_UI = {};
for (const path in gameUiModules) {
  const id = path.match(/\/([^/]+)\.js$/)?.[1];
  if (id) GAME_UI[id] = gameUiModules[path];
}

/**
 * Affiche l'écran de partie (salle d'attente / plateau / fin) dans `container`.
 * `room` = ligne courante (state + type de jeu inclus), `player` = profil local.
 * Le changement de prénom se fait désormais depuis la modale de réglages (settings.js).
 * Chaque jeu gère lui-même ses sous-écrans (en cours, échange, fin…) dans son
 * propre `renderTable` — ce dispatcher ne connaît que "lobby" vs "le reste".
 */
export function renderGame(container, { room, player, onLeave, onKick } = {}) {
  const state = room.state;

  if (state.status === 'lobby') {
    Object.values(GAME_UI).forEach((mod) => mod.resetSelection?.());
    resetRevealHands();
    return renderWaitingRoom(container, { room, player, onLeave, onKick });
  }

  const mod = GAME_UI[room.game];
  if (!mod) return;
  return mod.renderTable(container, { room, player, state, onLeave });
}

// Le lobby est entièrement redessiné (innerHTML) à chaque mise à jour de la salle
// (ex : ajout d'un bot via Realtime), ce qui réinitialiserait la sélection du jeu
// si elle n'était pas mémorisée en dehors de la fonction de rendu.
let selectedGameIdByRoom = null;

function renderWaitingRoom(container, { room, player, onLeave, onKick }) {
  const state = room.state;
  if (selectedGameIdByRoom?.roomId !== room.id) selectedGameIdByRoom = null;
  const selectedGameId = selectedGameIdByRoom?.gameId || AVAILABLE_GAMES[0].id;
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
        <h1>${state.roomEmoji || '🎲'} ${state.roomName || 'Table ouverte'}</h1>
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
                  <span>${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''}${p.id === state.hostId ? ' <span class="tag">hôte</span>' : ''}${p.id === player.id ? ' <span class="tag tag--you">toi</span>' : ''}</span>
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
                    (g) => `
                      <label class="game-picker__option">
                        <input type="radio" name="game" value="${g.id}" ${g.id === selectedGameId ? 'checked' : ''} />
                        <span>${g.label}<br/><small>${g.hint}</small></span>
                      </label>`
                  ).join('')}
                </div>
              </div>
              <button id="btn-start" class="btn btn--primary"></button>`
            : ''
        }
        <p class="lobby-card__rename-hint">Ce n'est pas ${me?.name || 'toi'} ? Change de prénom dans les réglages ⚙️ (en haut à droite).</p>
        <button class="btn btn--link" id="btn-leave">Quitter la table</button>
      </div>
    </div>
  `;

  const startBtn = container.querySelector('#btn-start');
  const updateStartButton = () => {
    if (!startBtn) return;
    const selectedId = container.querySelector('input[name="game"]:checked')?.value;
    const game = AVAILABLE_GAMES.find((g) => g.id === selectedId) || AVAILABLE_GAMES[0];
    const canStart = state.players.length >= game.minPlayers;
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart
      ? `Lancer la partie (${state.players.length} joueur${state.players.length > 1 ? 's' : ''})`
      : `En attente (minimum ${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''})`;
  };
  updateStartButton();
  container.querySelectorAll('input[name="game"]').forEach((r) =>
    r.addEventListener('change', () => {
      selectedGameIdByRoom = { roomId: room.id, gameId: r.value };
      updateStartButton();
    })
  );

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

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });

  container.querySelectorAll('.player-list__kick').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.kickId;
      const target = state.players.find((p) => p.id === id);
      if (target?.isBot || window.confirm(`Retirer ${target?.name || 'ce joueur'} de la table ?`)) onKick?.(id);
    });
  });
}

/**
 * Vue lecture seule d'une partie en cours, pour quelqu'un qui n'y participe pas
 * (arrivé après le lancement, ou en attente de la manche suivante). Volontairement
 * simplifiée par rapport à la table "joueur" (pas de main perso à afficher, pas
 * besoin de gérer les cas où le spectateur ne fait pas partie de `state.players`).
 */

/** Statut lisible d'un joueur en vue spectateur, tous jeux confondus. */
function spectatorPlayerStatus(game, state, p, isTrouduc) {
  if (p.finished) return isTrouduc ? trouducRankLabel(p.rank) : 'sorti·e';
  if (p.laidDown) return 'Posé ✓';
  if (game === 'luckynumbers' && Array.isArray(p.board)) {
    const empty = p.board.filter((c) => !c).length;
    return `${16 - empty}/16 cases`;
  }
  if (game === 'skyjo' && Array.isArray(p.grid)) {
    const faceUp = p.grid.filter((c) => c && c.faceUp).length;
    return `${faceUp}/12 retournées · ${p.score ?? 0} pts`;
  }
  if (game === 'suiteinfernale' && Array.isArray(p.sequence)) {
    return `${p.sequence.filter(Boolean).length}/${SUITE_INFERNALE_TARGET}`;
  }
  if (game === 'flip7' && Array.isArray(p.display)) {
    return `${p.display.length} carte${p.display.length > 1 ? 's' : ''} · ${p.score ?? 0} pts`;
  }
  if (Array.isArray(p.hand)) {
    return `${p.hand.length} carte${p.hand.length > 1 ? 's' : ''}${p.score != null ? ` · ${p.score} pts` : ''}`;
  }
  return p.score != null ? `${p.score} pts` : 'en jeu';
}

/** Aperçu optionnel des cartes en vue spectateur (si le jeu en a). */
function spectatorHandHtml(game, state, p, reveal) {
  if (!reveal) return '';
  if (game === 'luckynumbers' && Array.isArray(p.board)) {
    const cells = p.board.map((t) =>
      t
        ? `<span class="spectator-lucky-cell">${t.value}</span>`
        : `<span class="spectator-lucky-cell spectator-lucky-cell--empty">·</span>`
    ).join('');
    return `<div class="spectator-player__hand spectator-player__hand--lucky">${cells}</div>`;
  }
  if (Array.isArray(p.laidCards) && p.laidCards.length) {
    return `<div class="spectator-player__hand">${p.laidCards.map(cardFaceHtml).join('')}</div>`;
  }
  if (Array.isArray(p.hand) && p.hand.length) {
    return `<div class="spectator-player__hand">${p.hand.map(cardFaceHtml).join('')}</div>`;
  }
  return '';
}

export function renderSpectatorGame(container, { room, gameLabel, onBackToRooms }) {
  const state = room.state;
  const isTrouduc = room.game === 'trouduc';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;
  // Jeux de plateau / info ouverte : tout est déjà visible, pas de bouton masquer.
  const openInfoGame = room.game === 'luckynumbers' || room.game === 'flip7';
  const revealHands = getRevealHands();
  const showBoards = openInfoGame || revealHands;

  const pileHtml = isTrouduc
    ? state.pileCount > 0
      ? `<div class="trouduc-pile trouduc-pile--active">
           <div class="trouduc-pile__cards">${state.pile.map(cardFaceHtml).join('')}</div>
           <p class="trouduc-pile__label">${state.pileCount} × ${state.pileRank}${state.rankLocked ? ' <span class="pile__locked">🔒</span>' : ''}</p>
         </div>`
      : `<p class="trouduc-pile__empty">Pli libre</p>`
    : '';

  // Lucky Numbers : pioche / défausse visibles aussi en spectateur
  const luckyCenterHtml =
    room.game === 'luckynumbers'
      ? `<div class="lucky-draw-area spectator-lucky-center">
           <div class="lucky-pile">
             <div class="lucky-cell lucky-cell--back">🍀</div>
             <span class="lucky-pile__label">Pioche (${state.stock?.length ?? 0})</span>
           </div>
           <div class="lucky-discard-row">
             <span class="lucky-discard-label">Défausse</span>
             <div class="lucky-discard-list">
               ${(state.discard || [])
                 .map((t) => `<span class="lucky-discard-tile" style="cursor:default">${t.value}</span>`)
                 .join('') || '<span class="lucky-discard-empty">Aucune</span>'}
             </div>
           </div>
           ${
             state.drawnTile
               ? `<div class="lucky-pile lucky-pile--drawn">
                    <div class="lucky-cell lucky-cell--tile lucky-cell--drawn">${state.drawnTile.value}</div>
                    <span class="lucky-pile__label">Piochée</span>
                  </div>`
               : ''
           }
         </div>`
      : '';

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Tu regardes — ${gameLabel || 'partie'} en cours</p>
        <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>

        ${luckyCenterHtml}

        <ul class="spectator-players">
          ${state.players
            .map((p) => {
              const isTurn = p.id === state.currentPlayerId;
              const status = spectatorPlayerStatus(room.game, state, p, isTrouduc);
              const roleLabel = p.role ? `${p.role} · ` : '';
              const handHtml = spectatorHandHtml(room.game, state, p, showBoards);
              return `
                <li class="spectator-player ${isTurn ? 'spectator-player--turn' : ''}">
                  <div class="spectator-player__row">
                    <span class="spectator-player__name">${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''}</span>
                    <span class="spectator-player__status">${roleLabel}${status}</span>
                  </div>
                  ${handHtml}
                </li>`;
            })
            .join('')}
        </ul>

        ${
          openInfoGame
            ? ''
            : `<button id="btn-toggle-reveal" class="btn btn--ghost btn--small">${revealHands ? 'Masquer les mains' : 'Afficher les mains'}</button>`
        }

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
    toggleRevealHands();
    renderSpectatorGame(container, { room, gameLabel, onBackToRooms });
  });

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => {
    onBackToRooms?.();
  });
}
