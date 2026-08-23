import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView mobile rendering has a single direct composer", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).toContain("messageInput");
    expect(source).not.toContain("chat-room-composer");
  });
});
