import { suitInfo } from '../game/deck.js';

/** Retourne le HTML d'une carte face visible. */
export function cardFaceHtml(card) {
  const suit = suitInfo(card.suit);
  return `
    <div class="card card--${suit.color}" data-card-id="${card.id}">
      <span class="card__corner card__corner--top">${card.rank}<br/>${suit.symbol}</span>
      <span class="card__pip">${suit.symbol}</span>
      <span class="card__corner card__corner--bottom">${card.rank}<br/>${suit.symbol}</span>
    </div>`;
}

/** Retourne le HTML d'une carte face cachée (dos de carte). */
export function cardBackHtml() {
  return `<div class="card card--back"><span class="card__back-pattern"></span></div>`;
}
