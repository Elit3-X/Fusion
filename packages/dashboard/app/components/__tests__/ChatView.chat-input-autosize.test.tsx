import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_INPUT_MAX_LINES,
  CHAT_INPUT_MIN_HEIGHT_PX,
  clampChatInputHeight,
  createChatInputAutosizeController,
  getChatInputAutomaticMaxHeight,
  resolveChatInputOverflowY,
} from "../../utils/chatInputAutosize";

const chatViewCss = readFileSync(resolve(__dirname, "../ChatView.css"), "utf8");

function fiveLineHeight() {
  return getChatInputAutomaticMaxHeight({
    lineHeightPx: 20,
    paddingTopPx: 8,
    paddingBottomPx: 8,
    borderTopPx: 1,
    borderBottomPx: 1,
  });
}

describe("ChatView chat input autosize", () => {
  it("uses the shared five-line automatic cap and keeps desktop resize available", () => {
    const textareaRule = chatViewCss.match(/\.chat-input-textarea\s*\{[^}]*\}/);

    expect(textareaRule).not.toBeNull();
    expect(textareaRule?.[0]).toContain("max-height: none");
    expect(textareaRule?.[0]).toContain("resize: vertical");
    expect(textareaRule?.[0]).toContain("overflow-y: hidden");
    expect(textareaRule?.[0]).toContain("min-height: calc(var(--space-2xl) + var(--space-sm))");
    expect(chatViewCss).toMatch(/@media \(max-width: 768px\)\s*\{[\s\S]*?\.chat-input-textarea\s*\{[^}]*resize: none/);
  });

  it("keeps the stop button dimensions aligned with the send button and textarea minimum", () => {
    const rowRule = chatViewCss.match(/\.chat-input-row\s*\{[^}]*\}/);
    const textareaRule = chatViewCss.match(/\.chat-input-textarea\s*\{[^}]*\}/);
    const sendRule = chatViewCss.match(/\.chat-input-send\s*\{[^}]*\}/);
    const stopRule = chatViewCss.match(/\.chat-input-stop\s*\{[^}]*\}/);

    expect(rowRule).not.toBeNull();
    expect(textareaRule).not.toBeNull();
    expect(sendRule).not.toBeNull();
    expect(stopRule).not.toBeNull();
    expect(rowRule?.[0]).toContain("--chat-input-control-size: calc(var(--space-lg) * 2.5)");
    expect(textareaRule?.[0]).toContain("min-height: calc(var(--space-2xl) + var(--space-sm))");
    expect(sendRule?.[0]).toContain("width: var(--chat-input-control-size)");
    expect(sendRule?.[0]).toContain("min-height: var(--chat-input-control-size)");
    expect(stopRule?.[0]).toContain("width: var(--chat-input-control-size)");
    expect(stopRule?.[0]).toContain("min-height: var(--chat-input-control-size)");
  });

  it("derives the automatic maximum from five rendered line boxes and box chrome", () => {
    expect(CHAT_INPUT_MAX_LINES).toBe(5);
    expect(getChatInputAutomaticMaxHeight({
      lineHeightPx: 20,
      paddingTopPx: 8,
      paddingBottomPx: 8,
      borderTopPx: 1,
      borderBottomPx: 1,
    })).toBe(118);
    expect(getChatInputAutomaticMaxHeight({
      lineHeightPx: 24,
      paddingTopPx: 12,
      paddingBottomPx: 12,
      borderTopPx: 2,
      borderBottomPx: 2,
    })).toBe(148);
  });

  it("uses a safe minimum for empty and zero measurements", () => {
    expect(clampChatInputHeight(0, fiveLineHeight())).toBe(CHAT_INPUT_MIN_HEIGHT_PX);
    expect(clampChatInputHeight(Number.NaN, fiveLineHeight())).toBe(CHAT_INPUT_MIN_HEIGHT_PX);
    expect(clampChatInputHeight(80, fiveLineHeight())).toBe(80);
  });

  it("caps content at five lines and selects internal scrolling beyond the cap", () => {
    const maxHeight = fiveLineHeight();
    expect(clampChatInputHeight(maxHeight - 1, maxHeight)).toBe(maxHeight - 1);
    expect(clampChatInputHeight(maxHeight + 1, maxHeight)).toBe(maxHeight);
    expect(resolveChatInputOverflowY(maxHeight, maxHeight)).toBe("hidden");
    expect(resolveChatInputOverflowY(maxHeight + 1, maxHeight)).toBe("auto");
  });

  it("keeps an explicit desktop height through controlled updates and resets it explicitly", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    let scrollHeight = 220;
    Object.defineProperty(textarea, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    const controller = createChatInputAutosizeController(textarea);
    const automaticHeight = Number.parseInt(textarea.style.height, 10);
    expect(automaticHeight).toBeLessThan(scrollHeight);

    textarea.style.height = "300px";
    textarea.dispatchEvent(new Event("resize"));
    expect(textarea.style.height).toBe("300px");

    scrollHeight = 240;
    controller.resize();
    expect(textarea.style.height).toBe("300px");
    expect(textarea.style.overflowY).toBe("hidden");

    scrollHeight = 0;
    controller.reset();
    expect(textarea.style.height).toBe(`${CHAT_INPUT_MIN_HEIGHT_PX}px`);
    expect(textarea.style.overflowY).toBe("hidden");

    controller.destroy();
    textarea.remove();
  });

  it("does not capture its own programmatic resize as a manual override", () => {
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 220, writable: true });
    const controller = createChatInputAutosizeController(textarea);

    controller.resize();
    const automaticHeight = textarea.style.height;
    expect(automaticHeight).not.toBe("300px");

    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 0, writable: true });
    controller.resize({ resetManual: true });
    expect(textarea.style.height).toBe(`${CHAT_INPUT_MIN_HEIGHT_PX}px`);

    controller.destroy();
    textarea.remove();
  });
});
