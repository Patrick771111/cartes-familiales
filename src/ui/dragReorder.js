// Active le glisser-déposer horizontal sur les éléments [data-card-id] à
// l'intérieur de `handEl`. Un mouvement en dessous du seuil est traité comme
// un simple tap (utile pour la sélection au Trou du Cul) plutôt qu'un déplacement.
const TAP_THRESHOLD_PX = 8;

/**
 * Recouvrement des cartes en main ajusté dynamiquement selon leur nombre :
 * peu de cartes → pas (ou peu) de chevauchement, beaucoup de cartes → elles
 * se resserrent (jamais plus que `maxOverlapRatio` du visuel d'une carte,
 * sous peine de devenir illisibles). Si même ce chevauchement maximal ne
 * suffit pas à tenir sur une rangée, la main passe sur 2-3 rangées
 * (`maxRows`) plutôt que de déborder avec un défilement horizontal — chaque
 * rangée est forcée via un séparateur `flex-basis:100%` (technique flexbox
 * standard), pas laissée au calcul automatique du navigateur, pour garder
 * le contrôle exact de la répartition. L'ordre du DOM (gauche → droite,
 * haut → bas) reste l'ordre d'empilement naturel — la carte la plus à
 * gauche/en haut est donc toujours la plus enfouie, y compris après un
 * glisser-déposer via `enableHandDrag` (qui ne fait que réordonner ce même
 * DOM).
 */
export function applyDynamicHandOverlap(handEl, { maxOverlapRatio = 0.72, minMarginPx = -4, maxRows = 3 } = {}) {
  handEl.querySelectorAll('.hand-row-break').forEach((el) => el.remove());
  const cards = Array.from(handEl.querySelectorAll(':scope > [data-card-id]'));
  if (cards.length < 2) return;

  const cardWidth = cards[0].getBoundingClientRect().width;
  if (!cardWidth) return;
  // Marge de sécurité (8px) sur toute la largeur utilisable : sans elle, un
  // nombre de cartes pile à la limite calcule un chevauchement qui tient au
  // sous-pixel près — le navigateur fait alors lui-même un retour à la ligne
  // pour 1 seule carte en trop, au lieu d'une répartition équilibrée sur les
  // rangées prévues ici.
  const containerWidth = handEl.clientWidth - 8;
  const maxOverlap = cardWidth * maxOverlapRatio;

  const applyRowMargins = (rowCards) => {
    const n = rowCards.length;
    const totalFlat = n * cardWidth;
    let marginLeft = Math.max(minMarginPx, 4);
    if (totalFlat > containerWidth && n > 1) {
      const overlapNeeded = (totalFlat - containerWidth) / (n - 1);
      marginLeft = -Math.min(overlapNeeded, maxOverlap);
    }
    rowCards.forEach((el, i) => {
      el.style.marginLeft = i === 0 ? '0' : `${marginLeft}px`;
    });
  };

  const totalFlat = cards.length * cardWidth;
  if (totalFlat <= containerWidth) {
    handEl.style.flexWrap = 'nowrap';
    applyRowMargins(cards);
    return;
  }

  handEl.style.flexWrap = 'wrap';
  const step = cardWidth - maxOverlap;
  const perRowAtMaxOverlap = Math.max(1, Math.floor((containerWidth - cardWidth) / step) + 1);
  const rows = Math.min(maxRows, Math.max(1, Math.ceil(cards.length / perRowAtMaxOverlap)));
  const perRow = Math.ceil(cards.length / rows);

  for (let i = 0; i < cards.length; i += perRow) {
    const rowCards = cards.slice(i, i + perRow);
    applyRowMargins(rowCards);
    if (i + perRow < cards.length) {
      const brk = document.createElement('div');
      brk.className = 'hand-row-break';
      brk.style.cssText = 'flex-basis:100%; width:0; height:6px;';
      rowCards[rowCards.length - 1].after(brk);
    }
  }
}

/**
 * `onDragStart`/`onDragEnd` (optionnels) : déclenchés au franchissement du
 * seuil de déplacement / à la fin d'un vrai glisser — utile pour un appelant
 * qui a besoin d'un retour visuel propre (ex. mettre en valeur la carte
 * "prise en main" dans le rendu 3D du Pouilleux, où les éléments réels
 * `[data-card-id]` sont des boutons invisibles superposés au canvas, donc le
 * `transform` appliqué ici sur l'élément lui-même n'a aucun effet visible —
 * voir setCardHighlight dans src/three/pouilleuxScene.js).
 */
export function enableHandDrag(handEl, { onDrop, onTap, onDragStart, onDragEnd, selector = '[data-card-id]' } = {}) {
  let dragging = null; // { el, id, startX, startY, moved }

  handEl.querySelectorAll(selector).forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = { el, id: el.dataset.cardId, startX: e.clientX, startY: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.el !== el) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      const wasMoved = dragging.moved;
      if (Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX) dragging.moved = true;
      if (dragging.moved) {
        if (!wasMoved) onDragStart?.(dragging.id);
        el.classList.add('is-dragging');
        el.style.transform = `translate(${dx}px, -14px) scale(1.06)`;
        el.style.zIndex = '10';
      }
    });

    const finish = () => {
      if (!dragging || dragging.el !== el) return;
      const { moved, id } = dragging;

      el.style.transform = '';
      el.style.zIndex = '';
      el.classList.remove('is-dragging');

      if (!moved) {
        dragging = null;
        onTap?.(id);
        return;
      }
      onDragEnd?.(id);

      const dropX = dragging.lastX;
      const siblings = [...handEl.querySelectorAll(selector)].filter((s) => s !== el);
      let dropIndex = siblings.length;
      let closestDist = Infinity;
      siblings.forEach((sib, i) => {
        const rect = sib.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const dist = Math.abs(dropX - center);
        if (dist < closestDist) {
          closestDist = dist;
          dropIndex = dropX < center ? i : i + 1;
        }
      });

      dragging = null;
      onDrop?.(id, dropIndex);
    };

    // On garde la dernière position X connue (pointerup ne la fournit pas toujours de façon fiable partout).
    el.addEventListener('pointermove', (e) => {
      if (dragging && dragging.el === el) dragging.lastX = e.clientX;
    });

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  });
}
