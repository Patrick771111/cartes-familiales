// Glisser-déposer libre (souris + tactile) vers une zone `[data-dropzone]`.
// Sous le seuil de déplacement → tap/clic (`onTap`).
const TAP_THRESHOLD_PX = 8;

function findDropZone(x, y) {
  const el = document.elementFromPoint(x, y);
  return el?.closest('[data-dropzone]') || null;
}

/**
 * @param {HTMLElement} handEl
 * @param {{ onDrop?: Function, onTap?: Function, dragEnabled?: boolean }} opts
 */
export function enableDragToZone(handEl, { onDrop, onTap, dragEnabled = true } = {}) {
  let dragging = null;
  let hovered = null;

  handEl.querySelectorAll('[data-card-id]').forEach((el) => {
    el.style.touchAction = 'none';
    el.style.cursor = dragEnabled ? 'grab' : 'pointer';

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      dragging = {
        el,
        id: el.dataset.cardId,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height
      };
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.el !== el) return;
      if (!dragEnabled) return;

      const dx = e.clientX - dragging.startX;
      const dy = e.clientY - dragging.startY;
      if (!dragging.moved && (Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX)) {
        dragging.moved = true;
        el.classList.add('is-dragging-away');
        el.style.cursor = 'grabbing';
        document.body.classList.add('is-card-dragging');
      }
      if (dragging.moved) {
        el.style.left = `${e.clientX - dragging.offsetX}px`;
        el.style.top = `${e.clientY - dragging.offsetY}px`;
        el.style.width = `${dragging.width}px`;
        if (dragging.height) el.style.height = `${dragging.height}px`;

        const zone = findDropZone(e.clientX, e.clientY);
        if (hovered && hovered !== zone) hovered.classList.remove('dropzone--hover');
        if (zone) zone.classList.add('dropzone--hover');
        hovered = zone;
      }
    });

    const finish = (e) => {
      if (!dragging || dragging.el !== el) return;
      const { moved, id, pointerId } = dragging;
      const clientX = e.clientX ?? dragging.startX;
      const clientY = e.clientY ?? dragging.startY;

      hovered?.classList.remove('dropzone--hover');
      hovered = null;

      el.classList.remove('is-dragging-away');
      el.style.left = '';
      el.style.top = '';
      el.style.width = '';
      el.style.height = '';
      el.style.cursor = dragEnabled ? 'grab' : 'pointer';
      document.body.classList.remove('is-card-dragging');

      try {
        if (pointerId != null) el.releasePointerCapture(pointerId);
      } catch (_) {}

      dragging = null;

      if (!dragEnabled || !moved) {
        onTap?.(id);
        return;
      }

      const zone = findDropZone(clientX, clientY);
      if (zone) onDrop?.(id, zone.dataset);
    };

    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', (e) => {
      if (dragging && dragging.el === el) finish(e);
    });
  });
}
