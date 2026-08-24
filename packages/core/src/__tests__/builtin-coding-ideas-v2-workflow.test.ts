import { describe, expect, it } from "vitest";
import { resolveRequiredPreMergeStepIds } from "../merge/required-pre-merge-steps.js";
import { BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR } from "../workflows/builtin-coding-ideas-v2-workflow-ir.js";
import { BUILTIN_CODING_IDEAS_WORKFLOW_IR } from "../workflows/builtin-coding-ideas-workflow-ir.js";
import { getBuiltinWorkflow } from "../workflows/builtin-workflows.js";
import { parseWorkflowIr, serializeWorkflowIr } from "../workflows/workflow-ir.js";
import { resolveWorkflowOptionalSteps } from "../workflows/workflow-optional-steps.js";

/** The single-success-edge walk an executing task actually follows from a node. */
function successChainFrom(start: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = start;
  while (current && !seen.has(current)) {
    seen.add(current);
    const edge = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.edges
      .find((candidate) => candidate.from === current && candidate.condition === "success");
    if (!edge) break;
    chain.push(edge.to);
    current = edge.to;
  }
  return chain;
}

describe("builtin:coding-ideas-v2", () => {
  it("is a selectable validated workflow that keeps the Ideas intake untouched", () => {
    const workflow = getBuiltinWorkflow("builtin:coding-ideas-v2");
    expect(workflow?.name).toBe("Coding (Ideas) V2");
    expect(parseWorkflowIr(serializeWorkflowIr(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR)))
      .toEqual(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR);

    // The whole point of the Ideas board: cards park in a manual intake and the
    // engine must not plan them until an operator promotes them.
    expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.columns)
      .toEqual(BUILTIN_CODING_IDEAS_WORKFLOW_IR.columns);
    const intake = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.columns.find((column) => column.id === "ideas");
    expect(intake?.traits).toEqual([{ trait: "intake", config: { autoTriage: false } }]);
  });

  it("runs verify -> document -> review -> summarize -> merge in review", () => {
    expect(successChainFrom("steps")).toEqual([
      "verification",
      "documentation-delivery",
      "code-review",
      "completion-summary",
      "merge-gate",
    ]);

    for (const nodeId of ["verification", "documentation-delivery", "code-review", "completion-summary"]) {
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === nodeId)?.column)
        .toBe("in-review");
    }

    // Coding (Ideas) carries no post-merge-verification node, so V2 inherits none either.
    expect(resolveWorkflowOptionalSteps(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR).map((step) => step.templateId))
      .toEqual(["plan-review", "verification", "documentation-delivery", "code-review"]);
    expect(resolveRequiredPreMergeStepIds(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR, undefined))
      .toEqual(new Set(["plan-review", "verification", "documentation-delivery", "code-review"]));
  });

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
  Both remediation loops must re-enter at `verification`, never at `code-review`. A REVISE has to
  replay documentation-delivery so the docs and changeset are regenerated to include what the review
  demanded; re-entering at the review would merge documentation describing a superseded tree.
  */
  it("replays documentation on rework by re-entering upstream of it", () => {
    expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.edges).toEqual(expect.arrayContaining([
      { from: "verification", to: "verification-remediation", condition: "failure" },
      { from: "code-review", to: "code-review-remediation", condition: "failure" },
      { from: "verification-remediation", to: "verification", condition: "success", kind: "rework" },
      { from: "code-review-remediation", to: "verification", condition: "success", kind: "rework" },
    ]));
    // Re-entering at `verification` only replays the docs because the doc node sits downstream of it.
    expect(successChainFrom("verification")).toContain("documentation-delivery");

    for (const remediationId of ["verification-remediation", "code-review-remediation"]) {
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === remediationId)?.column)
        .toBe("in-progress");
    }
  });

  it("stops the planner emitting the gates as duplicate implementation steps", () => {
    const ir = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR;
    const plan = ir.nodes.find((node) => node.id === "plan");
    const parse = ir.nodes.find((node) => node.id === "parse");
    const planReview = ir.nodes.find((node) => node.id === "plan-review");
    const planReviewTemplate = planReview?.config.template as { nodes?: Array<{ config?: Record<string, unknown> }> };

    expect(plan?.config?.seam).toBe("planning-implementation-only");
    expect(parse?.config).toMatchObject({ implementationOnlySteps: true, preserveRemediationSteps: true });
    expect(planReviewTemplate.nodes?.[0]?.config).toMatchObject({ requireImplementationOnlySteps: true });
  });

  it("never mutates the inherited Coding (Ideas) graph", () => {
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.some((node) => node.id === "verification")).toBe(false);
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.some((node) => node.id === "documentation-delivery")).toBe(false);
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.edges).toEqual(expect.arrayContaining([
      { from: "steps", to: "completion-summary", condition: "success" },
    ]));
  });
});
