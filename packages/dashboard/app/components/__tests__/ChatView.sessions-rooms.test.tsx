import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView direct session list contract", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).toContain("chat-view-header-new-chat");
    expect(source).not.toContain("chat-sidebar-scope-toggle");
    expect(source).not.toContain("chat-create-room-btn");
  });
});
