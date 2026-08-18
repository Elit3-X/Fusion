import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBoardMousePan } from "../useBoardMousePan";

function PanHarness({ onClick = vi.fn() }: { onClick?: () => void }) {
  const [boardElement, setBoardElement] = useState<HTMLElement | null>(null);
  const { isPanning, ...bindings } = useBoardMousePan(boardElement);
  return (
    <main
      ref={(element) => setBoardElement(element)}
      className={isPanning ? "is-mouse-panning" : ""}
      data-panning={isPanning ? "true" : "false"}
      data-testid="board"
      onClick={onClick}
      {...bindings}
    >
      <button type="button" data-testid="button">Button</button>
      <input aria-label="Editable" data-testid="input" />
      <div data-id="FN-1" draggable="true" data-testid="card">Card</div>
      <div data-testid="surface">Safe surface</div>
    </main>
  );
}

function renderPanHarness(onClick = vi.fn()) {
  const result = render(<PanHarness onClick={onClick} />);
  const board = result.getByTestId("board");
  Object.defineProperty(board, "clientWidth", { configurable: true, value: 200 });
  Object.defineProperty(board, "scrollWidth", { configurable: true, value: 600 });
  return { ...result, board, safeSurface: result.getByTestId("surface") };
}

function pointerDown(target: HTMLElement, clientX = 100, clientY = 50, pointerId = 1, pointerType = "mouse") {
  fireEvent.pointerDown(target, { button: 0, clientX, clientY, pointerId, pointerType });
}

function pointerMove(target: HTMLElement, clientX: number, clientY = 50, pointerId = 1, pointerType = "mouse") {
  fireEvent.pointerMove(target, { clientX, clientY, pointerId, pointerType });
}

function pointerUp(target: HTMLElement, pointerId = 1, pointerType = "mouse") {
  fireEvent.pointerUp(target, { button: 0, clientX: 100, clientY: 50, pointerId, pointerType });
}

describe("useBoardMousePan", () => {
  it("pans horizontally by the inverse mouse delta in either direction", () => {
    const { board, safeSurface } = renderPanHarness();
    board.scrollLeft = 100;

    pointerDown(safeSurface);
    pointerMove(safeSurface, 140);
    expect(board.scrollLeft).toBe(60);
    expect(board).toHaveAttribute("data-panning", "true");

    pointerUp(safeSurface);
    board.scrollLeft = 100;
    pointerDown(safeSurface, 100, 50, 2);
    pointerMove(safeSurface, 70, 50, 2);
    expect(board.scrollLeft).toBe(130);
  });

  it("keeps taps and non-overflow surfaces from becoming pans or consuming clicks", () => {
    const onClick = vi.fn();
    const { board, safeSurface } = renderPanHarness(onClick);

    pointerDown(safeSurface);
    pointerUp(safeSurface);
    fireEvent.click(safeSurface);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(board).toHaveAttribute("data-panning", "false");

    board.scrollLeft = 100;
    Object.defineProperty(board, "scrollWidth", { configurable: true, value: 200 });
    pointerDown(safeSurface, 100, 50, 2);
    pointerMove(safeSurface, 140, 50, 2);
    pointerUp(safeSurface, 2);
    fireEvent.click(safeSurface);
    expect(board.scrollLeft).toBe(100);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("ignores touch, pen, and non-primary mouse input", () => {
    const onClick = vi.fn();
    const { board, safeSurface } = renderPanHarness(onClick);
    board.scrollLeft = 100;

    for (const [pointerType, pointerId] of [["touch", 1], ["pen", 2]] as const) {
      fireEvent.pointerDown(safeSurface, { button: 0, clientX: 100, clientY: 50, pointerId, pointerType });
      pointerMove(safeSurface, 40, 50, pointerId, pointerType);
      pointerUp(safeSurface, pointerId, pointerType);
    }
    fireEvent.pointerDown(safeSurface, { button: 2, clientX: 100, clientY: 50, pointerId: 3, pointerType: "mouse" });
    pointerMove(safeSurface, 40, 50, 3);
    pointerUp(safeSurface, 3);

    expect(board.scrollLeft).toBe(100);
    expect(board).toHaveAttribute("data-panning", "false");
    fireEvent.click(safeSurface);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not capture interactive, editable, or native-draggable card targets", () => {
    const { board, getByTestId } = renderPanHarness();
    board.scrollLeft = 100;

    for (const target of [getByTestId("button"), getByTestId("input"), getByTestId("card")]) {
      pointerDown(target);
      pointerMove(target, 40);
      pointerUp(target);
    }

    expect(board.scrollLeft).toBe(100);
    expect(board).toHaveAttribute("data-panning", "false");
  });

  it("suppresses one compatibility click after a true pan, then allows later clicks", () => {
    const onClick = vi.fn();
    const { safeSurface } = renderPanHarness(onClick);

    pointerDown(safeSurface);
    pointerMove(safeSurface, 140);
    pointerUp(safeSurface);
    fireEvent.click(safeSurface);
    fireEvent.click(safeSurface);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("ends panning on cancel and lost capture without leaving a stale click guard", () => {
    const onClick = vi.fn();
    const { board, safeSurface } = renderPanHarness(onClick);

    pointerDown(safeSurface);
    pointerMove(safeSurface, 140);
    fireEvent.pointerCancel(safeSurface, { pointerId: 1 });
    expect(board).toHaveAttribute("data-panning", "false");
    fireEvent.click(safeSurface);

    pointerDown(safeSurface, 100, 50, 2);
    pointerMove(safeSurface, 140, 50, 2);
    fireEvent.lostPointerCapture(safeSurface, { pointerId: 2 });
    expect(board).toHaveAttribute("data-panning", "false");
    fireEvent.click(safeSurface);

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("releases pointer capture during unmount cleanup", () => {
    const { board, safeSurface, unmount } = renderPanHarness();
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => true);
    const releasePointerCapture = vi.fn();
    Object.defineProperty(board, "setPointerCapture", { configurable: true, value: setPointerCapture });
    Object.defineProperty(board, "hasPointerCapture", { configurable: true, value: hasPointerCapture });
    Object.defineProperty(board, "releasePointerCapture", { configurable: true, value: releasePointerCapture });

    pointerDown(safeSurface);
    unmount();

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });
});
