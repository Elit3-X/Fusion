/*
FNXC:ChatComposer 2026-08-19-17:58:
Primary conversation composers protect the transcript by growing automatically through five rendered lines, then scrolling their own overflow. Desktop/tablet resizing is owned by a top-edge pointer drag so the bottom edge stays fixed; its current-draft override is never persisted and collapses as soon as measured content no longer warrants the chosen height.
*/

export const CHAT_INPUT_MAX_LINES = 5;
export const CHAT_INPUT_MIN_HEIGHT_PX = 40;
const FALLBACK_LINE_HEIGHT_PX = 20;
const FALLBACK_VERTICAL_PADDING_PX = 16;
const FALLBACK_VERTICAL_BORDER_PX = 2;

export interface ChatInputBoxMetrics {
  lineHeightPx: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  borderTopPx: number;
  borderBottomPx: number;
}

export interface ChatInputAutosizeController {
  resize(options?: { resetManual?: boolean }): void;
  reset(): void;
  destroy(): void;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseCssPixels(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function readComputedStyle(textarea: HTMLTextAreaElement): CSSStyleDeclaration | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  return window.getComputedStyle(textarea);
}

export function getChatInputBoxMetrics(textarea: HTMLTextAreaElement): ChatInputBoxMetrics {
  const style = readComputedStyle(textarea);
  const fontSize = finitePositive(parseCssPixels(style?.fontSize ?? "") ?? Number.NaN, 16);
  const lineHeightValue = style?.lineHeight ?? "";
  const parsedLineHeight = parseCssPixels(lineHeightValue);
  const lineHeightPx = finitePositive(
    parsedLineHeight === null
      ? Number.NaN
      : lineHeightValue.trim().endsWith("px")
        ? parsedLineHeight
        : parsedLineHeight * fontSize,
    FALLBACK_LINE_HEIGHT_PX,
  );

  return {
    lineHeightPx,
    paddingTopPx: parseCssPixels(style?.paddingTop) ?? FALLBACK_VERTICAL_PADDING_PX / 2,
    paddingBottomPx: parseCssPixels(style?.paddingBottom) ?? FALLBACK_VERTICAL_PADDING_PX / 2,
    borderTopPx: parseCssPixels(style?.borderTopWidth) ?? FALLBACK_VERTICAL_BORDER_PX / 2,
    borderBottomPx: parseCssPixels(style?.borderBottomWidth) ?? FALLBACK_VERTICAL_BORDER_PX / 2,
  };
}

export function getChatInputAutomaticMaxHeight(metrics: ChatInputBoxMetrics): number {
  const lineHeight = finitePositive(metrics.lineHeightPx, FALLBACK_LINE_HEIGHT_PX);
  const chrome = Math.max(0, metrics.paddingTopPx)
    + Math.max(0, metrics.paddingBottomPx)
    + Math.max(0, metrics.borderTopPx)
    + Math.max(0, metrics.borderBottomPx);
  return Math.max(CHAT_INPUT_MIN_HEIGHT_PX, Math.ceil(lineHeight * CHAT_INPUT_MAX_LINES + chrome));
}

// The default is a deterministic zero-layout fallback for callers that only have a scrollHeight.
// Mounted composers use getChatInputAutomaticMaxHeight so their actual line box and box chrome win.
export const CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX = getChatInputAutomaticMaxHeight({
  lineHeightPx: FALLBACK_LINE_HEIGHT_PX,
  paddingTopPx: FALLBACK_VERTICAL_PADDING_PX / 2,
  paddingBottomPx: FALLBACK_VERTICAL_PADDING_PX / 2,
  borderTopPx: FALLBACK_VERTICAL_BORDER_PX / 2,
  borderBottomPx: FALLBACK_VERTICAL_BORDER_PX / 2,
});

export function resolveChatInputOverflowY(
  scrollHeight: number,
  maxHeight: number = CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX,
): "auto" | "hidden" {
  return Number.isFinite(scrollHeight) && scrollHeight > maxHeight ? "auto" : "hidden";
}

export function clampChatInputHeight(
  scrollHeight: number,
  maxHeight: number = CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX,
): number {
  const safeMaxHeight = Math.max(CHAT_INPUT_MIN_HEIGHT_PX, finitePositive(maxHeight, CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX));
  const safeScrollHeight = Number.isFinite(scrollHeight) ? Math.max(0, scrollHeight) : 0;
  return Math.max(CHAT_INPUT_MIN_HEIGHT_PX, Math.min(safeScrollHeight, safeMaxHeight));
}

function readBorderBoxHeight(textarea: HTMLTextAreaElement, entry?: ResizeObserverEntry): number {
  const borderBoxSize = entry?.borderBoxSize;
  const observedSize = Array.isArray(borderBoxSize) ? borderBoxSize[0] : borderBoxSize;
  if (observedSize?.blockSize && observedSize.blockSize > 0) return observedSize.blockSize;

  const contentHeight = entry?.contentRect.height ?? 0;
  if (contentHeight > 0) {
    const metrics = getChatInputBoxMetrics(textarea);
    return contentHeight + metrics.paddingTopPx + metrics.paddingBottomPx + metrics.borderTopPx + metrics.borderBottomPx;
  }

  const rectHeight = textarea.getBoundingClientRect().height;
  if (rectHeight > 0) return rectHeight;
  if (textarea.offsetHeight > 0) return textarea.offsetHeight;
  return parseCssPixels(textarea.style.height) ?? 0;
}

/** Attach autosizing and desktop/tablet top-edge resizing to one mounted primary composer. */
export function createChatInputAutosizeController(textarea: HTMLTextAreaElement): ChatInputAutosizeController {
  let manualHeight: number | null = null;
  let appliedHeight = 0;
  let automaticMaxHeight = CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX;
  let activePointerId: number | null = null;
  let dragStartY = 0;
  let dragStartHeight = 0;
  let previousUserSelect = "";
  let destroyed = false;

  const isAutomaticOnlyViewport = () => typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 768px)").matches;

  const finishResize = () => {
    if (activePointerId === null) return;
    if (typeof textarea.hasPointerCapture === "function" && textarea.hasPointerCapture(activePointerId)) {
      textarea.releasePointerCapture(activePointerId);
    }
    activePointerId = null;
    document.body.style.userSelect = previousUserSelect;
  };

  const apply = (resetManual = false) => {
    if (destroyed) return;
    if (resetManual) manualHeight = null;

    automaticMaxHeight = getChatInputAutomaticMaxHeight(getChatInputBoxMetrics(textarea));
    const contentHeight = Number.isFinite(textarea.scrollHeight) ? textarea.scrollHeight : 0;
    const automaticHeight = clampChatInputHeight(contentHeight, automaticMaxHeight);

    // A manual height only belongs to the current measured draft. Once content is shorter than
    // it, resume automatic sizing rather than leaving an empty or shortened composer enlarged.
    if (manualHeight !== null && contentHeight < manualHeight) manualHeight = null;
    const nextHeight = manualHeight ?? automaticHeight;

    if (manualHeight === null) {
      // Reset the used height before reading scrollHeight so shrinking drafts recalculate too.
      textarea.style.height = "0px";
    }
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = resolveChatInputOverflowY(contentHeight, nextHeight);
    appliedHeight = nextHeight;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (destroyed || event.pointerType !== "mouse" || isAutomaticOnlyViewport()) return;
    const rect = textarea.getBoundingClientRect();
    if (rect.height <= 0) return;
    const topResizeBorder = Math.min(12, rect.height);
    if (event.clientY < rect.top || event.clientY > rect.top + topResizeBorder) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    dragStartY = event.clientY;
    dragStartHeight = Math.max(appliedHeight, readBorderBoxHeight(textarea));
    previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    textarea.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    const contentHeight = Number.isFinite(textarea.scrollHeight) ? textarea.scrollHeight : 0;
    const automaticHeight = clampChatInputHeight(contentHeight, automaticMaxHeight);
    const draggedHeight = Math.max(automaticHeight, dragStartHeight + dragStartY - event.clientY);
    manualHeight = draggedHeight > automaticHeight ? draggedHeight : null;
    textarea.style.height = `${manualHeight ?? automaticHeight}px`;
    textarea.style.overflowY = resolveChatInputOverflowY(contentHeight, manualHeight ?? automaticHeight);
    appliedHeight = manualHeight ?? automaticHeight;
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) finishResize();
  };

  textarea.addEventListener("pointerdown", onPointerDown);
  textarea.addEventListener("pointermove", onPointerMove);
  textarea.addEventListener("pointerup", onPointerEnd);
  textarea.addEventListener("pointercancel", onPointerEnd);

  // Keep the observer fence for layout-driven box changes, but never treat a controller-authored
  // resize as a new manual override. Pointer movement is the sole manual-resize authority.
  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === textarea);
        if (!entry || destroyed || Math.abs(readBorderBoxHeight(textarea, entry) - appliedHeight) < 1) return;
        automaticMaxHeight = getChatInputAutomaticMaxHeight(getChatInputBoxMetrics(textarea));
      });
  resizeObserver?.observe(textarea);

  apply();

  return {
    resize(options) {
      apply(options?.resetManual === true);
    },
    reset() {
      apply(true);
    },
    destroy() {
      if (destroyed) return;
      finishResize();
      destroyed = true;
      textarea.removeEventListener("pointerdown", onPointerDown);
      textarea.removeEventListener("pointermove", onPointerMove);
      textarea.removeEventListener("pointerup", onPointerEnd);
      textarea.removeEventListener("pointercancel", onPointerEnd);
      resizeObserver?.disconnect();
    },
  };
}
