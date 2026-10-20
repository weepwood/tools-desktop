import { useRef } from "react";
import "./ResizeHandle.css";

interface ResizeHandleProps {
  /** Which edge of the parent panel the handle sits on. */
  edge: "right" | "left" | "top";
  /** Pointer-delta multiplier that grows the panel (drag right on a
   *  left sidebar = +1; drag left on a right panel = -1). */
  dir: 1 | -1;
  size: number;
  min: number;
  max: number;
  onSize: (size: number) => void;
  /** Called when the user drags well past the minimum — auto-stow. */
  onStow: () => void;
  /** Called when, still mid-drag, the user pulls back out — reopen. */
  onUnstow: () => void;
  onDragging: (dragging: boolean) => void;
}

/** Dragging this far past the minimum size stows the panel. */
const STOW_DISTANCE = 48;

/**
 * Invisible grab strip on a panel edge. Hovering shows the highlight
 * (gradient line, resize cursor); dragging resizes the panel
 * via the CSS variable that drives its grid track. Dragging far past
 * the minimum stows the panel, but the drag stays alive: pulling back
 * toward the center un-stows it again, so a stow can be corrected
 * without releasing the button.
 */
export function ResizeHandle({
  edge,
  dir,
  size,
  min,
  max,
  onSize,
  onStow,
  onUnstow,
  onDragging,
}: ResizeHandleProps) {
  const drag = useRef<{ start: number; startSize: number; stowed: boolean } | null>(null);
  const vertical = edge !== "top";

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    onDragging(false);
  };

  return (
    <div
      className="resize-handle"
      data-edge={edge}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { start: vertical ? e.clientX : e.clientY, startSize: size, stowed: false };
        document.body.style.cursor = vertical ? "col-resize" : "row-resize";
        onDragging(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const pos = vertical ? e.clientX : e.clientY;
        const next = drag.current.startSize + (pos - drag.current.start) * dir;

        if (drag.current.stowed) {
          // Pulling back toward the center revives the panel at its
          // minimum size and resizing continues.
          if (next >= min - STOW_DISTANCE) {
            drag.current.stowed = false;
            onUnstow();
            onSize(Math.min(max, Math.max(min, next)));
          }
          return;
        }

        if (next < min - STOW_DISTANCE) {
          drag.current.stowed = true;
          // Restore the pre-drag size so reopening isn't stuck at min.
          onSize(drag.current.startSize);
          onStow();
          return;
        }
        onSize(Math.min(max, Math.max(min, next)));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
