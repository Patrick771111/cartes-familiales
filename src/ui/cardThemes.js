/**
 * Registre des illustrations du thème "Marques auto" — une marque par
 * famille de cartes françaises classique (♥ Ferrari, ♦ Renault, ♣ Land
 * Rover, ♠ Lamborghini), plus ★ Mercedes propre aux Cinq Rois. Construit à
 * partir de `src/assets/cards/` via `import.meta.glob` : ajouter un fichier
 * dans le bon dossier suffit, pas besoin de toucher ce fichier.
 *
 * Convention de dossier : auto-brands/<marque>/{number,valet,dame,roi}.webp
 * — `number` sert à toutes les cartes numérales (A/2..10 en jeu classique,
 * 3..10 aux Cinq Rois), une seule illustration par famille suffit puisque
 * le rang est déjà affiché en texte par-dessus.
 */

const SUIT_TO_BRAND_FOLDER = { H: 'ferrari', D: 'renault', C: 'land-rover', S: 'lamborghini', T: 'mercedes' };

const autoBrandsFiles = import.meta.glob('../assets/cards/auto-brands/**/*.webp', { eager: true, import: 'default' });
const frostFiles = import.meta.glob('../assets/cards/frost/*.webp', { eager: true, import: 'default' });

// Prend le résultat d'`import.meta.glob` en paramètre (plutôt que de lire la
// variable de module directement) pour rester testable hors Vite — voir
// `_test_cardThemes.html` avec une map simulée.
export function buildAutoBrandsRegistry(files) {
  const bySuit = {};
  const jokers = [];
  let back = null;

  for (const [path, url] of Object.entries(files)) {
    if (path.endsWith('/back.webp')) {
      back = url;
      continue;
    }
    const jokerMatch = path.match(/\/jokers\/([\w-]+)\.webp$/);
    if (jokerMatch) {
      jokers.push(url);
      continue;
    }
    const match = path.match(/auto-brands\/([\w-]+)\/(\w+)\.webp$/);
    if (!match) continue;
    const [, folder, role] = match;
    const suitKey = Object.entries(SUIT_TO_BRAND_FOLDER).find(([, f]) => f === folder)?.[0];
    if (!suitKey) continue;
    bySuit[suitKey] = bySuit[suitKey] || {};
    bySuit[suitKey][role] = url;
  }

  return { bySuit, jokers, back };
}

const AUTO_BRANDS = buildAutoBrandsRegistry(autoBrandsFiles);
const FROST = Object.values(frostFiles);

export const CARD_ILLUSTRATION_THEME_ID = 'autoBrands';

/** Hash stable (pas Math.random) pour qu'un même identifiant renvoie toujours la même image — sinon l'illustration "clignoterait" à chaque re-rendu. */
function stablePick(pool, seed) {
  if (!pool || !pool.length) return null;
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

/**
 * Illustration pour une carte à famille (♥♦♣♠★), par rôle. Repli sur
 * `number` si le rôle précis (valet/dame/roi) n'a pas encore d'illustration
 * pour cette famille — toujours quelque chose plutôt que rien tant que le
 * jeu d'images n'est pas complet.
 */
export function suitCardImage(themeId, suitKey, role = 'number') {
  if (themeId !== CARD_ILLUSTRATION_THEME_ID) return null;
  const suit = AUTO_BRANDS.bySuit[suitKey];
  if (!suit) return null;
  return suit[role] || suit.number || null;
}

export function cardBackImage(themeId) {
  if (themeId !== CARD_ILLUSTRATION_THEME_ID) return null;
  return AUTO_BRANDS.back;
}

/** Joker "Marques auto" (Cinq Rois) : une des variantes, stable par id de carte. */
export function jokerImage(themeId, seed) {
  if (themeId !== CARD_ILLUSTRATION_THEME_ID) return null;
  return stablePick(AUTO_BRANDS.jokers, seed);
}

/**
 * Habillage décoratif "carte numérotée" pour les jeux sans famille (Skyjo,
 * numéros de la Suite Infernale) : une marque au hasard (stable par `seed`,
 * ex. id de carte ou position de case) parmi les 4-5 disponibles.
 */
export function randomNumberImage(themeId, seed) {
  if (themeId !== CARD_ILLUSTRATION_THEME_ID) return null;
  const pool = Object.values(AUTO_BRANDS.bySuit)
    .map((s) => s.number)
    .filter(Boolean);
  return stablePick(pool, seed);
}

/**
 * Habillage décoratif "carte spéciale" (attaques/STOP/Rejouer à la Suite
 * Infernale) : pioché dans le pool "gel", partagé quel que soit le thème de
 * cartes classique choisi puisqu'il n'existe pour l'instant que pour ça.
 */
export function specialCardImage(seed) {
  return stablePick(FROST, seed);
}
