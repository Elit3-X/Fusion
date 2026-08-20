import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardMousePan } from "../useBoardMousePan";

function PanHarness({ onClick = vi.fn() }: { onClick?: () => void }) {
  const [boardElement, setBoardElement] = useState<HTMLElement | null>(null);
  const { isPanning, ...bindings } = useBoardMousePan(boardElement);
  return (
    <main
      ref={setBoardElement}
      className={isPanning ? "is-mouse-panning" : ""}
      data-panning={isPanning ? "true" : "false"}
      data-testid="board"
      onClick={onClick}
      {...bindings}
    >
      <p data-testid="empty-text">No tasks</p>
      <button type="button" data-testid="button">Button</button>
      <input aria-label="Editable" data-testid="input" />
      <article data-testid="card">Card</article>
    </main>
  );
}

function renderPanHarness(onClick = vi.fn()) {
  const result = render(<PanHarness onClick={onClick} />);
  const board = result.getByTestId("board");
  Object.defineProperty(board, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(board, "scrollWidth", { configurable: true, value: 600 });
  return { ...result, board };
}

function pointerDown(target: HTMLElement, clientX = 100, clientY = 50, pointerId = 1, pointerType = "mouse", button = 0) {
  fireEvent.pointerDown(target, { button, clientX, clientY, pointerId, pointerType });
}

function pointerMove(target: HTMLElement, clientX: number, clientY = 50, pointerId = 1, pointerType = "mouse") {
  fireEvent.pointerMove(target, { clientX, clientY, pointerId, pointerType });
}

function pointerUp(target: HTMLElement, pointerId = 1, pointerType = "mouse") {
  fireEvent.pointerUp(target, { button: 0, clientX: 100, clientY: 50, pointerId, pointerType });
}

describe("useBoardMousePan", () => {
  it("pans direct Board-root primary mouse drags by inverse horizontal delta in both directions", () => {
    const { board } = renderPanHarness();
    board.scrollLeft = 100;

    pointerDown(board);
    pointerMove(board, 140);
    expect(board.scrollLeft).toBe(60);
    expect(board).toHaveAttribute("data-panning", "true");
    pointerUp(board);

    board.scrollLeft = 100;
    pointerDown(board, 100, 50, 2);
    pointerMove(board, 70, 50, 2);
    expect(board.scrollLeft).toBe(130);
  });

  it("does not pan before horizontal intent, vertically, or without overflow", () => {
    const { board } = renderPanHarness();
    board.scrollLeft = 100;

    pointerDown(board);
    pointerMove(board, 103);
    pointerMove(board, 104, 110);
    pointerUp(board);
    expect(board.scrollLeft).toBe(100);

    Object.defineProperty(board, "scrollWidth", { configurable: true, value: 200 });
    pointerDown(board, 100, 50, 2);
    pointerMove(board, 140, 50, 2);
    pointerUp(board, 2);
    expect(board.scrollLeft).toBe(100);
  });

  it("never starts from text, cards, or controls", () => {
    const { board, getByTestId } = renderPanHarness();
    board.scrollLeft = 100;

    for (const [index, target] of [
      getByTestId("empty-text"),
      getByTestId("card"),
      getByTestId("button"),
      getByTestId("input"),
    ].entries()) {
      const pointerId = index + 1;
      pointerDown(target, 100, 50, pointerId);
      pointerMove(target, 40, 50, pointerId);
      pointerUp(target, pointerId);
    }

    expect(board.scrollLeft).toBe(100);
    expect(board).toHaveAttribute("data-panning", "false");
  });

  it("ignores touch, pen, and non-primary mouse input", () => {
    const { board } = renderPanHarness();
    board.scrollLeft = 100;

    for (const [pointerType, pointerId] of [["touch", 1], ["pen", 2]] as const) {
      pointerDown(board, 100, 50, pointerId, pointerType);
      pointerMove(board, 40, 50, pointerId, pointerType);
      pointerUp(board, pointerId, pointerType);
    }
    pointerDown(board, 100, 50, 3, "mouse", 2);
    pointerMove(board, 40, 50, 3);
    pointerUp(board, 3);

    expect(board.scrollLeft).toBe(100);
    expect(board).toHaveAttribute("data-panning", "false");
  });

  it("only changes scrollLeft during pointer moves and suppresses one compatibility click after panning", () => {
    const onClick = vi.fn();
    const { board } = renderPanHarness(onClick);
    board.scrollLeft = 100;

    pointerDown(board);
    pointerMove(board, 190);
    const scrollAfterMove = board.scrollLeft;
    pointerUp(board);
    expect(board.scrollLeft).toBe(scrollAfterMove);
    fireEvent.click(board);
    fireEvent.click(board);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("cleans active feedback and click guards on cancellation, lost capture, and unmount", () => {
    const onClick = vi.fn();
    const { board, unmount } = renderPanHarness(onClick);
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.defineProperties(board, {
      setPointerCapture: { configurable: true, value: setPointerCapture },
      hasPointerCapture: { configurable: true, value: hasPointerCapture },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
    });

    pointerDown(board);
    pointerMove(board, 140);
    fireEvent.pointerCancel(board, { pointerId: 1 });
    expect(board).toHaveAttribute("data-panning", "false");
    fireEvent.click(board);

    pointerDown(board, 100, 50, 2);
    pointerMove(board, 140, 50, 2);
    fireEvent.lostPointerCapture(board, { pointerId: 2 });
    expect(board).toHaveAttribute("data-panning", "false");
    fireEvent.click(board);

    pointerDown(board, 100, 50, 3);
    unmount();
    expect(setPointerCapture).toHaveBeenCalledWith(3);
    expect(releasePointerCapture).toHaveBeenCalledWith(3);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
