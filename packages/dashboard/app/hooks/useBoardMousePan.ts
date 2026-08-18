import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

const BOARD_MOUSE_PAN_THRESHOLD = 4;

type BoardMousePanSession = {
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  isPanning: boolean;
};

export interface BoardMousePanBindings {
  isPanning: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
}

/*
FNXC:BoardNavigation 2026-08-18-18:18:
Desktop Board operators need a primary mouse click-drag on the existing scroll surface to reveal
workflow columns without Shift+Scroll. This seam owns only horizontal mouse panning; touch and pen
remain native mobile gestures, and task-card/native-draggable or interactive descendants keep their
existing click, context-menu, and drag behavior.
*/
function isExcludedBoardPanTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(
    target.closest(
      "button, a, input, textarea, select, option, label, summary, [contenteditable='true'], [draggable='true'], [data-id], [role='button'], [role='link'], [role='textbox'], [role='menuitem'], [role='checkbox'], [role='combobox'], [role='radio'], [role='slider'], [role='switch']",
    ),
  );
}

function releasePointerCapture(session: BoardMousePanSession): void {
  const { element, pointerId } = session;
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture?.(pointerId);
    }
  } catch {
    /* FNXC:BoardNavigation 2026-08-18-18:18: Browser teardown can release pointer capture before the hook cleanup runs; cleanup must remain idempotent. */
  }
}

export function useBoardMousePan(boardElement: HTMLElement | null): BoardMousePanBindings {
  const sessionRef = useRef<BoardMousePanSession | null>(null);
  const didPanRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const endSession = useCallback((event: ReactPointerEvent<HTMLElement>, clearClickGuard: boolean) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    releasePointerCapture(session);
    sessionRef.current = null;
    setIsPanning(false);
    if (clearClickGuard) didPanRef.current = false;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || isExcludedBoardPanTarget(event.target)) {
      return;
    }

    const element = event.currentTarget;
    didPanRef.current = false;
    sessionRef.current = {
      element,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: element.scrollLeft,
      isPanning: false,
    };
    element.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;
    if (!session.isPanning) {
      const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY);
      if (
        !horizontalIntent
        || Math.abs(deltaX) < BOARD_MOUSE_PAN_THRESHOLD
        || session.element.scrollWidth <= session.element.clientWidth
      ) {
        return;
      }
      session.isPanning = true;
      didPanRef.current = true;
      setIsPanning(true);
    }

    event.preventDefault();
    session.element.scrollLeft = session.startScrollLeft - deltaX;
  }, []);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    endSession(event, false);
  }, [endSession]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    endSession(event, true);
  }, [endSession]);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    endSession(event, true);
  }, [endSession]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!didPanRef.current) return;
    didPanRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    return () => {
      const session = sessionRef.current;
      if (session) releasePointerCapture(session);
      sessionRef.current = null;
      didPanRef.current = false;
    };
  }, [boardElement]);

  return {
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onClickCapture,
  };
}
