import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView direct-only UI contract", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).not.toContain("useChatRooms");
    expect(source).not.toContain("chatScope");
    expect(source).not.toContain("CreateRoomModal");
  });
});
