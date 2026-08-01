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
