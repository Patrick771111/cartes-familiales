import { suitInfo } from '../game/deck.js';
import { CARD_ILLUSTRATION_THEME_ID, suitCardImage, cardBackImage } from './cardThemes.js';

function activeCardTheme() {
  return document.documentElement.dataset.cardTheme;
}

function roleForRank(rank) {
  if (rank === 'J') return 'valet';
  if (rank === 'Q') return 'dame';
  if (rank === 'K') return 'roi';
  return 'number';
}

/**
 * Retourne le HTML d'une carte face visible. `data-rank` permet aux thèmes de
 * cartes (voir settings.js) d'habiller différemment les figures (V/D/R) en CSS.
 * `theme`, uniquement pour l'aperçu dans la modale de réglages (qui doit
 * afficher chaque thème indépendamment du thème actif) — les jeux appellent
 * cette fonction sans second argument, qui retombe alors sur le thème actif.
 */
export function cardFaceHtml(card, theme = activeCardTheme()) {
  const suit = suitInfo(card.suit);
  const illustration = theme === CARD_ILLUSTRATION_THEME_ID ? suitCardImage(theme, card.suit, roleForRank(card.rank)) : null;
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `
    <div class="card card--${suit.color} ${illustration ? 'card--illustrated' : ''}" data-card-id="${card.id}" data-rank="${card.rank}"${style}>
      <span class="card__corner card__corner--top">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__pip">${suit.symbol}</span>
      <span class="card__corner card__corner--bottom">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__figure" data-rank="${card.rank}" aria-hidden="true"></span>
    </div>`;
}

/** Retourne le HTML d'une carte face cachée (dos de carte). Même logique de `theme` que `cardFaceHtml`. */
export function cardBackHtml(theme = activeCardTheme()) {
  const illustration = theme === CARD_ILLUSTRATION_THEME_ID ? cardBackImage(theme) : null;
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="card card--back ${illustration ? 'card--back-illustrated' : ''}"${style}><span class="card__back-pattern"></span></div>`;
}
