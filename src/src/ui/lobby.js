/**
 * Affiché après qu'un joueur ait quitté la table : lui permet d'y revenir
 * facilement, sans re-saisir son prénom (déjà mémorisé sur l'appareil).
 */
export function renderLeftTable(container, { name, onRejoin } = {}) {
  container.innerHTML = `
    <div class="screen screen--lobby">
      <div class="lobby-card">
        <p class="eyebrow">Cartes en famille</p>
        <h1>À plus, ${name} !</h1>
        <p class="lobby-card__intro">Tu as quitté la table. Reviens quand tu veux.</p>
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
