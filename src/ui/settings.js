import { cardFaceHtml } from './cards.js';

const STORAGE_KEY = 'cartes-familiales:settings';

export const FELT_THEMES = [
  { id: 'foret', label: 'Forêt', felt500: '#2B5A42', felt700: '#173D2C' },
  { id: 'ocean', label: 'Océan', felt500: '#1F5C73', felt700: '#0F3547' },
  { id: 'bordeaux', label: 'Bordeaux', felt500: '#6B2338', felt700: '#3D1220' },
  { id: 'ardoise', label: 'Ardoise', felt500: '#3E4650', felt700: '#20242B' },
  { id: 'aubergine', label: 'Aubergine', felt500: '#4B2E63', felt700: '#271836' }
];

export const CARD_THEMES = [
  { id: 'classique', label: 'Classique', hint: 'Pips et figures dessinés, sobre.' },
  { id: 'autoBrands', label: 'Marques auto', hint: 'Une marque par famille, illustrée.' },
  { id: 'mascotte', label: 'Mascotte', hint: 'Croquis dessinés à la main pour les figures et les cartes spéciales.' }
];

/** Mode d'interaction commun à tous les jeux qui supportent le glisser-déposer. */
export const CARD_INTERACTIONS = [
  { id: 'drag', label: 'Glisser-déposer', hint: 'Souris ou doigt : glisse une carte vers sa cible. Un clic/tap court sélectionne encore.' },
  { id: 'tap', label: 'Cliquer / toucher', hint: 'Clique ou touche une carte, puis la cible (case, adversaire, bouton…).' }
];

export const SUITE_INFERNALE_INTERACTIONS = CARD_INTERACTIONS;

const DEFAULTS = { felt: 'foret', cardTheme: 'classique', cardInteraction: 'drag', render3d: {} };

/**
 * Préférence 2D/3D par jeu et par appareil — 2D par défaut partout. Générique
 * (clé = `gameId` quelconque) : ce module ne connaît aucun jeu en particulier,
 * c'est `src/ui/game.js` (`gameHasThreeDVersion`) qui sait, en lisant le
 * registre des jeux, LESQUELS ont effectivement une version 3D à proposer.
 */
export function is3DEnabled(gameId, settings = getSettings()) {
  return Boolean(settings.render3d?.[gameId]);
}

export function set3DEnabled(gameId, enabled) {
  return saveSettings({ render3d: { ...getSettings().render3d, [gameId]: enabled } });
}

/**
 * Préférence transverse : glisser-déposer actif (souris + tactile).
 * Migre l'ancienne clé `suiteInfernaleInteraction` si présente.
 */
export function isCardDragEnabled(settings = getSettings()) {
  const mode = settings.cardInteraction ?? settings.suiteInfernaleInteraction ?? 'drag';
  return mode !== 'tap';
}

/** @deprecated Utiliser isCardDragEnabled — alias conservé. */
export function isSuiteInfernaleDragEnabled(settings = getSettings()) {
  return isCardDragEnabled(settings);
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...parsed };
    if (parsed.suiteInfernaleInteraction && !parsed.cardInteraction) {
      merged.cardInteraction = parsed.suiteInfernaleInteraction;
    }
    if (merged.cardInteraction !== 'drag' && merged.cardInteraction !== 'tap') {
      merged.cardInteraction = DEFAULTS.cardInteraction;
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

/** Applique les préférences visuelles au document (variables CSS + attribut de thème). */
export function applySettings(settings = getSettings()) {
  const felt = FELT_THEMES.find((f) => f.id === settings.felt) || FELT_THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--felt-500', felt.felt500);
  root.style.setProperty('--felt-700', felt.felt700);
  root.dataset.cardTheme = CARD_THEMES.some((t) => t.id === settings.cardTheme) ? settings.cardTheme : DEFAULTS.cardTheme;
}

export function saveSettings(partial) {
  const next = { ...getSettings(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  applySettings(next);
  return next;
}

// Le changement de prénom vit dans main.js (il faut la table courante et le
// profil local pour propager le renommage via Supabase) : la modale de réglages
// s'y raccorde via ce petit contrôleur plutôt que d'importer engine.js ici.
let nameController = null;
export function setPlayerNameController(controller) {
  nameController = controller;
}

/** Petit bouton flottant, monté une fois pour toutes, qui ouvre la modale de réglages
 * depuis n'importe quel écran (salle d'attente, table de jeu, écran de fin…). */
export function mountSettingsButton() {
  if (document.getElementById('settings-fab')) return;
  const btn = document.createElement('button');
  btn.id = 'settings-fab';
  btn.className = 'settings-fab';
  btn.type = 'button';
  btn.setAttribute('aria-label', "Réglages d'affichage");
  btn.textContent = '⚙️';
  btn.addEventListener('click', () => openSettingsModal());
  document.body.appendChild(btn);
}

export function openSettingsModal() {
  const settings = getSettings();
  const currentName = nameController?.getName() || '';

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Réglages">
      <div class="settings-modal__header">
        <h2>Réglages</h2>
        <button type="button" class="settings-modal__close" aria-label="Fermer">✕</button>
      </div>

      ${
        currentName
          ? `<section class="settings-section">
               <p class="settings-section__label">Ton prénom</p>
               <div class="settings-name-row">
                 <input type="text" id="settings-name-input" class="settings-name-input" value="${currentName}" maxlength="24" />
                 <button type="button" id="settings-name-save" class="btn btn--ghost btn--small">Enregistrer</button>
               </div>
               <p class="settings-name-status" id="settings-name-status"></p>
             </section>`
          : ''
      }

      <section class="settings-section">
        <p class="settings-section__label">Couleur du tapis</p>
        <div class="settings-swatches">
          ${FELT_THEMES.map(
            (f) => `
            <button type="button" class="settings-swatch ${settings.felt === f.id ? 'settings-swatch--active' : ''}" data-felt="${f.id}" title="${f.label}">
              <span class="settings-swatch__dot" style="background:${f.felt500}; border-color:${f.felt700}"></span>
              <span class="settings-swatch__label">${f.label}</span>
            </button>`
          ).join('')}
        </div>
      </section>

      <section class="settings-section">
        <p class="settings-section__label">Style des cartes</p>
        <div class="settings-card-themes">
          ${CARD_THEMES.map(
            (t) => `
            <button type="button" class="settings-card-theme ${settings.cardTheme === t.id ? 'settings-card-theme--active' : ''}" data-card-theme-option="${t.id}">
              <span class="settings-card-theme__preview" data-card-theme="${t.id}">${cardFaceHtml({ id: `preview-${t.id}`, rank: 'K', suit: 'H' }, t.id)}</span>
              <span class="settings-card-theme__text">
                <strong>${t.label}</strong>
                <small>${t.hint}</small>
              </span>
            </button>`
          ).join('')}
        </div>
      </section>

      <section class="settings-section">
        <p class="settings-section__label">Jouer une carte</p>
        <div class="settings-card-themes">
          ${CARD_INTERACTIONS.map(
            (opt) => `
            <button type="button" class="settings-card-theme ${(settings.cardInteraction || 'drag') === opt.id ? 'settings-card-theme--active' : ''}" data-card-interaction-option="${opt.id}">
              <span class="settings-card-theme__text">
                <strong>${opt.label}</strong>
                <small>${opt.hint}</small>
              </span>
            </button>`
          ).join('')}
        </div>
      </section>

      <button type="button" id="settings-save-close" class="btn btn--primary settings-modal__save">Enregistrer et fermer</button>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.settings-modal__close').addEventListener('click', close);

  const nameInput = overlay.querySelector('#settings-name-input');
  const nameSaveBtn = overlay.querySelector('#settings-name-save');
  const nameStatus = overlay.querySelector('#settings-name-status');
  let trySaveName = async () => {};
  if (nameInput && nameSaveBtn && nameController) {
    trySaveName = async () => {
      const newName = nameInput.value.trim();
      if (!newName || newName === nameController.getName()) return;
      nameSaveBtn.disabled = true;
      nameStatus.textContent = '';
      try {
        await nameController.onChange(newName);
        nameStatus.textContent = 'Prénom mis à jour.';
      } catch (err) {
        nameStatus.textContent = err.message || 'Impossible de changer le prénom.';
      } finally {
        nameSaveBtn.disabled = false;
      }
    };
    nameSaveBtn.addEventListener('click', trySaveName);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') trySaveName();
    });
  }

  // Le tapis et le style de cartes s'appliquent déjà en direct au clic (pour
  // l'aperçu immédiat) ; ce bouton donne une confirmation explicite, ferme la
  // modale, et rattrape un prénom tapé mais pas encore validé par Entrée/son
  // propre bouton.
  overlay.querySelector('#settings-save-close').addEventListener('click', async () => {
    await trySaveName();
    close();
  });

  overlay.querySelectorAll('[data-felt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSettings({ felt: btn.dataset.felt });
      overlay.querySelectorAll('[data-felt]').forEach((b) => b.classList.toggle('settings-swatch--active', b === btn));
    });
  });

  overlay.querySelectorAll('[data-card-theme-option]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSettings({ cardTheme: btn.dataset.cardThemeOption });
      overlay
        .querySelectorAll('[data-card-theme-option]')
        .forEach((b) => b.classList.toggle('settings-card-theme--active', b === btn));
    });
  });

  overlay.querySelectorAll('[data-card-interaction-option]').forEach((btn) => {
    btn.addEventListener('click', () => {
      saveSettings({ cardInteraction: btn.dataset.cardInteractionOption });
      overlay
        .querySelectorAll('[data-card-interaction-option]')
        .forEach((b) => b.classList.toggle('settings-card-theme--active', b === btn));
    });
  });
}
