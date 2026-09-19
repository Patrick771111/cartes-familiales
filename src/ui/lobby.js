import { AVAILABLE_GAMES } from '../game/engine.js';
import { gameCoverImage } from './gameCovers.js';

/**
 * Affiché après qu'un joueur ait quitté la table : lui permet d'y revenir
 * facilement, sans re-saisir son prénom (déjà mémorisé sur l'appareil).
 */
export function renderLeftTable(container, { name, onRejoin, wasWaiting = false } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>${wasWaiting ? 'Manche terminée !' : `À plus, ${name} !`}</h1>
        <p class="lobby-card__intro">${wasWaiting ? 'Tu peux rejoindre la table pour la suite.' : 'Tu as quitté la table. Reviens quand tu veux.'}</p>
        <button id="btn-rejoin" class="btn btn--primary">Revenir à la table</button>
        <p id="rejoin-error" class="lobby-error" hidden></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#rejoin-error');

  container.querySelector('#btn-rejoin').addEventListener('click', async (e) => {
    errorEl.hidden = true;
    e.target.disabled = true;
    try {
      await onRejoin();
    } catch (err) {
      errorEl.textContent = err.message || 'Impossible de revenir pour le moment.';
      errorEl.hidden = false;
      e.target.disabled = false;
    }
  });
}

/**
 * Écran affiché une seule fois par appareil : demande juste le prénom.
 * `onSubmit(name)` doit créer l'identité locale, puis afficher l'écran des
 * salons (voir `renderRoomList`) — le prénom est propre à l'appareil, pas à
 * un salon en particulier.
 */
export function renderNamePrompt(container, { onSubmit } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Bienvenue</h1>
        <p class="lobby-card__intro">
          Comment tu t'appelles ? On ne te redemandera plus sur cet appareil.
        </p>

        <form id="form-name" class="lobby-form">
          <input id="name-input" name="name" type="text" placeholder="Ton prénom" required maxlength="20" autocomplete="off" autofocus />
          <button type="submit" class="btn btn--primary">C'est parti</button>
        </form>

        <p id="name-error" class="lobby-error" hidden></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#name-error');

  container.querySelector('#form-name').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const name = e.target.name.value.trim();
    if (!name) return;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await onSubmit(name);
    } catch (err) {
      errorEl.textContent = err.message || 'Une erreur est survenue.';
      errorEl.hidden = false;
      btn.disabled = false;
    }
  });
}

/**
 * Écran de sélection du jeu avant création d'un salon : jaquettes
 * `AVAILABLE_GAMES`/`gameCoverImage`, similaire à celui de la salle
 * d'attente mais sans logique de validation d'effectif (l'hôte
 * choisit avant de créer). `onSelect(gameId)` crée le salon.
 */
export function renderGamePicker(container, { onSelect } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Choisis ton jeu</h1>
        <p class="lobby-card__intro">Le jeu choisi sera visible par tout le monde dès la création du salon.</p>

        <div class="game-picker">
          <div class="game-picker__options">
            ${AVAILABLE_GAMES.map((g) => {
              const cover = gameCoverImage(g.id);
              return `
                <label class="game-picker__option ${cover ? 'game-picker__option--cover' : ''}">
                  <input type="radio" name="game" value="${g.id}" ${g.id === AVAILABLE_GAMES[0].id ? 'checked' : ''} />
                  ${
                    cover
                      ? `<span class="game-picker__art" style="background-image:url('${cover}')"></span>`
                      : `<span class="game-picker__fallback"><span class="game-picker__fallback-label">${g.label}</span><small>${g.hint}</small></span>`
                  }
                </label>`;
            }).join('')}
          </div>
        </div>

        <button id="btn-confirm-game" class="btn btn--primary">Créer le salon</button>
        <button id="btn-back-to-rooms" class="btn btn--ghost">← Retour</button>
        <p id="game-picker-error" class="lobby-error" hidden></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#game-picker-error');
  const showError = (err, fallback) => {
    errorEl.textContent = err.message || fallback;
    errorEl.hidden = false;
  };

  container.querySelector('#btn-confirm-game')?.addEventListener('click', async (e) => {
    const selected = container.querySelector('input[name="game"]:checked')?.value;
    if (!selected) {
      showError(null, 'Choisis un jeu.');
      return;
    }
    e.target.disabled = true;
    try {
      await onSelect(selected);
    } catch (err) {
      e.target.disabled = false;
      showError(err, "Impossible de créer le salon.");
    }
  });

  container.querySelector('#btn-back-to-rooms')?.addEventListener('click', () => {
    backToRoomList();
  });
}

/** Retourne à l'écran des salons (utilisé par renderGamePicker). */
function backToRoomList() {
  const btn = document.querySelector('#btn-create-room');
  if (btn) btn.click();
}

/**
 * Écran "salons" : liste des tables actives, avec la possibilité d'en
 * rejoindre une ou d'en créer une nouvelle. Nouveau point d'entrée après le
 * prénom (remplace l'ancienne salle familiale unique).
 */
export function renderRoomList(container, { rooms, onJoinRoom, onCreateRoom } = {}) {
  const statusLabel = (status) => (status === 'lobby' ? 'En attente' : status === 'finished' ? 'Manche terminée' : 'En cours');
  const joinLabel = (status) => (status === 'lobby' ? 'Rejoindre' : 'Regarder');
  const gameTypeLabel = (r) => {
    if (r.status !== 'lobby') return AVAILABLE_GAMES.find((g) => g.id === r.game)?.label || r.game;
    const g = AVAILABLE_GAMES.find((gg) => gg.id === r.game);
    return g ? `${g.label} (en attente)` : 'Salon en attente';
  };

  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Salons</h1>
        <p class="lobby-card__intro">
          ${rooms.length ? 'Rejoins un salon en cours, ou crée le tien.' : "Aucun salon ouvert pour l'instant — crée le premier."}
        </p>

        <ul class="room-list">
          ${rooms
            .map((r) => {
              const chips = r.players.length
                ? r.players.map((p) => `<span class="room-list__chip">${p.name}${p.isBot ? ' 🤖' : ''}</span>`).join('')
                : `<span class="room-list__chip room-list__chip--empty">personne pour l’instant</span>`;
              return `
                <li class="room-list__item">
                  <div class="room-list__info">
                    <p class="room-list__game">${r.roomEmoji || '🎲'} ${r.roomName || 'Salon'}</p>
                    <p class="room-list__meta">${gameTypeLabel(r)} · ${statusLabel(r.status)} · ${r.players.length} joueur${r.players.length > 1 ? 's' : ''}</p>
                    <div class="room-list__players">${chips}</div>
                  </div>
                  <button class="btn btn--primary btn--small" data-join-room="${r.id}">${joinLabel(r.status)}</button>
                </li>`;
            })
            .join('')}
        </ul>

        <button id="btn-create-room" class="btn btn--ghost">+ Créer un salon</button>
        <p id="room-list-error" class="lobby-error" hidden></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#room-list-error');
  const showError = (err, fallback) => {
    errorEl.textContent = err.message || fallback;
    errorEl.hidden = false;
  };

  container.querySelectorAll('[data-join-room]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      errorEl.hidden = true;
      btn.disabled = true;
      try {
        await onJoinRoom(btn.dataset.joinRoom);
      } catch (err) {
        showError(err, 'Impossible de rejoindre ce salon.');
        btn.disabled = false;
      }
    });
  });

  container.querySelector('#btn-create-room')?.addEventListener('click', async (e) => {
    errorEl.hidden = true;
    e.target.disabled = true;
    try {
      await onCreateRoom();
    } catch (err) {
      showError(err, 'Impossible de créer un salon.');
      e.target.disabled = false;
    }
  });
}
