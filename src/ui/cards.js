import { suitInfo } from '../game/deck.js';
import { suitCardImage, cardBackImage } from './cardThemes.js';

function activeCardTheme() {
  return document.documentElement.dataset.cardTheme;
}

function roleForRank(rank) {
  if (rank === 'A') return 'as';
  if (rank === 'J') return 'valet';
  if (rank === 'Q') return 'dame';
  if (rank === 'K') return 'roi';
  return 'number';
}

/**
 * Retourne le HTML d'une carte face visible. `data-rank` permet aux thèmes de
 * cartes (voir settings.js) d'habiller différemment les figures (V/D/R) en CSS.
 * `themeOverride`, uniquement pour l'aperçu dans la modale de réglages (qui
 * doit afficher chaque thème indépendamment du thème actif) — les jeux
 * appellent cette fonction sans second argument, qui retombe alors sur le
 * thème actif. Un garde de type est nécessaire (pas juste `= activeCardTheme()`
 * en valeur par défaut) car cette fonction est très souvent passée telle
 * quelle à `.map(cardFaceHtml)` : `Array.prototype.map` appelle le callback
 * avec (élément, index, tableau), et cet index numérique écraserait sinon la
 * valeur par défaut à chaque fois.
 */
export function cardFaceHtml(card, themeOverride) {
  const theme = typeof themeOverride === 'string' ? themeOverride : activeCardTheme();
  const suit = suitInfo(card.suit);
  const illustration = suitCardImage(theme, card.suit, roleForRank(card.rank));
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `
    <div class="card card--${suit.color} ${illustration ? 'card--illustrated' : ''}" data-card-id="${card.id}" data-rank="${card.rank}"${style}>
      <span class="card__corner card__corner--top">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__pip">${suit.symbol}</span>
      <span class="card__corner card__corner--bottom">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__figure" data-rank="${card.rank}" aria-hidden="true"></span>
    </div>`;
}

/** Retourne le HTML d'une carte face cachée (dos de carte). Même logique de `themeOverride` que `cardFaceHtml`. */
export function cardBackHtml(themeOverride) {
  const theme = typeof themeOverride === 'string' ? themeOverride : activeCardTheme();
  const illustration = cardBackImage(theme);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="card card--back ${illustration ? 'card--back-illustrated' : ''}"${style}><span class="card__back-pattern"></span></div>`;
}
