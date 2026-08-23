import { describe, expect, it } from "vitest";
import { getRunningWorkflowStepLabel, getUnifiedTaskProgress } from "../taskProgress";

describe("review-gated progress", () => {
  const task = {
    steps: [{ name: "Implement", status: "done" as const }],
    enabledWorkflowSteps: ["verification", "code-review", "documentation-delivery"],
    workflowStepResults: [{ workflowStepId: "verification", workflowStepName: "Verification", phase: "pre-merge" as const, source: "optional-group" as const, status: "pending" as const, startedAt: "2026-08-23T00:00:00.000Z" }],
  };

  it("excludes review gates from implementation progress and orders them after steps in full progress", () => {
    expect(getUnifiedTaskProgress(task, { scope: "implementation" }).items.map((item) => item.name)).toEqual(["Implement"]);
    expect(getUnifiedTaskProgress(task).items.map((item) => item.name)).toEqual(["Implement", "Verification", "Code Review", "Documentation Delivery"]);
  });

  it("uses the persisted verification name for the running-gate badge", () => {
    expect(getRunningWorkflowStepLabel(task)).toBe("Verification");
  });
});
