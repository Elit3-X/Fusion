import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView direct chat creation contract", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).not.toContain("NewChatDialog");
    expect(source).not.toContain("chatNewSessionMode");
    expect(source).toContain("handleNewChat");
  });
});
