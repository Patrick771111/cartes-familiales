// Mémorise, par jeu ('pouilleux' | 'trouduc'), l'ordre dans lequel le joueur a
// choisi de ranger ses cartes. Vit en mémoire (pas en localStorage) : c'est une
// simple préférence d'affichage pour la session en cours, remise à zéro entre
// deux visites — largement suffisant pour une partie entre proches.
const orders = new Map();

/**
 * Retourne `hand` réordonnée selon la préférence mémorisée : les cartes déjà
 * connues gardent leur position relative, les nouvelles (ex: carte piochée)
 * sont ajoutées à la fin, triées par `defaultSort` si fourni.
 */
export function getOrderedHand(key, hand, defaultSort) {
  const remembered = orders.get(key) || [];
  const idsInHand = new Set(hand.map((c) => c.id));

  const known = remembered.filter((id) => idsInHand.has(id));
  const knownSet = new Set(known);
  const unknownCards = hand.filter((c) => !knownSet.has(c.id));
  const sortedUnknown = defaultSort ? defaultSort(unknownCards) : unknownCards;

  const finalOrder = [...known, ...sortedUnknown.map((c) => c.id)];
  orders.set(key, finalOrder);

  return finalOrder.map((id) => hand.find((c) => c.id === id)).filter(Boolean);
}

/** Déplace une carte à une nouvelle position dans l'ordre mémorisé. */
export function moveCard(key, cardId, toIndex) {
  const current = orders.get(key) || [];
  const without = current.filter((id) => id !== cardId);
  const clampedIndex = Math.max(0, Math.min(toIndex, without.length));
  without.splice(clampedIndex, 0, cardId);
  orders.set(key, without);
}

export function resetHandOrder(key) {
  orders.delete(key);
}
