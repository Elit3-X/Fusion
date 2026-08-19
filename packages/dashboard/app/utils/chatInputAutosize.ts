/*
FNXC:ChatComposer 2026-08-19-02:00:
Primary conversation composers protect the transcript by growing automatically through five rendered lines, then scrolling their own overflow. A native desktop/tablet resize is an explicit current-draft override; it is never persisted and is cleared when the draft is cleared or the composer target is replaced.
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

/**
 * Attach autosizing to one mounted primary composer. The ResizeObserver is deliberately used as
 * the native vertical resize signal: unlike a pointer handler, it also recognizes keyboard and
 * assistive-technology resizing without inventing a custom resize affordance.
 */
export function createChatInputAutosizeController(textarea: HTMLTextAreaElement): ChatInputAutosizeController {
  let manualHeight: number | null = null;
  let appliedHeight = 0;
  let automaticMaxHeight = CHAT_INPUT_DEFAULT_MAX_HEIGHT_PX;
  let destroyed = false;

  const apply = (resetManual = false) => {
    if (destroyed) return;
    if (resetManual) manualHeight = null;

    automaticMaxHeight = getChatInputAutomaticMaxHeight(getChatInputBoxMetrics(textarea));
    const contentHeight = Number.isFinite(textarea.scrollHeight) ? textarea.scrollHeight : 0;
    const nextHeight = manualHeight ?? clampChatInputHeight(contentHeight, automaticMaxHeight);

    if (manualHeight === null) {
      // Reset the used height before reading scrollHeight so shrinking drafts recalculate too.
      textarea.style.height = "0px";
    }
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = resolveChatInputOverflowY(contentHeight, nextHeight);
    appliedHeight = nextHeight;
  };

  const observeNativeResize = (entry?: ResizeObserverEntry) => {
    if (destroyed) return;
    const observedHeight = readBorderBoxHeight(textarea, entry);
    if (!observedHeight || Math.abs(observedHeight - appliedHeight) < 1) return;

    const nextAutomaticMaxHeight = getChatInputAutomaticMaxHeight(getChatInputBoxMetrics(textarea));
    automaticMaxHeight = nextAutomaticMaxHeight;
    if (observedHeight <= nextAutomaticMaxHeight) return;

    // Only a height beyond the automatic five-line ceiling becomes a manual override. Our own
    // writes are fenced by appliedHeight, so controlled value updates cannot capture themselves.
    manualHeight = observedHeight;
    textarea.style.height = `${observedHeight}px`;
    textarea.style.overflowY = resolveChatInputOverflowY(textarea.scrollHeight, observedHeight);
    appliedHeight = observedHeight;
  };

  const onResizeEvent = () => observeNativeResize();
  textarea.addEventListener("resize", onResizeEvent);

  const resizeObserver = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver((entries) => {
        const entry = entries.find((candidate) => candidate.target === textarea);
        observeNativeResize(entry);
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
      destroyed = true;
      textarea.removeEventListener("resize", onResizeEvent);
      resizeObserver?.disconnect();
    },
  };
}
