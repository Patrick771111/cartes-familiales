// Active le glisser-déposer horizontal sur les éléments [data-card-id] à
// l'intérieur de `handEl`. Un mouvement en dessous du seuil est traité comme
// un simple tap (utile pour la sélection au Trou du Cul) plutôt qu'un déplacement.
const TAP_THRESHOLD_PX = 8;

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
