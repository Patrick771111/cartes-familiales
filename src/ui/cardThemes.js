/**
 * Registre des thèmes de cartes illustrés. Deux thèmes disponibles pour
 * l'instant, chacun avec sa propre convention de dossier sous
 * `src/assets/cards/` (construite via `import.meta.glob` : ajouter un
 * fichier au bon endroit suffit, pas besoin de toucher ce fichier) :
 *
 * - "autoBrands" (Marques auto) : une marque par famille de cartes
 *   françaises classique (♥ Ferrari, ♦ Renault, ♣ Land Rover, ♠ Lamborghini,
 *   ★ Mercedes pour les Cinq Rois). auto-brands/<marque>/{number,valet,dame,roi}.webp
 *   — `number` sert à toutes les cartes numérales, une seule illustration
 *   par famille suffit puisque le rang est déjà affiché en texte par-dessus.
 *
 * - "mascotte" : croquis au feutre d'une mascotte, dessinés à la main et
 *   volontairement gardés tels quels (pas de retouche IA). Une seule
 *   illustration par RÔLE (as/valet/dame/roi), partagée par les 4 familles
 *   classiques — le symbole ♥♦♣♠/★ et sa couleur restent ajoutés
 *   dynamiquement par-dessus (voir cards.js), donc pas besoin d'un dessin
 *   par famille ici. Les cartes numérales n'ont pas de dessin dédié et
 *   restent sobres. mascotte/{as,valet,dame,roi,back}.webp +
 *   mascotte/special/<type>.webp pour les cartes spéciales de la Suite
 *   Infernale (clés de SPECIAL_TYPES, voir suiteinfernale.js).
 */

const SUIT_TO_BRAND_FOLDER = { H: 'ferrari', D: 'renault', C: 'land-rover', S: 'lamborghini', T: 'mercedes' };

const autoBrandsFiles = import.meta.glob('../assets/cards/auto-brands/**/*.webp', { eager: true, import: 'default' });
const frostFiles = import.meta.glob('../assets/cards/frost/*.webp', { eager: true, import: 'default' });
const mascotteFiles = import.meta.glob('../assets/cards/mascotte/**/*.webp', { eager: true, import: 'default' });

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

/** Même principe que `buildAutoBrandsRegistry`, pour le thème "mascotte" (pas de famille, un rôle = une image). */
export function buildMascotteRegistry(files) {
  const byRole = {};
  const bySpecial = {};
  let back = null;

  for (const [path, url] of Object.entries(files)) {
    if (path.endsWith('/back.webp')) {
      back = url;
      continue;
    }
    const specialMatch = path.match(/\/special\/(\w+)\.webp$/);
    if (specialMatch) {
      bySpecial[specialMatch[1]] = url;
      continue;
    }
    const roleMatch = path.match(/mascotte\/(\w+)\.webp$/);
    if (roleMatch) byRole[roleMatch[1]] = url;
  }

  return { byRole, bySpecial, back };
}

const AUTO_BRANDS = buildAutoBrandsRegistry(autoBrandsFiles);
const MASCOTTE = buildMascotteRegistry(mascotteFiles);
const FROST = Object.values(frostFiles);

/** Thème "phare" (illustration plein cadre standard pour tous les rôles/familles) — conservé pour compat. */
export const CARD_ILLUSTRATION_THEME_ID = 'autoBrands';

const ILLUSTRATED_CARD_THEME_IDS = ['autoBrands', 'mascotte'];

/** Vrai si ce thème a une illustration à proposer (pas juste du texte/CSS) — les jeux s'en servent pour savoir s'il faut demander une image du tout. */
export function isIllustratedCardTheme(themeId) {
  return ILLUSTRATED_CARD_THEME_IDS.includes(themeId);
}

/** Hash stable (pas Math.random) pour qu'un même identifiant renvoie toujours la même image — sinon l'illustration "clignoterait" à chaque re-rendu. */
function stablePick(pool, seed) {
  if (!pool || !pool.length) return null;
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return pool[Math.abs(h) % pool.length];
}

/**
 * Illustration pour une carte à famille (♥♦♣♠★), par rôle. Pour
 * "autoBrands" : repli sur `number` si le rôle précis n'a pas encore
 * d'illustration pour cette famille. Pour "mascotte" : même image quelle
 * que soit la famille (le symbole est ajouté par-dessus dynamiquement), et
 * pas de repli — seuls as/valet/dame/roi sont illustrés, le reste (cartes
 * numérales) reste sobre.
 */
export function suitCardImage(themeId, suitKey, role = 'number') {
  if (themeId === 'autoBrands') {
    const suit = AUTO_BRANDS.bySuit[suitKey];
    if (!suit) return null;
    return suit[role] || suit.number || null;
  }
  if (themeId === 'mascotte') {
    return MASCOTTE.byRole[role] || null;
  }
  return null;
}

export function cardBackImage(themeId) {
  if (themeId === 'autoBrands') return AUTO_BRANDS.back;
  if (themeId === 'mascotte') return MASCOTTE.back;
  return null;
}

/** Joker "Marques auto" (Cinq Rois) : une des variantes, stable par id de carte. Pas encore de joker dessiné pour "mascotte". */
export function jokerImage(themeId, seed) {
  if (themeId !== 'autoBrands') return null;
  return stablePick(AUTO_BRANDS.jokers, seed);
}

/**
 * Habillage décoratif "carte numérotée" pour les jeux sans famille (Skyjo,
 * numéros de la Suite Infernale) : une marque au hasard (stable par `seed`,
 * ex. id de carte ou position de case) parmi les 4-5 disponibles.
 * Uniquement pour "autoBrands" — "mascotte" n'a pas de dessin de carte
 * numérale dédié, elle reste sobre pour ces cartes-là.
 */
export function randomNumberImage(themeId, seed) {
  if (themeId !== 'autoBrands') return null;
  const pool = Object.values(AUTO_BRANDS.bySuit)
    .map((s) => s.number)
    .filter(Boolean);
  return stablePick(pool, seed);
}

/**
 * Carte spéciale de la Suite Infernale (attaques/STOP/Rejouer), par type
 * (clé de `SPECIAL_TYPES`, voir suiteinfernale.js).
 * - "mascotte" : dessin dédié pour les types couverts ; pour le reste
 *   (rejouer, stop, retirerDeux, volerDerniere — pas encore dessinés), reste
 *   sobre plutôt que de mélanger avec le pool "gel" (style photo/glacé trop
 *   différent du feutre dessiné à la main, ça jurerait).
 * - "autoBrands" : pas de branding par type d'attaque, repli sur le pool
 *   "gel" générique pour donner quand même un habillage illustré.
 */
export function suiteInfernaleSpecialImage(themeId, type, seed) {
  if (themeId === 'mascotte') return MASCOTTE.bySpecial[type] || null;
  if (themeId === 'autoBrands') return stablePick(FROST, seed);
  return null;
}
