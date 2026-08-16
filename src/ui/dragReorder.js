// Active le glisser-déposer horizontal sur les éléments [data-card-id] à
// l'intérieur de `handEl`. Un mouvement en dessous du seuil est traité comme
// un simple tap (utile pour la sélection au Trou du Cul) plutôt qu'un déplacement.
const TAP_THRESHOLD_PX = 8;

/**
 * Recouvrement des cartes en main ajusté dynamiquement selon leur nombre :
 * peu de cartes → pas (ou peu) de chevauchement, beaucoup de cartes → elles
 * se resserrent pour tenir sans faire déborder `handEl` (jamais plus que
 * `maxOverlapRatio` du visuel d'une carte, sous peine de devenir illisibles).
 * L'ordre du DOM (gauche → droite) reste l'ordre d'empilement naturel — la
 * carte la plus à gauche est donc toujours la plus enfouie, y compris après
 * un glisser-déposer via `enableHandDrag` (qui ne fait que réordonner ce
 * même DOM).
 */
export function applyDynamicHandOverlap(handEl, { maxOverlapRatio = 0.75, minMarginPx = -4 } = {}) {
  const cards = Array.from(handEl.querySelectorAll(':scope > [data-card-id]'));
  if (cards.length < 2) return;

  const cardWidth = cards[0].getBoundingClientRect().width;
  if (!cardWidth) return;
  const containerWidth = handEl.clientWidth;

  const totalFlat = cards.length * cardWidth;
  let marginLeft;
  if (totalFlat <= containerWidth) {
    // Tiennent sans se chevaucher : petit espace régulier plutôt qu'un contact brut.
    marginLeft = Math.max(minMarginPx, 4);
  } else {
    const overlapNeeded = (totalFlat - containerWidth) / (cards.length - 1);
    const maxOverlap = cardWidth * maxOverlapRatio;
    marginLeft = -Math.min(overlapNeeded, maxOverlap);
  }

  cards.forEach((el, i) => {
    el.style.marginLeft = i === 0 ? '0' : `${marginLeft}px`;
  });
}

export function enableHandDrag(handEl, { onDrop, onTap } = {}) {
  let dragging = null; // { el, id, startX, startY, moved }

  handEl.querySelectorAll('[data-card-id]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = { el, id: el.dataset.cardId, startX: e.clientX, startY: e.clientY, moved: false };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.el !== el) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX) dragging.moved = true;
      if (dragging.moved) {
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

      const dropX = dragging.lastX;
      const siblings = [...handEl.querySelectorAll('[data-card-id]')].filter((s) => s !== el);
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
