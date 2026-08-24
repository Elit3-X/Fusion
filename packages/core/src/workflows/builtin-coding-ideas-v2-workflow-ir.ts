import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";
import { BUILTIN_CODING_IDEAS_WORKFLOW_IR } from "./builtin-coding-ideas-workflow-ir.js";
import { verificationOptionalGroupNode } from "./builtin-verification-gate-group.js";
import { documentationDeliveryOptionalGroupNode } from "./builtin-documentation-delivery-group.js";
import { verificationRemediationNode } from "./builtin-workflow-remediation-nodes.js";
import { builtinPromptConfig } from "./builtin-workflow-prompts.js";

const clone = (ir: WorkflowIr): WorkflowIr => JSON.parse(JSON.stringify(ir)) as WorkflowIr;

/*
FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
Operator intent: keep the Coding (Ideas) board exactly as it is (manual "Ideas" intake, autoTriage
false), but stop hiding testing and documentation inside the implementation checklist. They become
VISIBLE review-column gates, and the merge is the last thing that happens after delivery.

in-progress : steps            = implementation only
in-review   : verification -> documentation-delivery -> code-review -> completion-summary -> merge

Ordering is NOT cosmetic. `execute-workflow-graph.ts` refuses any write-capable node once a Code
Review APPROVE exists (`workspace-review-seal-required`): a passed review seals the tree so nothing
unreviewed can reach main. `verification-step` (its name matches the write-capable classifier) and
`documentation-delivery-step` (`toolMode: "coding"`) are both write-capable, so both MUST precede
`code-review`. builtin:review-gated-coding places them after it and therefore deadlocks on every
task the moment the review approves — that defect is the reason this ordering is explicit here.

`completion-summary` is deliberately AFTER `code-review`: it is `toolMode: "readonly"`, so the seal
does not apply, and writing it last lets the card blurb describe the state that was actually
approved. It stays best-effort with a success-only edge — a summary failure must never wedge a task.
*/
const RAW_BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR: WorkflowIr = (() => {
  const ir = clone(BUILTIN_CODING_IDEAS_WORKFLOW_IR);
  ir.name = "builtin-coding-ideas-v2";

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
  The planner must stop emitting "Testing & Verification" and "Documentation & Delivery" steps: they
  are gates now, and leaving them in PROMPT.md would run the same work twice under the same names.
  `planning-implementation-only` is the seam that carries that instruction.
  */
  const plan = ir.nodes.find((node) => node.id === "plan");
  if (plan) plan.config = { ...plan.config, ...builtinPromptConfig("planning-implementation-only", "Plan") };
  const planReview = ir.nodes.find((node) => node.id === "plan-review");
  const planTemplate = planReview?.config?.template as { nodes?: Array<{ config?: Record<string, unknown> }> } | undefined;
  if (planTemplate?.nodes?.[0]?.config) planTemplate.nodes[0].config.requireImplementationOnlySteps = true;
  const parse = ir.nodes.find((node) => node.id === "parse");
  if (parse) parse.config = { ...parse.config, implementationOnlySteps: true, preserveRemediationSteps: true };

  const codeReviewIndex = ir.nodes.findIndex((node) => node.id === "code-review");
  if (codeReviewIndex < 0) throw new Error("coding-ideas-v2 requires the inherited code-review gate");
  ir.nodes.splice(codeReviewIndex, 0, verificationOptionalGroupNode("in-review"), documentationDeliveryOptionalGroupNode("in-review"));
  ir.nodes.push(verificationRemediationNode());

  ir.edges = ir.edges.filter((edge) => !(
    (edge.from === "steps" && edge.to === "completion-summary")
    || (edge.from === "completion-summary" && edge.to === "code-review")
    || (edge.from === "code-review" && edge.to === "merge-gate")
    || (edge.from === "code-review-remediation" && edge.to === "code-review")
  ));

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
  Both remediation loops re-enter at `verification`, never directly at `code-review`. That is what
  keeps the documentation honest: a REVISE sends the fix back to in-progress, then the walk replays
  verification AND documentation-delivery, so the docs and changeset are regenerated to include what
  the review demanded before it re-reads them. Re-entering at `code-review` would leave the docs
  describing a tree that no longer exists. `verification` is the rework-region head (`reworkRegion:
  true`, `maxReworkCycles: 3`), which is what makes these edges legal.
  */
  ir.edges.push(
    { from: "steps", to: "verification", condition: "success" },
    { from: "verification", to: "documentation-delivery", condition: "success" },
    { from: "documentation-delivery", to: "code-review", condition: "success" },
    { from: "code-review", to: "completion-summary", condition: "success" },
    { from: "completion-summary", to: "merge-gate", condition: "success" },
    { from: "verification", to: "verification-remediation", condition: "failure" },
    { from: "verification-remediation", to: "verification", condition: "success", kind: "rework" },
    { from: "code-review-remediation", to: "verification", condition: "success", kind: "rework" },
  );
  return ir;
})();

export const BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR = parseWorkflowIr(RAW_BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR);
