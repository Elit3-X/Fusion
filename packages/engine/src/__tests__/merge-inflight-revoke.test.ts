import { describe, expect, it } from "vitest";

import { MergeGateRevokedError } from "../merge/merger-errors.js";

/*
 * FNXC:MergeInFlightRevoke 2026-08-23-09:15:
 * FN-180 makes a changed review gate a deferral at the ref-advance fence. It must retain its own
 * error type so callers cannot convert a REVISE arriving mid-merge into a retry or failed park.
 */
describe("FN-180 merge in-flight revoke", () => {
  it("uses a dedicated non-merge-failure error for a revoked review gate", () => {
    const error = new MergeGateRevokedError("review changed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MergeGateRevokedError");
  });

  it("fences both singular and workspace ref advances with the current task read", async () => {
    const source = await (await import("node:fs/promises")).readFile(
      new URL("../merge/merger-ai.ts", import.meta.url), "utf8",
    );
    expect(source).toContain("async function assertMergeGateStillOpen");
    expect(source).toContain("throw new MergeGateRevokedError");
    expect((source.match(/assertMergeGateStillOpen\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("assertMergeGenerationOwned");
  });
});
