import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "app/components/ChatView.tsx"), "utf8");

describe("ChatView brain control remains on direct composer", () => {
  it("keeps removed Rooms UI out of the direct chat surface", () => {
    expect(source).toContain("ChatThinkingLevelControl");
    expect(source).not.toContain("chatNewSessionMode");
  });
});
