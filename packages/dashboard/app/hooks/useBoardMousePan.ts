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
FNXC:BoardNavigation 2026-08-20-02:44:
Desktop Board navigation intentionally pans only from a direct primary-mouse drag on the bare
overflowing Board root. Descendant text and controls remain native, edge proximity can never
continue scrolling after pointer movement stops, and mobile touch remains owned by its separate
column-snap hook.
*/
function releasePointerCapture(session: BoardMousePanSession): void {
  const { element, pointerId } = session;
  try {
    if (element.hasPointerCapture?.(pointerId)) {
      element.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Browser teardown may release capture before React's cleanup; terminal cleanup is idempotent.
  }
}

export function useBoardMousePan(boardElement: HTMLElement | null): BoardMousePanBindings {
  const sessionRef = useRef<BoardMousePanSession | null>(null);
  const didPanRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const endSession = useCallback((pointerId: number, clearClickGuard: boolean) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== pointerId) return;
    releasePointerCapture(session);
    sessionRef.current = null;
    setIsPanning(false);
    if (clearClickGuard) didPanRef.current = false;
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    if (
      event.pointerType !== "mouse"
      || event.button !== 0
      || event.target !== element
      || element.scrollWidth <= element.clientWidth
    ) {
      return;
    }

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
      if (Math.abs(deltaX) < BOARD_MOUSE_PAN_THRESHOLD || Math.abs(deltaX) <= Math.abs(deltaY)) {
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
    endSession(event.pointerId, false);
  }, [endSession]);

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    endSession(event.pointerId, true);
  }, [endSession]);

  const onLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    endSession(event.pointerId, true);
  }, [endSession]);

  const onClickCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (!didPanRef.current) return;
    didPanRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (session) releasePointerCapture(session);
    sessionRef.current = null;
    didPanRef.current = false;
    setIsPanning(false);
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
