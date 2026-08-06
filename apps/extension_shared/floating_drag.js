export const FLOATING_DRAG_VIEWPORT_MARGIN_PX = 8;

export function clampFloatingPosition({
  left,
  top,
  width,
  height,
  viewportWidth,
  viewportHeight,
  margin = FLOATING_DRAG_VIEWPORT_MARGIN_PX,
}) {
  const safeMargin = Math.max(0, Number(margin) || 0);
  const maxLeft = Math.max(safeMargin, Number(viewportWidth) - Number(width) - safeMargin);
  const maxTop = Math.max(safeMargin, Number(viewportHeight) - Number(height) - safeMargin);
  return {
    left: Math.min(maxLeft, Math.max(safeMargin, Number(left) || 0)),
    top: Math.min(maxTop, Math.max(safeMargin, Number(top) || 0)),
  };
}

export function shouldStartFloatingDrag({
  button,
  isPrimary,
  targetIsSurface,
  targetHasHandle,
  targetIsInteractive,
}) {
  return button === 0
    && isPrimary !== false
    && !targetIsInteractive
    && (targetIsSurface || targetHasHandle);
}

export function installFloatingDrag({ host, surface, viewport = window }) {
  if (!host || !surface) return () => {};

  const idleCursor = surface.style.cursor;
  let activePointerId = null;
  let startPointerX = 0;
  let startPointerY = 0;
  let startLeft = 0;
  let startTop = 0;
  let surfaceWidth = 0;
  let surfaceHeight = 0;

  const finishDrag = (event) => {
    if (activePointerId == null || event.pointerId !== activePointerId) return;
    if (surface.hasPointerCapture?.(activePointerId)) {
      surface.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    surface.style.cursor = idleCursor;
  };

  const onPointerDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const targetHasHandle = Boolean(target?.closest?.("[data-pass-drag-handle]"));
    const targetIsInteractive = Boolean(target?.closest?.(
      "button, input, select, textarea, a, [role='button'], [contenteditable='true'], [data-pass-no-drag]",
    ));
    if (!shouldStartFloatingDrag({
      button: event.button,
      isPrimary: event.isPrimary,
      targetIsSurface: target === surface,
      targetHasHandle,
      targetIsInteractive,
    })) return;

    const rect = host.getBoundingClientRect();
    activePointerId = event.pointerId;
    startPointerX = event.clientX;
    startPointerY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    surfaceWidth = rect.width;
    surfaceHeight = rect.height;
    surface.setPointerCapture?.(activePointerId);
    surface.style.cursor = "grabbing";
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (activePointerId == null || event.pointerId !== activePointerId) return;
    const position = clampFloatingPosition({
      left: startLeft + event.clientX - startPointerX,
      top: startTop + event.clientY - startPointerY,
      width: surfaceWidth,
      height: surfaceHeight,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    host.style.setProperty("left", `${position.left}px`, "important");
    host.style.setProperty("top", `${position.top}px`, "important");
    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("bottom", "auto", "important");
    event.preventDefault();
  };

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", finishDrag);
  surface.addEventListener("pointercancel", finishDrag);
  surface.addEventListener("lostpointercapture", finishDrag);

  return () => {
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", finishDrag);
    surface.removeEventListener("pointercancel", finishDrag);
    surface.removeEventListener("lostpointercapture", finishDrag);
  };
}
