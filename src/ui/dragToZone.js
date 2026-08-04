// Glisser-déposer libre (pas juste un réordonnancement horizontal, voir
// dragReorder.js) : une carte de `handEl` peut être lâchée n'importe où sur
// l'écran, sur une zone marquée `[data-dropzone]`. En dessous du seuil de
// déplacement, c'est traité comme un simple tap (`onTap`) plutôt qu'un
// dépôt — permet de garder un geste de repli au clic/tap simple.
const TAP_THRESHOLD_PX = 8;

function findDropZone(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('[data-dropzone]') || null;
}

export function enableDragToZone(handEl, { onDrop, onTap } = {}) {
  let dragging = null; // { el, id, startX, startY, moved, offsetX, offsetY, width }
  let hovered = null;

  handEl.querySelectorAll('[data-card-id]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      dragging = {
        el,
        id: el.dataset.cardId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width
      };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.el !== el) return;
      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (!dragging.moved && (Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX)) {
        dragging.moved = true;
        el.classList.add('is-dragging-away');
      }
      if (dragging.moved) {
        el.style.left = `${e.clientX - dragging.offsetX}px`;
        el.style.top = `${e.clientY - dragging.offsetY}px`;
        el.style.width = `${dragging.width}px`;

        const zone = findDropZone(e.clientX, e.clientY);
        if (hovered && hovered !== zone) hovered.classList.remove('dropzone--hover');
        if (zone) zone.classList.add('dropzone--hover');
        hovered = zone;
      }
    });

    const finish = (e) => {
      if (!dragging || dragging.el !== el) return;
      const { moved, id } = dragging;

      hovered?.classList.remove('dropzone--hover');
      hovered = null;
      el.classList.remove('is-dragging-away');
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';

      if (!moved) {
        dragging = null;
        onTap?.(id);
        return;
      }

      const zone = findDropZone(e.clientX, e.clientY);
      dragging = null;
      if (zone) onDrop?.(id, { ...zone.dataset });
    };

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  });
}
