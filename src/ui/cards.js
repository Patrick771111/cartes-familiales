import { suitInfo } from '../game/deck.js';
import { suitCardImage, cardBackImage, jokerImage } from './cardThemes.js';

function activeCardTheme() {
  return document.documentElement.dataset.cardTheme;
}

function roleForRank(rank) {
  if (rank === 'A') return 'as';
  if (rank === 'J' || rank === 11) return 'valet';
  if (rank === 'Q' || rank === 12) return 'dame';
  if (rank === 'K' || rank === 13) return 'roi';
  return 'number';
}

/** Rangs "figure" — lettres pour le jeu de 52 classique, nombres pour les Cinq Rois (voir RANKS dans game/cinqrois.js). */
const COURT_RANKS = ['J', 'Q', 'K', 11, 12, 13];

/**
 * Étiquette affichée sur la carte — françisée (Valet/Dame/Roi) même si le
 * code interne du rang reste anglais pour le jeu de 52 (`J`/`Q`/`K`, voir
 * RANKS dans deck.js) ou numérique pour les Cinq Rois (11/12/13, voir
 * RANKS dans game/cinqrois.js) : ce mapping ne change que l'affichage,
 * jamais comparé ni stocké nulle part (la logique de jeu continue de
 * raisonner sur `card.rank` tel quel).
 */
const RANK_LABELS = { J: 'V', Q: 'D', K: 'R', 11: 'V', 12: 'D', 13: 'R' };
function rankLabel(rank) {
  return RANK_LABELS[rank] || rank;
}

/**
 * Une 5ᵉ famille (★, or) s'ajoute aux 4 familles standard pour les Cinq Rois
 * (voir SUITS dans game/cinqrois.js) — `deck.js` n'en sait rien volontairement
 * (son propre SUITS ne doit rester qu'à 4 familles : buildStandardDeck/
 * buildPouilleuxDeck en dépendent pour construire un jeu de 52), donc on
 * complète ici plutôt que d'y toucher.
 */
const EXTRA_SUITS = { T: { symbol: '★', color: 'gold' } };
function resolveSuit(key) {
  return suitInfo(key) || EXTRA_SUITS[key];
}

/** Nombre de pips à dessiner pour une carte numérale (voir .card__pips--N dans style.css) — absent pour une figure. */
const PIP_COUNTS = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 };

function pipsHtml(rank, symbol) {
  const count = PIP_COUNTS[rank];
  if (!count) return '';
  const pips = Array.from({ length: count }, () => `<i>${symbol}</i>`).join('');
  return `<div class="card__pips card__pips--${count}">${pips}</div>`;
}

/** Monogramme encadré (voir .card--court dans style.css) pour une figure — pas d'illustration figurative, juste du CSS. */
function courtHtml(label, symbol) {
  return `
      <div class="card__frame" aria-hidden="true"></div>
      <span class="card__ornament card__ornament--top" aria-hidden="true">${symbol} ${symbol} ${symbol}</span>
      <span class="card__mono">${label}</span>
      <span class="card__ornament card__ornament--bottom" aria-hidden="true">${symbol} ${symbol} ${symbol}</span>`;
}

/** Joker (Cinq Rois uniquement, voir buildCinqRoisDeck) : ni rang ni famille — cadre + "JOKER", ornements multicolores pour signaler le wild. */
function jokerHtml(card, theme, extra) {
  const illustration = jokerImage(theme, card.id);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `
    <div class="card card--joker ${illustration ? 'card--illustrated' : ''} ${extra}" data-card-id="${card.id}"${style}>
      <div class="card__frame" aria-hidden="true"></div>
      <span class="card__ornament card__ornament--top" aria-hidden="true">★ ♥ ♦ ♣ ♠</span>
      <span class="card__mono card__mono--joker">JOKER</span>
      <span class="card__ornament card__ornament--bottom" aria-hidden="true">★ ♥ ♦ ♣ ♠</span>
    </div>`;
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
 * valeur par défaut à chaque fois. `extraClass`, 3ᵉ paramètre optionnel (même
 * garde de type), sert aux jeux qui ont besoin d'un modificateur d'état
 * ponctuel sur la carte (ex. `card--trump`/`card--selected` aux Cinq Rois)
 * sans dupliquer tout le balisage ici.
 */
export function cardFaceHtml(card, themeOverride, extraClass) {
  const theme = typeof themeOverride === 'string' ? themeOverride : activeCardTheme();
  const extra = typeof extraClass === 'string' ? extraClass : '';
  if (card.isJoker) return jokerHtml(card, theme, extra);
  const suit = resolveSuit(card.suit);
  const illustration = suitCardImage(theme, card.suit, roleForRank(card.rank));
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  const isCourt = COURT_RANKS.includes(card.rank);
  const label = rankLabel(card.rank);
  return `
    <div class="card card--${suit.color} ${illustration ? 'card--illustrated' : ''} ${isCourt ? 'card--court' : ''} ${extra}" data-card-id="${card.id}" data-rank="${card.rank}"${style}>
      <span class="card__corner card__corner--top">${label}</span>
      <span class="card__corner card__corner--bottom">${label}</span>
      ${isCourt ? courtHtml(label, suit.symbol) : pipsHtml(card.rank, suit.symbol)}
    </div>`;
}

/** Retourne le HTML d'une carte face cachée (dos de carte). Même logique de `themeOverride` que `cardFaceHtml`. */
export function cardBackHtml(themeOverride) {
  const theme = typeof themeOverride === 'string' ? themeOverride : activeCardTheme();
  const illustration = cardBackImage(theme);
  const style = illustration ? ` style="background-image:url('${illustration}')"` : '';
  return `<div class="card card--back ${illustration ? 'card--back-illustrated' : ''}"${style}></div>`;
}
