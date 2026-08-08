// Chaque jeu porte ses propres règles dans src/game/<id>.rules.js (title +
// html exportés). Découverts dynamiquement : ajouter un jeu = ajouter ce
// fichier, rien à modifier ici.
const ruleModules = import.meta.glob('../game/*.rules.js', { eager: true });

const RULES = {};
for (const path in ruleModules) {
  const id = path.match(/([^/]+)\.rules\.js$/)?.[1];
  if (id) RULES[id] = { title: ruleModules[path].title, html: ruleModules[path].html };
}

export function openRulesModal(gameId) {
  const rules = RULES[gameId];
  if (!rules) return;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-modal rules-modal" role="dialog" aria-modal="true" aria-label="Règles — ${rules.title}">
      <div class="settings-modal__header">
        <h2>Règles — ${rules.title}</h2>
        <button type="button" class="settings-modal__close" aria-label="Fermer">✕</button>
      </div>
      <div class="rules-modal__content">${rules.html}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.settings-modal__close').addEventListener('click', close);
}
