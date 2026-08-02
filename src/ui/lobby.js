/**
 * Affiché quand quelqu'un arrive (ou revient) alors qu'une partie est déjà en
 * cours et qu'il n'en fait pas partie : on ne peut pas le faire rejoindre au
 * milieu, donc on attend la fin de la manche. Se met à jour tout seul (appelé à
 * chaque changement d'état via l'abonnement temps réel), pas besoin de bouton.
 */
export function renderSpectatorWait(container, { room, gameLabel } = {}) {
  const state = room.state;
  const playerNames = state.players.map((p) => p.name).join(', ');

  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Partie en cours</h1>
        <p class="lobby-card__intro">
          ${gameLabel || 'Une partie'} est en cours (${state.players.length} joueur${state.players.length > 1 ? 's' : ''}${playerNames ? ` : ${playerNames}` : ''}).
          Tu pourras rejoindre dès la fin de cette manche — cette page se met à jour toute seule, pas besoin de recharger.
        </p>
      </div>
    </div>
  `;
}

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
 * `onSubmit(name)` doit créer l'identité locale et rejoindre la table familiale.
 */
export function renderNamePrompt(container, { onSubmit } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>Le Pouilleux</h1>
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
