import { describe, expect, it } from "vitest";
import { BUILTIN_CODING_WORKFLOW_IR } from "../workflows/builtin-coding-workflow-ir.js";
import { findUnrunRequiredPreMergeStepIds, resolveRequiredPreMergeStepIds } from "../merge/required-pre-merge-steps.js";

describe("resolveRequiredPreMergeStepIds", () => {
  it("includes default-on pre-merge groups when no explicit selection exists", () => {
    expect(resolveRequiredPreMergeStepIds(BUILTIN_CODING_WORKFLOW_IR, undefined))
      .toEqual(new Set(["plan-review", "code-review"]));
  });

  it("honours an explicit empty selection and excludes post-merge groups", () => {
    expect(resolveRequiredPreMergeStepIds(BUILTIN_CODING_WORKFLOW_IR, [])).toEqual(new Set());
    expect(resolveRequiredPreMergeStepIds(
      BUILTIN_CODING_WORKFLOW_IR,
      ["post-merge-verification"],
    )).toEqual(new Set());
  });

  it("includes explicitly enabled pre-merge groups regardless of their default", () => {
    expect(resolveRequiredPreMergeStepIds(
      BUILTIN_CODING_WORKFLOW_IR,
      ["browser-verification"],
    )).toEqual(new Set(["browser-verification"]));
  });
});

/*
FNXC:RequiredPreMergeSteps 2026-08-22-22:40 (FN-9191 wedge):
The auto-merge sweep's admission uses this to hold a card out of the merge queue until every
enabled pre-merge gate has reported. FN-9191's exact shape — both gates enabled, Plan Review
already passed, Code Review not yet started — must read as "unrun", and the same task after
Code Review lands must read as ready.
*/
describe("findUnrunRequiredPreMergeStepIds", () => {
  const planReviewPassed = {
    workflowStepId: "plan-review",
    workflowStepName: "Plan Review",
    status: "passed" as const,
    phase: "pre-merge" as const,
  };
  const codeReviewPassed = {
    workflowStepId: "code-review",
    workflowStepName: "Code Review",
    status: "passed" as const,
    phase: "pre-merge" as const,
  };

  it("reports the FN-9191 window: Code Review enabled but not yet started", () => {
    expect(findUnrunRequiredPreMergeStepIds(BUILTIN_CODING_WORKFLOW_IR, {
      enabledWorkflowSteps: ["plan-review", "code-review"],
      workflowStepResults: [planReviewPassed],
    })).toEqual(["code-review"]);
  });

  it("reports nothing once every enabled gate has a result", () => {
    expect(findUnrunRequiredPreMergeStepIds(BUILTIN_CODING_WORKFLOW_IR, {
      enabledWorkflowSteps: ["plan-review", "code-review"],
      workflowStepResults: [planReviewPassed, codeReviewPassed],
    })).toEqual([]);
  });

  it("reports nothing when the gates are disabled for the task", () => {
    expect(findUnrunRequiredPreMergeStepIds(BUILTIN_CODING_WORKFLOW_IR, {
      enabledWorkflowSteps: [],
      workflowStepResults: [],
    })).toEqual([]);
  });
});
