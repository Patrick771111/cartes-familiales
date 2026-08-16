/**
 * Illustrations Uno (jeu officiel, licence CC0 — Wikimedia Commons,
 * https://commons.wikimedia.org/wiki/File:UNO_cards_deck.svg). Contrairement
 * aux thèmes de `cardThemes.js` (French suits ♥♦♣♠), les cartes Uno n'ont pas
 * de famille — un seul jeu d'illustrations, pas de variante par thème.
 * Convention de fichier sous `src/assets/games/uno/` : `<couleur>-<valeur>.webp`
 * pour les numéros (0-9), `<couleur>-skip.webp` / `-reverse.webp` /
 * `-drawTwo.webp` pour les actions colorées, `wild.webp` / `wildDrawFour.webp`
 * pour les Jokers.
 */
const files = import.meta.glob('../assets/games/uno/*.webp', { eager: true, import: 'default' });

const IMAGES = {};
for (const [path, url] of Object.entries(files)) {
  const match = path.match(/uno\/([\w-]+)\.webp$/);
  if (match) IMAGES[match[1]] = url;
}

/** URL de l'illustration pour cette carte, ou `null` si absente (repli sur le rendu texte/couleur existant). */
export function unoCardImage(card) {
  if (card.kind === 'wild') return IMAGES.wild || null;
  if (card.kind === 'wildDrawFour') return IMAGES.wildDrawFour || null;
  const key = card.kind === 'number' ? `${card.color}-${card.value}` : `${card.color}-${card.kind}`;
  return IMAGES[key] || null;
}
