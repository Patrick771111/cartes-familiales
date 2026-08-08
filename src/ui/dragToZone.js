// Glisser-déposer libre (souris + tactile) vers une zone `[data-dropzone]`.
// Sous le seuil de déplacement → tap/clic (`onTap`).
// Un "fantôme" est attaché à `document.body` en position:fixed pour éviter les
// décalages dus aux transform/filtre des ancêtres ou à .card--selected.
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
        height: rect.height,
        ghost: null
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
        el.classList.add('is-dragging-source');
        document.body.classList.add('is-card-dragging');

        const ghost = el.cloneNode(true);
        ghost.classList.remove('cinqrois-card--selected', 'is-dragging-source');
        ghost.classList.add('is-dragging-away');
        ghost.removeAttribute('id');
        ghost.style.cssText = [
          'position:fixed',
          'left:0',
          'top:0',
          `width:${dragging.width}px`,
          `height:${dragging.height}px`,
          'margin:0',
          'z-index:9999',
          'pointer-events:none',
          'touch-action:none',
          `transform:translate3d(${e.clientX - dragging.offsetX}px,${e.clientY - dragging.offsetY}px,0) scale(1.08) rotate(-2deg)`,
          'transition:none',
          'box-sizing:border-box'
        ].join(';');
        document.body.appendChild(ghost);
        dragging.ghost = ghost;
      }
      if (dragging.moved && dragging.ghost) {
        dragging.ghost.style.transform =
          `translate3d(${e.clientX - dragging.offsetX}px,${e.clientY - dragging.offsetY}px,0) scale(1.08) rotate(-2deg)`;

        const zone = findDropZone(e.clientX, e.clientY);
        if (hovered && hovered !== zone) hovered.classList.remove('dropzone--hover');
        if (zone) zone.classList.add('dropzone--hover');
        hovered = zone;
      }
    });

    const finish = (e) => {
      if (!dragging || dragging.el !== el) return;
      const { moved, id, pointerId, ghost } = dragging;
      const clientX = e.clientX ?? dragging.startX;
      const clientY = e.clientY ?? dragging.startY;

      hovered?.classList.remove('dropzone--hover');
      hovered = null;

      el.classList.remove('is-dragging-source');
      if (ghost?.parentNode) ghost.parentNode.removeChild(ghost);
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
