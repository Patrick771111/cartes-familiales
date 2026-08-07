import { AVAILABLE_GAMES } from '../game/engine.js';

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
 * Écran "salons" : liste des tables actives, avec la possibilité d'en
 * rejoindre une ou d'en créer une nouvelle. Nouveau point d'entrée après le
 * prénom (remplace l'ancienne salle familiale unique).
 */
export function renderRoomList(container, { rooms, onJoinRoom, onCreateRoom } = {}) {
  const statusLabel = (status) => (status === 'lobby' ? 'En attente' : status === 'finished' ? 'Manche terminée' : 'En cours');
  const joinLabel = (status) => (status === 'lobby' ? 'Rejoindre' : 'Regarder');
  const gameTypeLabel = (r) => (r.status === 'lobby' ? 'Salon en attente' : AVAILABLE_GAMES.find((g) => g.id === r.game)?.label || r.game);

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
