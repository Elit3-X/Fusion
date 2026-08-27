import { describe, expect, it } from "vitest";
import "../builtin-traits.js";
import type { Task, WorkflowStepResult } from "../types.js";
import { MANUAL_RETRY_RESET_COUNTER_KEYS } from "../tasks/manual-retry-reset.js";
import { planTaskColumnRestart } from "../tasks/task-column-restart.js";
import type { WorkflowIr } from "../workflows/workflow-ir-types.js";

const ir: WorkflowIr = {
  version: "v2",
  name: "restart-test",
  columns: [
    { id: "planning", name: "Planning", traits: [{ trait: "intake" }, { trait: "hold" }] },
    { id: "building", name: "Building", traits: [{ trait: "wip" }] },
    { id: "review", name: "Review", traits: [{ trait: "merge-blocker" }, { trait: "human-review" }] },
    { id: "done", name: "Done", traits: [{ trait: "complete" }] },
    { id: "archive", name: "Archive", traits: [{ trait: "archived" }] },
  ],
  nodes: [
    { id: "plan", kind: "prompt", column: "planning" },
    { id: "execute", kind: "prompt", column: "building" },
    { id: "review-node", kind: "optional-group", column: "review" },
    { id: "post-review", kind: "optional-group", column: "review", config: { phase: "post-merge" } },
  ],
  edges: [],
};

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-204",
    description: "restart",
    column: "planning",
    dependencies: [],
    steps: [],
    currentStep: 0,
    ...overrides,
  } as Task;
}

function plan(overrides: Partial<Task> = {}, entryColumn = overrides.column ?? "planning") {
  return planTaskColumnRestart({ task: task(overrides), ir, entryNode: { id: "entry", column: entryColumn }, now: "2026-08-28T00:00:00.000Z" });
}

describe("planTaskColumnRestart", () => {
  it("replans an intake/hold column without clearing implementation pointers", () => {
    const result = plan({ worktree: "/worktree", steps: [{ description: "old", status: "done" }] });
    expect(result).toMatchObject({ kind: "restart", scope: "plan", deletePrompt: true, entryNodeId: "entry" });
    if (result.kind !== "restart") return;
    expect(result.patch).toMatchObject({ status: "needs-replan", steps: [], currentStep: 0 });
    expect("worktree" in result.patch).toBe(false);
  });

  it("restarts implementation while preserving its plan", () => {
    const result = plan({ column: "building", worktree: "/worktree", branch: "fusion/fn-204", steps: [{ description: "build", status: "done" }] }, "building");
    expect(result).toMatchObject({ kind: "restart", scope: "implementation", releaseSymbolLocks: true });
    if (result.kind !== "restart") return;
    expect(result.patch).toMatchObject({ currentStep: 0, worktree: null, branch: null, branchWriteOrigin: "engine" });
    expect(result.patch.steps?.map((step) => step.status)).toEqual(["pending"]);
  });

  it("restarts review without clearing completed implementation", () => {
    const result = plan({ column: "review", worktree: "/worktree", steps: [{ description: "build", status: "done" }] }, "review");
    expect(result).toMatchObject({ kind: "restart", scope: "review" });
    if (result.kind !== "restart") return;
    expect(result.patch.review).toBeNull();
    expect(result.patch.aiMergeReviewReconciliation).toBeNull();
    expect("steps" in result.patch).toBe(false);
    expect("worktree" in result.patch).toBe(false);
  });

  it("discards only restarted pre-merge results, preserving post-merge evidence and duplicates elsewhere", () => {
    const results = [
      { workflowStepId: "plan", status: "passed" },
      { workflowStepId: "review-node", status: "failed" },
      { workflowStepId: "review-node", status: "pending" },
      { workflowStepId: "execute", status: "passed" },
      { workflowStepId: "post-review", status: "passed", phase: "post-merge" },
    ] as WorkflowStepResult[];
    const result = plan({ column: "review", workflowStepResults: results }, "review");
    if (result.kind !== "restart") throw new Error("expected restart plan");
    expect(result.discardedWorkflowStepIds).toEqual(["review-node", "review-node"]);
    expect(result.patch.workflowStepResults?.map((item) => item.workflowStepId)).toEqual(["plan", "execute", "post-review"]);
  });

  it("drops only failed/pending review orphans", () => {
    const results = ["failed", "pending", "passed", "skipped"].map((status) => ({ workflowStepId: `orphan-${status}`, status })) as WorkflowStepResult[];
    const review = plan({ column: "review", workflowStepResults: results }, "review");
    if (review.kind !== "restart") throw new Error("expected restart plan");
    expect(review.discardedWorkflowStepIds).toEqual(["orphan-failed", "orphan-pending"]);
    expect(review.patch.workflowStepResults?.map((item) => item.workflowStepId)).toEqual(["orphan-passed", "orphan-skipped"]);
    const implementation = plan({ column: "building", workflowStepResults: results }, "building");
    if (implementation.kind !== "restart") throw new Error("expected restart plan");
    expect(implementation.patch.workflowStepResults).toEqual(results);
  });

  it("refuses terminal, workspace, and non-entry-column stages before producing a patch", () => {
    expect(plan({ column: "done" }, "done")).toMatchObject({ kind: "refused", reason: "terminal-column" });
    expect(plan({ column: "archive" }, "archive")).toMatchObject({ kind: "refused", reason: "archived-column" });
    expect(plan({ workspaceWorktrees: { api: { worktreePath: "/worktree", branch: "fusion/fn-204" } } }, "planning")).toMatchObject({ kind: "refused", reason: "workspace-task" });
    const result = plan({ column: "planning" }, "building");
    expect(result).toMatchObject({ kind: "refused", reason: "no-entry-node-in-column", detail: { resolvedEntryNodeColumn: "building" } });
    expect("patch" in result).toBe(false);
  });

  it("owns no pause lifecycle keys and resets every manual retry counter", () => {
    const result = plan({ paused: true, userPaused: true, pausedReason: "in-review-stall-deadlock" });
    if (result.kind !== "restart") throw new Error("expected restart plan");
    for (const key of MANUAL_RETRY_RESET_COUNTER_KEYS) expect(result.patch[key]).toBe(0);
    expect("paused" in result.patch).toBe(false);
    expect("userPaused" in result.patch).toBe(false);
    expect("pausedReason" in result.patch).toBe(false);
  });
});
