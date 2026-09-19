import { cardFaceHtml, cardBackHtml } from './cards.js';
import {
  AVAILABLE_GAMES,
  startGame,
  claimHost,
  addBot,
  removeBot,
  toggleSpectator,
  setRoomGame,
  syncBotCount,
  HOST_STALE_MS,
  playerCountAllowed,
  replaceBotWithPlayer
} from '../game/engine.js';
import { rankLabel as trouducRankLabel } from '../game/trouduc.js';
import { SEQUENCE_TARGET as SUITE_INFERNALE_TARGET } from '../game/suiteinfernale.js';
import { connectionBadge, resetRevealHands, shareInviteLink, threeDToggleHtml, wireThreeDToggle } from './gameShared.js';
import { trioCardHtml, trioRowHtml, trioTrophiesHtml, trioJitter } from './games/trio.js';
import { suiteInfernaleSequenceHtml } from './games/suiteinfernale.js';
import { flip7CardHtml } from './games/flip7.js';
import { skyjoGridHtml } from './games/skyjo.js';
import { unoCardHtml } from './games/uno.js';
import { gameCoverImage } from './gameCovers.js';

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
 * Cache toute scène 3D encore affichée par un jeu (propriété `hide3D`,
 * optionnelle sur son module — voir "Refonte graphique 3D" dans README) —
 * appelé au tout début de chaque rendu (main.js:draw) pour qu'un canvas
 * WebGL persistant ne reste jamais visible en regardant autre chose, quel
 * que soit le chemin de navigation emprunté (salle d'attente, spectateur,
 * autre salon...). Générique comme resetSelection ci-dessous : ce fichier ne
 * sait pas lequel des jeux implémente ce hook — un jeu s'y "inscrit" juste en
 * exportant `hide3D` depuis son propre src/ui/games/<id>.js.
 */
export function hideAllThreeDScenes() {
  Object.values(GAME_UI).forEach((mod) => mod.hide3D?.());
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

// Signature (salon + jeu + humains actifs) vue au dernier rendu où CET
// appareil était hôte — permet de ne déclencher l'auto-ajustement des bots
// (syncBotCount) que lors d'un vrai changement de composition (arrivée,
// départ, bascule spectateur, changement de jeu), jamais à un simple
// re-rendu, pour ne jamais écraser un ajustement manuel (+/-) fait
// entre-temps. Le jeu du salon vit désormais sur `room.game` (persisté,
// visible de tous) — plus de mémoire locale de sélection à part.
let botAutoSignatureByRoom = null;

function renderWaitingRoom(container, { room, player, onLeave, onKick }) {
  const state = room.state;
  const selectedGameId = room.game;
  const isHost = state.hostId === player.id;
  const activeCount = state.players.filter((p) => !p.spectator).length;

  if (isHost) {
    const signature = `${room.id}|${selectedGameId}|${activeCount}`;
    if (botAutoSignatureByRoom !== signature) {
      botAutoSignatureByRoom = signature;
      syncBotCount(room).catch(() => {});
    }
  }

  const currentHost = state.players.find((p) => p.id === state.hostId);
  const hostIsBot = currentHost?.isBot === true;
  const hostMissing = !state.hostId || !currentHost;
  const hostIsStale = !hostIsBot && Date.now() - (state.hostLastSeen || 0) > HOST_STALE_MS;
  const hostUnavailable = hostMissing || hostIsBot || hostIsStale;

  container.innerHTML = `
    <div class="screen screen--waiting">
      <div class="lobby-card">
        <div class="lobby-card__heading">
          <h1>${state.roomEmoji || '🎲'} Salon ${state.roomName || 'ouvert'}</h1>
          <button class="lobby-card__close" id="btn-leave" title="Quitter la table" aria-label="Quitter la table">✕</button>
        </div>
        <p class="lobby-card__intro">
          ${
            hostIsBot
              ? "L'hôte est un bot — quelqu'un doit reprendre la main pour lancer la partie."
              : hostMissing || hostIsStale
                ? "L'hôte n'est plus là — tu peux reprendre la main."
                : isHost
                  ? "Attends que les autres arrivent, choisis le jeu, puis lance la partie."
                  : "En attente que l'hôte lance la partie…"
          }
        </p>

        <button type="button" class="btn btn--ghost btn--small" id="btn-invite">📤 Inviter un ami</button>

        <ul class="player-list">
          ${state.players
            .map(
              (p) => `
                <li class="player-chip ${p.spectator ? 'player-chip--spectator' : ''}">
                  <span class="player-chip__name">${p.name}${connectionBadge(state, p.id)}${p.isBot ? ' 🤖' : ''}</span>
                  ${p.id === state.hostId ? '<span class="tag">hôte</span>' : ''}${p.id === player.id ? '<span class="tag tag--you">toi</span>' : ''}
                  ${
                    !p.isBot
                      ? `<label class="player-chip__spectator" title="Regarder sans jouer">
                          <input type="checkbox" data-spectator-id="${p.id}" ${p.spectator ? 'checked' : ''} ${p.id !== player.id ? 'disabled' : ''} />
                          spectateur·rice
                        </label>`
                      : ''
                  }
                  ${isHost && p.id !== player.id ? `<button class="player-chip__kick" data-kick-id="${p.id}" title="Retirer ${p.name}" aria-label="Retirer ${p.name}">✕</button>` : ''}
                </li>`
            )
            .join('')}
        </ul>

        ${hostUnavailable && !isHost ? `<button class="btn btn--ghost btn--small" id="btn-claim-host">Devenir l'hôte</button>` : ''}

        ${
          isHost
            ? `
              <div class="bot-counter">
                <p class="bot-counter__label">${state.players.filter((p) => p.isBot).length} bot${state.players.filter((p) => p.isBot).length > 1 ? 's' : ''} pour compléter la table</p>
                <div class="bot-counter__controls">
                  <button type="button" class="btn btn--ghost btn--small" id="btn-bot-minus" ${state.players.filter((p) => p.isBot).length <= 0 ? 'disabled' : ''} aria-label="Un bot de moins">−</button>
                  <button type="button" class="btn btn--ghost btn--small" id="btn-bot-plus" ${state.players.length >= 6 ? 'disabled' : ''} aria-label="Un bot de plus">+</button>
                </div>
              </div>`
            : ''
        }

        ${
          isHost
            ? `
              <div class="game-picker">
                <p class="game-picker__label">Quel jeu ?</p>
                <div class="game-picker__options">
                  ${AVAILABLE_GAMES.map((g) => {
                    const cover = gameCoverImage(g.id);
                    return `
                      <button type="button" class="game-picker__option ${cover ? 'game-picker__option--cover' : ''} ${g.id === selectedGameId ? 'game-picker__option--selected' : ''}" data-pick-game="${g.id}" title="${g.label} — ${g.hint}">
                        ${
                          cover
                            ? `<span class="game-picker__art" style="background-image:url('${cover}')"></span>`
                            : `<span class="game-picker__fallback"><span class="game-picker__fallback-label">${g.label}</span><small>${g.hint}</small></span>`
                        }
                      </button>`;
                  }).join('')}
                </div>
              </div>
              <button id="btn-start" class="btn btn--primary"></button>`
            : ''
        }
      </div>
    </div>
  `;

  const startBtn = container.querySelector('#btn-start');
  const updateStartButton = () => {
    if (!startBtn) return;
    const game = AVAILABLE_GAMES.find((g) => g.id === selectedGameId) || AVAILABLE_GAMES[0];
    const maxPlayers = game.maxPlayers || 6;
    const canStart = playerCountAllowed(game.id, activeCount);
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart
      ? `Lancer la partie (${activeCount} joueur${activeCount > 1 ? 's' : ''})`
      : activeCount > maxPlayers
        ? `Trop de joueurs pour ${game.label} (max ${maxPlayers}) — passe en spectateur ou change de jeu`
        : `En attente (${game.hint})`;
  };
  updateStartButton();

  container.querySelector('#btn-start')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await startGame(room, selectedGameId);
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

  container.querySelector('#btn-bot-plus')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await addBot(room);
    } catch (err) {
      alert(err.message || "Impossible d'ajouter un bot.");
    } finally {
      e.target.disabled = false;
    }
  });

  container.querySelector('#btn-bot-minus')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await removeBot(room);
    } catch (err) {
      alert(err.message || 'Impossible de retirer ce bot.');
    } finally {
      e.target.disabled = false;
    }
  });

  container.querySelectorAll('[data-pick-game]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.pickGame === selectedGameId) return;
      container.querySelectorAll('[data-pick-game]').forEach((b) => (b.disabled = true));
      try {
        const label = AVAILABLE_GAMES.find((g) => g.id === btn.dataset.pickGame)?.label || btn.dataset.pickGame;
        await setRoomGame(room, btn.dataset.pickGame, label);
      } catch (err) {
        alert(err.message || 'Impossible de changer de jeu.');
        container.querySelectorAll('[data-pick-game]').forEach((b) => (b.disabled = false));
      }
    });
  });

  container.querySelectorAll('[data-spectator-id]').forEach((cb) => {
    cb.addEventListener('click', async (e) => {
      if (cb.dataset.spectatorId !== player.id) {
        e.preventDefault(); // sécurité : jamais actionnable pour un autre joueur (déjà désactivé, voir disabled ci-dessus)
        return;
      }
      cb.disabled = true;
      try {
        await toggleSpectator(room, player.id);
      } catch (err) {
        cb.disabled = false;
        alert(err.message || 'Impossible de changer de statut.');
      }
    });
  });

  container.querySelector('#btn-leave')?.addEventListener('click', () => {
    if (window.confirm('Quitter la table ?')) onLeave?.();
  });

  container.querySelector('#btn-invite')?.addEventListener('click', () => shareInviteLink(room));

  container.querySelectorAll('.player-chip__kick').forEach((btn) => {
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
  if (game === 'trio' && Array.isArray(p.trios)) {
    return `${p.trios.length} trio${p.trios.length > 1 ? 's' : ''} · ${p.row.length} en main`;
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
  if (game === 'flip7' && Array.isArray(p.display)) {
    return `<div class="flip7-hand">${p.display.map(flip7CardHtml).join('') || '<span class="spectator-player__empty">—</span>'}</div>`;
  }
  if (game === 'skyjo' && Array.isArray(p.grid)) {
    return skyjoGridHtml(p.grid);
  }
  // La suite est déjà publique en jeu réel (visible de tous, sans bouton
  // "afficher") — jamais la main privée (`p.hand`), qui tomberait sinon dans
  // le repli générique `Array.isArray(p.hand)` juste en dessous.
  if (game === 'suiteinfernale' && Array.isArray(p.sequence)) {
    return suiteInfernaleSequenceHtml(p.sequence);
  }
  // La rangée du Trio se rend toujours face cachée (sauf cartes révélées
  // dans la tentative en cours) — `trioRowHtml` gère déjà cette visibilité
  // carte par carte, rien à cacher ici derrière le bouton "afficher".
  if (game === 'trio' && Array.isArray(p.row)) {
    const revealedIds = new Set((state.pendingReveals || []).map((r) => r.source.cardId));
    return trioRowHtml(p.row, { revealedIds, alwaysFaceUp: state.status === 'finished' });
  }
  if (game === 'blackjack' && Array.isArray(p.hands)) {
    const html = p.hands
      .map((h) => `<div class="blackjack-hand">${(h.cards || []).map(cardFaceHtml).join('')}</div>`)
      .join('');
    return `<div class="spectator-player__hand">${html}</div>`;
  }
  if (Array.isArray(p.laidCards) && p.laidCards.length) {
    return `<div class="spectator-player__hand">${p.laidCards.map(cardFaceHtml).join('')}</div>`;
  }
  if (Array.isArray(p.hand) && p.hand.length) {
    return `<div class="spectator-player__hand">${p.hand.map(cardFaceHtml).join('')}</div>`;
  }
  return '';
}

export function renderSpectatorGame(container, { room, player, gameLabel, onBackToRooms }) {
  const spectatorArgs = { room, player, gameLabel, onBackToRooms };
  const mod = GAME_UI[room.game];
  // Hook optionnel (même esprit que hide3D) : un jeu 3D peut prendre la
  // main pour une orbite libre autour de la table. `false`/absent = 2D.
  if (
    mod?.renderSpectator?.(container, {
      ...spectatorArgs,
      onRerender: () => renderSpectatorGame(container, spectatorArgs)
    })
  ) {
    return;
  }
  const state = room.state;
  const isTrouduc = room.game === 'trouduc';
  const currentName = state.players.find((p) => p.id === state.currentPlayerId)?.name;
  // Jeux de plateau / info ouverte : déjà entièrement visible d'un vrai
  // joueur en partie (mains adverses publiques, ou plateau qui gère lui-même
  // la visibilité carte par carte comme Skyjo/Trio). Pour les autres (main
  // privée en vrai jeu), le spectateur ne voit que le public — plus de bouton
  // pour tricher et regarder les mains cachées, surtout maintenant qu'il peut
  // rejoindre la partie en prenant la place d'un bot (voir plus bas).
  const openInfoGame = ['luckynumbers', 'flip7', 'blackjack', 'skyjo', 'suiteinfernale', 'trio', 'boop'].includes(room.game);
  const showBoards = openInfoGame;

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

  // Trio : le centre (cartes piochables par tous) est l'essentiel du plateau
  // — sans lui la vue spectateur ne montre que des noms, rien de la partie.
  // Même logique de visibilité carte par carte que `renderTrioTable`.
  const trioCenterHtml =
    room.game === 'trio' && Array.isArray(state.center)
      ? (() => {
          const revealedIds = new Set((state.pendingReveals || []).map((r) => r.source.cardId));
          const cells = state.center
            .map((c) => {
              const jitter = trioJitter(c.id);
              if (c.taken) return `<div class="trio-cell trio-cell--gone" style="transform: rotate(${jitter.angle}deg) translateY(${jitter.offsetY}px);"></div>`;
              const faceUp = revealedIds.has(c.id) || state.status === 'finished';
              return trioCardHtml(c.value, { faceUp, jitter });
            })
            .join('');
          return `<div class="trio-center"><p class="trio-center__label">Centre</p><div class="trio-row">${cells}</div></div>`;
        })()
      : '';

  // Blackjack : la banque n'est pas un "joueur" de `state.players`, donc
  // invisible sans ce bloc dédié — même règle de carte cachée qu'en jeu réel.
  const blackjackDealerHtml =
    room.game === 'blackjack' && state.dealer
      ? `<div class="blackjack-dealer">
           <p class="blackjack-dealer__label">🏦 Banque</p>
           <div class="blackjack-hand">${
             state.dealer.hidden ? cardFaceHtml(state.dealer.hand[0]) + cardBackHtml() : state.dealer.hand.map(cardFaceHtml).join('')
           }</div>
         </div>`
      : '';

  // 8 américain / Uno : la carte du dessus de la défausse (ce que tout le
  // monde doit suivre) — pas l'historique empilé animé de la vue joueur,
  // une simple carte suffit à comprendre l'état de la partie.
  const topDiscardCard = state.discard?.length ? state.discard[state.discard.length - 1] : null;
  const discardTopHtml =
    topDiscardCard && (room.game === 'americain' || room.game === 'uno')
      ? `<div class="trouduc-pile trouduc-pile--active">
           <div class="trouduc-pile__cards">${room.game === 'uno' ? unoCardHtml(topDiscardCard) : cardFaceHtml(topDiscardCard)}</div>
           <p class="trouduc-pile__label">Défausse</p>
         </div>`
      : '';

  container.innerHTML = `
    <div class="screen screen--table">
      <div class="table-felt">
        <p class="eyebrow">Tu regardes — ${gameLabel || 'partie'} en cours</p>
        <button class="btn btn--link btn--small" id="btn-back-to-rooms">← Retour aux salons</button>
        ${mod?.renderSpectator ? threeDToggleHtml(room.game) : ''}

        ${luckyCenterHtml}
        ${trioCenterHtml}
        ${blackjackDealerHtml}

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
                  ${
                    p.isBot
                      ? `<button class="btn btn--ghost btn--small" data-replace-bot-id="${p.id}">Prendre la place de ${p.name}</button>`
                      : ''
                  }
                  ${handHtml}
                </li>`;
            })
            .join('')}
        </ul>

        ${pileHtml}
        ${discardTopHtml}

        <div class="turn-banner">${currentName ? `Tour de ${currentName}` : 'En attente…'}</div>
      </div>

      <details class="log" open>
        <summary>Journal de la partie</summary>
        <ul>${state.log.slice().reverse().map((l) => `<li>${l.message}</li>`).join('')}</ul>
      </details>
    </div>
  `;

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => {
    onBackToRooms?.();
  });
  if (mod?.renderSpectator) {
    wireThreeDToggle(container, room.game, () => renderSpectatorGame(container, spectatorArgs));
  }

  container.querySelectorAll('[data-replace-bot-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await replaceBotWithPlayer(room, btn.dataset.replaceBotId, player);
        // La suite (passage à la vue joueur normale) se fait toute seule au
        // prochain rendu réactif — voir draw() dans main.js, qui bascule dès
        // que le profil local apparaît dans state.players.
      } catch (err) {
        btn.disabled = false;
        btn.textContent = `Prendre la place de ce bot`;
        alert(err.message || 'Impossible de remplacer ce bot.');
      }
    });
  });
}
