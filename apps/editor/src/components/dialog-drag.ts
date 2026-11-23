import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * Turns a dialog's header into a drag handle. Cosmetic only: the dialog stays
 * modal (`showModal()`), the keyboard does not move it, and the title bar is
 * the only grab area. The offset is written straight to the element's
 * transform, so a drag costs no React renders; the browser clamps nothing, so
 * `clampDragOffset` keeps at least a margin of the window on screen.
 */

export interface DragOffset {
  x: number;
  y: number;
}

/** A box in viewport coordinates, as `getBoundingClientRect()` reports it. */
export interface DragRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DragViewport {
  width: number;
  height: number;
}

/** How much of the dialog a drag keeps inside the viewport. */
const DRAG_MARGIN = 8;

/** Where the pointerdowns the dialog must keep for itself come from. */
const INTERACTIVE =
  'button, a, input, select, textarea, label, [role="menuitem"], [contenteditable="true"]';

/**
 * Clamp one axis of the drag offset: `start + offset >= margin` and
 * `end + offset <= size - margin`. When the viewport is smaller than the
 * dialog the two bounds cross, and the axis stays at 0 rather than fighting
 * itself.
 */
function clampAxis(
  candidate: number,
  start: number,
  end: number,
  size: number,
  margin: number,
): number {
  const min = margin - start;
  const max = size - margin - end;
  if (min > max) return 0;
  return Math.min(max, Math.max(min, candidate));
}

/** Keep the dragged window inside the viewport, `margin` from each edge. */
export function clampDragOffset(
  candidate: DragOffset,
  baseRect: DragRect,
  viewport: DragViewport,
  margin: number,
): DragOffset {
  return {
    x: clampAxis(
      candidate.x,
      baseRect.left,
      baseRect.right,
      viewport.width,
      margin,
    ),
    y: clampAxis(
      candidate.y,
      baseRect.top,
      baseRect.bottom,
      viewport.height,
      margin,
    ),
  };
}

/**
 * The header's `onPointerDown`: a primary-button pointerdown on the header,
 * outside its interactive children, drags `dialogRef`'s element. The drag ends
 * on pointer up or cancel, on unmount, or at the next pointerdown.
 */
export function useDialogDrag(
  dialogRef: RefObject<HTMLElement | null>,
  margin: number = DRAG_MARGIN,
): (event: PointerEvent<HTMLElement>) => void {
  const offset = useRef<DragOffset>({ x: 0, y: 0 });
  /** The element `offset` belongs to; a reopened dialog is a new one. */
  const dragged = useRef<HTMLElement | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  // A dialog unmounted mid-drag (Escape) takes its listeners with it.
  useEffect(() => () => stopDrag.current?.(), []);

  return useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const dialog = dialogRef.current;
      if (event.button !== 0 || !dialog) return;
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE)) return;
      stopDrag.current?.();
      // Closing the dialog unmounts it while this hook keeps living, so a
      // reopened dialog carries no transform but the old offset would still
      // shift its first drag. The element is the owner of the offset.
      if (dragged.current !== dialog) {
        dragged.current = dialog;
        offset.current = { x: 0, y: 0 };
      }

      const header = event.currentTarget;
      const rect = dialog.getBoundingClientRect();
      // The layout box the transform starts from, not the dragged position.
      const baseRect: DragRect = {
        left: rect.left - offset.current.x,
        top: rect.top - offset.current.y,
        right: rect.right - offset.current.x,
        bottom: rect.bottom - offset.current.y,
      };
      const origin = offset.current;
      const startX = event.clientX;
      const startY = event.clientY;
      const { pointerId } = event;

      const move = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        const next = clampDragOffset(
          {
            x: origin.x + moveEvent.clientX - startX,
            y: origin.y + moveEvent.clientY - startY,
          },
          baseRect,
          { width: window.innerWidth, height: window.innerHeight },
          margin,
        );
        offset.current = next;
        dialog.style.transform = `translate(${next.x}px, ${next.y}px)`;
      };
      const stop = () => {
        stopDrag.current = null;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        if (header.hasPointerCapture?.(pointerId))
          header.releasePointerCapture(pointerId);
        dialog.classList.remove("is-dragging");
      };

      try {
        header.setPointerCapture(pointerId);
      } catch {
        // Not every pointer can be captured; the drag still follows the window.
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      dialog.classList.add("is-dragging");
      stopDrag.current = stop;
    },
    [dialogRef, margin],
  );
}
