import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView direct draft persistence", () => {
  it("uses the retained direct draft key without room-specific drafts", () => {
    expect(source).toContain("fusion:chat-draft:");
    expect(source).not.toContain("roomId");
  });
});
