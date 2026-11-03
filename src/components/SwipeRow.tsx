import { MouseEvent, PointerEvent, ReactNode, useRef, useState } from "react";

/** How far the row slides to uncover its actions: two 72px buttons and two 6px gaps. */
export const SWIPE_ACTIONS_WIDTH = 156;

// Movement before we decide whether the finger is swiping or scrolling.
const AXIS_LOCK_PX = 8;

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  axis: "x" | "y" | null;
};

type SwipeRowProps = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Buttons uncovered when the row is swiped left. */
  actions: ReactNode;
  children: ReactNode;
};

/**
 * A list row that slides left under a finger to uncover action buttons, like
 * iOS Mail. While a row is open, tapping it closes it instead of activating it.
 * Only touch and pen input swipe; the row ignores the mouse.
 */
export function SwipeRow({ isOpen, onOpen, onClose, actions, children }: SwipeRowProps) {
  const [dragX, setDragX] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const latestX = useRef(0);
  // Set once a gesture becomes a swipe so the click that may follow is ignored.
  const swiped = useRef(false);

  const restingX = isOpen ? -SWIPE_ACTIONS_WIDTH : 0;
  const x = dragX ?? restingX;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse") return;
    swiped.current = false;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: restingX,
      axis: null,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (d.axis === null) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (d.axis === "x") {
        swiped.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
    }
    if (d.axis !== "x") return;

    let next = d.baseX + dx;
    // Resist dragging past fully closed or fully open.
    if (next > 0) next = next / 4;
    if (next < -SWIPE_ACTIONS_WIDTH) next = -SWIPE_ACTIONS_WIDTH + (next + SWIPE_ACTIONS_WIDTH) / 3;
    latestX.current = next;
    setDragX(next);
  };

  const finishDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (d.axis !== "x") return;
    setDragX(null);
    if (latestX.current < -SWIPE_ACTIONS_WIDTH / 2) onOpen();
    else onClose();
  };

  const handleClickCapture = (e: MouseEvent) => {
    if (swiped.current || isOpen) {
      e.preventDefault();
      e.stopPropagation();
      swiped.current = false;
      if (isOpen) onClose();
    }
  };

  return (
    <div className={`swipe-row${isOpen ? " open" : ""}${dragX !== null ? " dragging" : ""}`}>
      <div className="swipe-row-actions">
        {actions}
      </div>
      <div
        className={`swipe-row-content${dragX !== null ? " dragging" : ""}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  );
}
