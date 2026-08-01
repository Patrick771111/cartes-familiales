import { hostNewRoom, joinRoom } from '../game/engine.js';

/**
 * Affiche l'écran d'accueil dans `container`.
 * `onEntered(room, player)` est appelé une fois qu'on a rejoint/créé une salle.
 * `prefillCode` pré-remplit le champ code (ex: depuis un lien partagé ?room=XXXX).
 */
export function renderLobby(container, { onEntered, prefillCode = '' } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Le Pouilleux</h1>
        <p class="lobby-card__intro">
          Créez une table ou rejoignez celle d'un proche avec son code à 4 lettres.
        </p>

        <form id="form-create" class="lobby-form">
          <label for="create-name">Votre prénom</label>
          <input id="create-name" name="name" type="text" placeholder="Ex : Patrick" required maxlength="20" autocomplete="off" />
          <button type="submit" class="btn btn--primary">Créer une table</button>
        </form>

        <div class="lobby-divider"><span>ou</span></div>

        <form id="form-join" class="lobby-form">
          <label for="join-code">Code de la table</label>
          <input id="join-code" name="code" type="text" placeholder="Ex : R7QK" required maxlength="4"
                 value="${prefillCode}" autocomplete="off" style="text-transform:uppercase" />
          <label for="join-name">Votre prénom</label>
          <input id="join-name" name="name" type="text" placeholder="Ex : Joëlle" required maxlength="20" autocomplete="off" />
          <button type="submit" class="btn btn--ghost">Rejoindre</button>
        </form>

        <p id="lobby-error" class="lobby-error" hidden></p>
      </div>
    </div>
  `;

  const errorEl = container.querySelector('#lobby-error');
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  container.querySelector('#form-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const name = e.target.name.value.trim();
    if (!name) return;
    const submitBtn = e.target.querySelector('button');
    submitBtn.disabled = true;
    try {
      const room = await hostNewRoom(name);
      const player = room.state.players[0];
      onEntered(room, player);
    } catch (err) {
      showError(err.message || 'Impossible de créer la table.');
      submitBtn.disabled = false;
    }
  });

  container.querySelector('#form-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const code = e.target.code.value.trim().toUpperCase();
    const name = e.target.name.value.trim();
    if (!code || !name) return;
    const submitBtn = e.target.querySelector('button');
    submitBtn.disabled = true;
    try {
      const { room, player } = await joinRoom(code, name);
      onEntered(room, player);
    } catch (err) {
      showError(err.message || 'Impossible de rejoindre cette table.');
      submitBtn.disabled = false;
    }
  });
}
