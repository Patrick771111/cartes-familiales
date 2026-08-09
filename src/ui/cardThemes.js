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
 *   par famille ici. mascotte/{as,valet,dame,roi,back}.webp.
 *
 * Voir "Thèmes de cartes" dans README.md pour le contrat complet (5
 * familles à illustrer, cartes communes, cartes spécifiques à un jeu) à
 * respecter pour un nouveau thème.
 *
 * --- Cartes spécifiques à un jeu (ex : les cartes spéciales de la Suite
 * Infernale) ---
 *
 * Convention commune à tous les thèmes, sous `<theme>/games/<gameId>/` :
 *   - `<slotKey>.webp` : illustration dédiée pour ce slot précis (`slotKey`
 *     = une clé de `ILLUSTRATION_SLOTS` exportée par `src/game/<gameId>.js`,
 *     voir suiteinfernale.js).
 *   - `_pool/*.webp` : pool générique de repli (autant de variantes que
 *     voulu), piochée pour les slots sans dessin dédié — une image stable
 *     par id de carte (jamais aléatoire à chaque rendu). Remplace l'ancien
 *     dossier `frost/` (les cartes "gel" complètent le thème "Marques
 *     auto" pour la Suite Infernale, elles ne sont pas un thème à part).
 *   - Ni `<slotKey>.webp` ni `_pool/` : le thème reste sobre pour ce jeu
 *     (aucune illustration), comportement par défaut si rien n'est fourni.
 *
 * `npm run theme:coverage` liste, pour chaque thème et chaque jeu à slots,
 * ce qui est dessiné/en pool/manquant (voir scripts/theme-coverage.mjs).
 */

const SUIT_TO_BRAND_FOLDER = { H: 'ferrari', D: 'renault', C: 'land-rover', S: 'lamborghini', T: 'mercedes' };

const autoBrandsFiles = import.meta.glob('../assets/cards/auto-brands/**/*.webp', { eager: true, import: 'default' });
const mascotteFiles = import.meta.glob('../assets/cards/mascotte/**/*.webp', { eager: true, import: 'default' });
// Un seul glob, générique à tous les thèmes présents et futurs : couvre
// `<theme>/games/<gameId>/<slotKey>.webp` et `<theme>/games/<gameId>/_pool/*.webp`.
const gameSlotFiles = import.meta.glob('../assets/cards/*/games/**/*.webp', { eager: true, import: 'default' });

// Prend le résultat d'`import.meta.glob` en paramètre (plutôt que de lire la
// variable de module directement) pour rester testable hors Vite.
export function buildAutoBrandsRegistry(files) {
  const bySuit = {};
  const jokers = [];
  let back = null;

  for (const [path, url] of Object.entries(files)) {
    if (path.includes('/games/')) continue; // couvert par buildGameSlotRegistry
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
  let back = null;

  for (const [path, url] of Object.entries(files)) {
    if (path.includes('/games/')) continue; // couvert par buildGameSlotRegistry
    if (path.endsWith('/back.webp')) {
      back = url;
      continue;
    }
    const roleMatch = path.match(/mascotte\/(\w+)\.webp$/);
    if (roleMatch) byRole[roleMatch[1]] = url;
  }

  return { byRole, back };
}

/**
 * Registre générique des cartes spécifiques à un jeu, pour tous les thèmes
 * en une passe : `{ [themeId]: { [gameId]: { slots: {slotKey: url}, pool: [url, ...] } } }`.
 * `themeId` est déduit du 1er segment après `assets/cards/` (ex. `auto-brands`
 * -> `autoBrands`, cohérent avec `CARD_THEMES` dans settings.js).
 */
export function buildGameSlotRegistry(files) {
  const registry = {};
  for (const [path, url] of Object.entries(files)) {
    const match = path.match(/assets\/cards\/([\w-]+)\/games\/([\w-]+)\/(?:_pool\/)?([\w-]+)\.webp$/);
    if (!match) continue;
    const [, themeFolder, gameId, name] = match;
    const themeId = themeFolder === 'auto-brands' ? 'autoBrands' : themeFolder;
    registry[themeId] = registry[themeId] || {};
    registry[themeId][gameId] = registry[themeId][gameId] || { slots: {}, pool: [] };
    if (path.includes('/_pool/')) {
      registry[themeId][gameId].pool.push(url);
    } else {
      registry[themeId][gameId].slots[name] = url;
    }
  }
  return registry;
}

const AUTO_BRANDS = buildAutoBrandsRegistry(autoBrandsFiles);
const MASCOTTE = buildMascotteRegistry(mascotteFiles);
const GAME_SLOTS = buildGameSlotRegistry(gameSlotFiles);

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

/** Icône du bouton "Flip" à Skyjo (retourner une case cachée). Uniquement dessinée pour "mascotte". */
export function flipButtonImage(themeId) {
  if (themeId !== 'mascotte') return null;
  return MASCOTTE.byRole.flip || null;
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
 * Illustration pour une carte spécifique à un jeu (ex. les cartes spéciales
 * de la Suite Infernale — attaques/STOP/Rejouer), identifiée par `slotKey`
 * (une clé de `ILLUSTRATION_SLOTS` exporté par `src/game/<gameId>.js`).
 * Cherche d'abord un dessin dédié à ce slot précis
 * (`<theme>/games/<gameId>/<slotKey>.webp`), sinon pioche dans le pool
 * générique du jeu (`<theme>/games/<gameId>/_pool/*.webp`, choix stable par
 * `seed`), sinon `null` (reste sobre). Générique à tous les thèmes et tous
 * les jeux : ajouter un thème ou un jeu à slots ne demande aucun code ici,
 * seulement les fichiers au bon endroit (voir le commentaire d'en-tête).
 */
export function gameCardImage(themeId, gameId, slotKey, seed) {
  const game = GAME_SLOTS[themeId]?.[gameId];
  if (!game) return null;
  return game.slots[slotKey] || stablePick(game.pool, seed);
}
