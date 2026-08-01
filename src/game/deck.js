export const SUITS = [
  { key: 'S', symbol: '♠', color: 'dark' },
  { key: 'H', symbol: '♥', color: 'red' },
  { key: 'D', symbol: '♦', color: 'red' },
  { key: 'C', symbol: '♣', color: 'dark' }
];

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function suitInfo(key) {
  return SUITS.find((s) => s.key === key);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construit un jeu "à la Pouilleux" : jeu de 52 cartes dont on retire 3 des 4 cartes
 * d'un même rang (traditionnellement le Valet), pour ne garder qu'une carte "orpheline".
 * Le joueur qui termine la partie avec cette carte seule en main est "le Pouilleux".
 */
export function buildPouilleuxDeck({ oddRank = 'J', keepSuit = 'S' } = {}) {
  let deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit.key}`, rank, suit: suit.key });
    }
  }
  deck = deck.filter((c) => c.rank !== oddRank || c.suit === keepSuit);
  return { deck, oddCardId: `${oddRank}${keepSuit}` };
}

/** Distribue les cartes en rond entre les joueurs (certains auront une carte de plus). */
export function deal(deck, playerIds) {
  const hands = Object.fromEntries(playerIds.map((id) => [id, []]));
  deck.forEach((card, i) => {
    hands[playerIds[i % playerIds.length]].push(card);
  });
  return hands;
}
