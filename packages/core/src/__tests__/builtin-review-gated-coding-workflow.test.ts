import { describe, expect, it } from "vitest";
import { resolveRequiredPreMergeStepIds } from "../merge/required-pre-merge-steps.js";
import { BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR } from "../workflows/builtin-review-gated-coding-workflow-ir.js";
import { BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR } from "../workflows/builtin-stepwise-final-review-coding-workflow-ir.js";
import { getBuiltinWorkflow } from "../workflows/builtin-workflows.js";
import { parseWorkflowIr, serializeWorkflowIr } from "../workflows/workflow-ir.js";
import { resolveWorkflowOptionalSteps } from "../workflows/workflow-optional-steps.js";

describe("builtin:review-gated-coding", () => {
  it("is a selectable validated workflow with review-owned gates", () => {
    const workflow = getBuiltinWorkflow("builtin:review-gated-coding");
    expect(workflow?.name).toBe("Coding (review-gated)");
    expect(parseWorkflowIr(serializeWorkflowIr(BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR)))
      .toEqual(BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR);

    expect(resolveWorkflowOptionalSteps(BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR)).toEqual([
      { templateId: "plan-review", name: "Plan Review", description: "", phase: "pre-merge", defaultOn: true },
      { templateId: "verification", name: "Verification", description: "", phase: "pre-merge", defaultOn: true },
      { templateId: "code-review", name: "Code Review", description: "", phase: "pre-merge", defaultOn: true },
      { templateId: "documentation-delivery", name: "Documentation", description: "", phase: "pre-merge", defaultOn: true },
      { templateId: "post-merge-verification", name: "Post-merge verification", description: "", phase: "post-merge", defaultOn: false },
    ]);
    expect(resolveRequiredPreMergeStepIds(BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR, undefined))
      .toEqual(new Set(["plan-review", "verification", "code-review", "documentation-delivery"]));
  });

  it("routes failures through explicit remediation before replaying verification", () => {
    const ir = BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR;
    const parse = ir.nodes.find((node) => node.id === "parse");
    const planReview = ir.nodes.find((node) => node.id === "plan-review");
    const planReviewTemplate = planReview?.config.template as { nodes?: Array<{ config?: Record<string, unknown> }> };

    expect(parse?.config).toMatchObject({ implementationOnlySteps: true, preserveRemediationSteps: true });
    expect(planReviewTemplate.nodes?.[0]?.config).toMatchObject({ requireImplementationOnlySteps: true });
    expect(ir.edges).toEqual(expect.arrayContaining([
      { from: "verification", to: "verification-remediation", condition: "failure" },
      { from: "code-review", to: "code-review-remediation-steps", condition: "failure" },
      { from: "verification-remediation", to: "verification", condition: "success", kind: "rework" },
      { from: "code-review-remediation-steps", to: "verification", condition: "success", kind: "rework" },
    ]));
  });

  it("leaves the default coding IR's plan review contract unchanged", () => {
    const planReview = BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR.nodes.find((node) => node.id === "plan-review");
    const template = planReview?.config.template as { nodes?: Array<{ config?: Record<string, unknown> }> };
    expect(template.nodes?.[0]?.config?.requireImplementationOnlySteps).toBeUndefined();
  });
});
