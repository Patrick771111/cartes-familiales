import { suitInfo } from '../game/deck.js';

/** Retourne le HTML d'une carte face visible. `data-rank` permet aux thèmes de
 * cartes (voir settings.js) d'habiller différemment les figures (V/D/R) en CSS. */
export function cardFaceHtml(card) {
  const suit = suitInfo(card.suit);
  return `
    <div class="card card--${suit.color}" data-card-id="${card.id}" data-rank="${card.rank}">
      <span class="card__corner card__corner--top">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__pip">${suit.symbol}</span>
      <span class="card__corner card__corner--bottom">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__figure" data-rank="${card.rank}" aria-hidden="true"></span>
    </div>`;
}

/** Retourne le HTML d'une carte face cachée (dos de carte). */
export function cardBackHtml() {
  return `<div class="card card--back"><span class="card__back-pattern"></span></div>`;
}
