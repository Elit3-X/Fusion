import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const files = [
  "../planner/planner-intervention.ts", "../task-store/audit-ops.ts", "../task-store/branch-group-ops.ts",
  "../task-store/merge-queue-ops-2.ts", "../task-store/task-mutation-ops.ts", "../task-store/workflow-integrity.ts",
  "../task-store/workflow-workitems-ops.ts", "../task-store/workflow-workitems-ops-2.ts", "../task-store/task-artifacts-ops.ts",
  "../task-store/lifecycle-ops.ts", "../task-store/task-id-integrity.ts",
];

describe("core run-audit emitter isolation", () => {
  it("routes every best-effort core emitter through the bounded seam", () => {
    for (const relative of files) {
      const source = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
      expect(source, relative).toContain("emitBoundedRunAudit");
      // Interface fields and host adapters may retain this identifier; only direct void/await calls are forbidden.
      expect(source.match(/(?:await|void)\s+(?:\([^)]*\)\.)?recordRunAuditEvent\??\s*\(/g), relative).toBeNull();
    }
  });
});
