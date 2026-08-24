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

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-06:45:
  `completion-summary` sits BEFORE `code-review`, like the inherited graph. Putting it after looks
  better (the blurb could describe the approved state) and passes the review seal, because a
  readonly node is not write-capable — but it still acquires a worktree, and anything running
  between the review and the merge invalidates FN-180's review-diff fingerprint:
  "task has no provable approval for the content being merged". Measured in pipeline-smoke S01.
  */
  it("runs verify -> document -> summarize -> review -> merge in review", () => {
    expect(successChainFrom("steps")).toEqual([
      "verification",
      "documentation-delivery",
      "completion-summary",
      "code-review",
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

  /*
  FNXC:ReviewGatedPlanning 2026-08-24-06:30:
  Measured failure this guards: a task on V2 still emitted "Testing & Verification" and
  "Documentation & Delivery" steps and ran them in in-progress, duplicating the review gates. The
  seam appended a prohibition to a prompt whose template MANDATED both steps, and the parse node
  only audits. Assert the template region is genuinely gone, not merely contradicted.
  */
  it("stops the planner emitting the gates as duplicate implementation steps", () => {
    const ir = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR;
    const plan = ir.nodes.find((node) => node.id === "plan");
    const parse = ir.nodes.find((node) => node.id === "parse");
    const prompt = plan?.config?.prompt;

    /*
    FNXC:ReviewGatedPlanning 2026-08-24-06:45:
    The seam must stay `planning`: `resolveSeamName` accepts seven names and throws
    `Unsupported workflow seam` otherwise, which made the plan node fail on every task and the
    board report "Execution dispatch refused — task is still unplanned". Only the PROMPT differs.
    */
    expect(plan?.config?.seam).toBe("planning");
    expect(typeof prompt).toBe("string");
    expect(prompt).not.toContain("### Step {N-1}: Testing & Verification");
    expect(prompt).not.toContain("### Step {N}: Documentation & Delivery");
    expect(prompt).toContain("OVERRIDES the step template above");
    // The base workflow must keep the ordinary template.
    const basePlan = BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.find((node) => node.id === "plan");
    expect(basePlan?.config?.prompt).toContain("### Step {N}: Documentation & Delivery");
    expect(parse?.config).toMatchObject({ implementationOnlySteps: true, preserveRemediationSteps: true });
  });

  /*
  FNXC:ReviewGatedPlanning 2026-08-24-06:30:
  Setting requireImplementationOnlySteps on an already-built plan-review node is inert: the prompt
  is assembled by planReviewOptionalGroupNode, and no engine code reads the flag. Assert the
  reviewer actually carries the criterion, not just the boolean.
  */
  it("gives Plan Review the implementation-only criterion in its prompt, not just a flag", () => {
    const planReview = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "plan-review");
    const reviewConfig = (planReview?.config.template as { nodes?: Array<{ config?: Record<string, unknown> }> })
      .nodes?.[0]?.config;

    expect(reviewConfig?.requireImplementationOnlySteps).toBe(true);
    expect(reviewConfig?.prompt).toContain("## Review-gated implementation steps");

    // The inherited workflow's reviewer must stay untouched.
    const baseReview = BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.find((node) => node.id === "plan-review");
    const baseConfig = (baseReview?.config.template as { nodes?: Array<{ config?: Record<string, unknown> }> })
      .nodes?.[0]?.config;
    expect(baseConfig?.requireImplementationOnlySteps).toBeUndefined();
    expect(baseConfig?.prompt).not.toContain("## Review-gated implementation steps");
  });

  it("never mutates the inherited Coding (Ideas) graph", () => {
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.some((node) => node.id === "verification")).toBe(false);
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.some((node) => node.id === "documentation-delivery")).toBe(false);
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.edges).toEqual(expect.arrayContaining([
      { from: "steps", to: "completion-summary", condition: "success" },
    ]));
  });
});
