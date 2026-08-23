import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView mobile host has no rooms or new-chat dialog", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).not.toContain("chat-sidebar-footer");
    expect(source).not.toContain("NewChatDialog");
  });
});
