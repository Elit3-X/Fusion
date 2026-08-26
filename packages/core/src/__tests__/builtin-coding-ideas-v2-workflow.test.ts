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
  /*
  FNXC:CodingIdeasV2Workflow 2026-08-25-10:20:
  In-review is THREE milestones: Code Review -> Documentation -> Delivery (the merge nodes).
  The previous shape ran a separate deterministic `verification` gate and a `completion-summary`
  node. Both are gone: Code Review runs the commands itself so one node owns the verdict, and
  Documentation writes the card summary in the same pass as the delivery note.
  */
  it("runs review -> document -> merge in review", () => {
    expect(successChainFrom("steps")).toEqual([
      "code-review",
      "documentation-delivery",
      "merge-gate",
    ]);

    for (const nodeId of ["code-review", "documentation-delivery"]) {
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === nodeId)?.column)
        .toBe("in-review");
    }
    for (const removed of ["verification", "verification-remediation", "completion-summary"]) {
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.some((node) => node.id === removed), `${removed} must be gone`).toBe(false);
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.edges.some((edge) => edge.from === removed || edge.to === removed)).toBe(false);
    }

    expect(resolveWorkflowOptionalSteps(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR).map((step) => step.templateId))
      .toEqual(["plan-review", "code-review", "documentation-delivery"]);
  });

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-25-10:20:
  Code Review is the ONLY gate that can hold a card, so its verdict must rest on commands it ran
  itself. The prompt is augmented rather than edited so the shared reviewer used by builtin:coding
  and builtin:coding-ideas is untouched; the evidence rule is what stops a reviewer asserting "tests
  pass" in prose, which is the same false green a silently-passing gate produced mechanically.
  */
  it("makes Code Review run the checks and forbids a verdict without execution evidence", () => {
    const template = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "code-review")?.config?.template as
      { nodes?: Array<{ id: string; config?: { prompt?: string } }> } | undefined;
    const prompt = template?.nodes?.find((node) => node.id === "code-review-step")?.config?.prompt ?? "";

    expect(prompt).toContain("fn_run_verification");
    expect(prompt).toContain("NEVER claim a check passed without its output");
    expect(prompt).toContain("A non-zero exit is REVISE");
    // Absent commands are reported, never treated as a failure: that was never the merge contract.
    expect(prompt).toContain("do not treat the absence as failure");

    // The shared reviewer keeps its original prompt for the other built-ins.
    const inherited = BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.find((node) => node.id === "code-review")?.config?.template as
      { nodes?: Array<{ id: string; config?: { prompt?: string } }> } | undefined;
    expect(inherited?.nodes?.find((node) => node.id === "code-review-step")?.config?.prompt ?? "")
      .not.toContain("fn_run_verification");
  });

  /*
  FNXC:DocumentationMilestone 2026-08-25-10:20:
  Documentation REPORTS: it never vetoes and never writes the repository. Both properties are load
  bearing. As a blocking gate it bounced a task whose own plan forbade implementing anything, and the
  card then looped through the review lane every five minutes indefinitely. As a repository writer it
  had to be forced ahead of the review, because content changing after approval is exactly what the
  review seal refuses.
  */
  it("makes Documentation advisory and repository-read-only, after the review", () => {
    const template = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "documentation-delivery")?.config?.template as
      { nodes?: Array<{ id: string; config?: Record<string, unknown> }> } | undefined;
    const config = template?.nodes?.find((node) => node.id === "documentation-delivery-step")?.config ?? {};

    expect(config.gateMode).toBe("advisory");
    expect(config.toolMode).toBe("readonly");
    expect(String(config.prompt)).toContain("Do NOT modify repository files");
    // It absorbs the former completion-summary milestone.
    expect(String(config.prompt)).toContain("fn_task_done(summary=");

    // Failure reaches the merge exactly like success: a delivery note cannot strand approved code.
    for (const condition of ["success", "failure"]) {
      expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.edges).toContainEqual(
        { from: "documentation-delivery", to: "merge-gate", condition },
      );
    }
  });

  it("returns a rejected review to in-progress as named work", () => {
    expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.edges).toEqual(expect.arrayContaining([
      { from: "code-review", to: "code-review-remediation", condition: "failure" },
      { from: "code-review-remediation", to: "code-review", condition: "success", kind: "rework" },
    ]));
    expect(BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "code-review-remediation")?.column)
      .toBe("in-progress");

    const parse = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "parse")?.config;
    expect(parse?.preserveRemediationSteps).toBe(true);
    expect(parse?.implementationOnlySteps).toBe(true);

    const config = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR.nodes.find((node) => node.id === "code-review-remediation")?.config;
    expect(config?.workflowAction, "code-review-remediation must append named steps").toBe("review-remediation-steps");
    expect(config?.forWorkflowStepId).toBe("code-review");

    // The inherited workflow reopens trailing steps instead, and must stay that way.
    expect(BUILTIN_CODING_IDEAS_WORKFLOW_IR.nodes.find((node) => node.id === "code-review-remediation")?.config?.workflowAction)
      .toBe("pre-merge-remediation");
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
    /*
    The planner constraint lives in the SEAM PROMPT; `implementationOnlySteps` only audits leakage
    ("Detection is deliberately non-destructive"). Paired with `preserveRemediationSteps` it also
    selects named remediation — see the remediation test below.
    */
    expect(parse?.config?.implementationOnlySteps).toBe(true);
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
