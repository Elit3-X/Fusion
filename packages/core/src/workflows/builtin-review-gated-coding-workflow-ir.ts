import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";
import { BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR } from "./builtin-stepwise-final-review-coding-workflow-ir.js";
import { verificationOptionalGroupNode } from "./builtin-verification-gate-group.js";
import { documentationDeliveryOptionalGroupNode } from "./builtin-documentation-delivery-group.js";
import { codeReviewRemediationStepsNode, verificationRemediationNode } from "./builtin-workflow-remediation-nodes.js";
import { builtinPromptConfig, builtinSeamPrompt } from "./builtin-workflow-prompts.js";
import { applyImplementationOnlyStepReview } from "./builtin-plan-review-group.js";

const clone = (ir: WorkflowIr): WorkflowIr => JSON.parse(JSON.stringify(ir)) as WorkflowIr;

/**
 * FNXC:ReviewGatedCoding 2026-08-23-04:52:
 * This selectable workflow derives from, but never mutates, the default coding IR. Its review
 * gates are structural nodes; task.steps remains implementation work plus appended provenance.
 */
const RAW_BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR: WorkflowIr = (() => {
  const ir = clone(BUILTIN_STEPWISE_FINAL_REVIEW_CODING_WORKFLOW_IR);
  ir.name = "builtin-review-gated-coding";

  /* FNXC:ReviewGatedPlanning 2026-08-24-06:45: `planning-implementation-only` is a PROMPT key, not
     an executable seam — `resolveSeamName` throws for it, so the plan node failed on every task.
     Keep the seam `planning` and swap only the prompt. */
  const plan = ir.nodes.find((node) => node.id === "plan");
  if (plan) plan.config = { ...builtinPromptConfig("planning", "Plan"), prompt: builtinSeamPrompt("planning-implementation-only") };
  /* FNXC:ReviewGatedPlanning 2026-08-24-06:30: the flag alone was inert here too — see
     applyImplementationOnlyStepReview. */
  const planReview = ir.nodes.find((node) => node.id === "plan-review");
  if (planReview) applyImplementationOnlyStepReview(planReview);
  const parse = ir.nodes.find((node) => node.id === "parse");
  if (parse) parse.config = { ...parse.config, implementationOnlySteps: true, preserveRemediationSteps: true };

  const removed = new Set(["browser-verification", "browser-verification-remediation", "code-review-remediation"]);
  ir.nodes = ir.nodes.filter((node) => !removed.has(node.id));
  ir.edges = ir.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));

  const codeReviewIndex = ir.nodes.findIndex((node) => node.id === "code-review");
  if (codeReviewIndex < 0) throw new Error("review-gated coding requires the inherited code-review gate");
  ir.nodes.splice(codeReviewIndex, 0, verificationOptionalGroupNode("in-review"));
  const completionIndex = ir.nodes.findIndex((node) => node.id === "completion-summary");
  if (completionIndex < 0) throw new Error("review-gated coding requires completion summary");
  ir.nodes.splice(completionIndex, 0, documentationDeliveryOptionalGroupNode("in-review"));
  ir.nodes.push(verificationRemediationNode(), codeReviewRemediationStepsNode());

  ir.edges = ir.edges.filter((edge) => !(
    (edge.from === "steps" && edge.to === "code-review")
    || (edge.from === "completion-summary" && edge.to === "code-review")
    || (edge.from === "code-review" && edge.to === "completion-summary")
    || (edge.from === "code-review" && edge.to === "merge-gate")
  ));
  ir.edges.push(
    { from: "steps", to: "verification", condition: "success" },
    { from: "verification", to: "code-review", condition: "success" },
    { from: "code-review", to: "documentation-delivery", condition: "success" },
    { from: "documentation-delivery", to: "completion-summary", condition: "success" },
    { from: "completion-summary", to: "merge-gate", condition: "success" },
    { from: "verification", to: "verification-remediation", condition: "failure" },
    { from: "code-review", to: "code-review-remediation-steps", condition: "failure" },
    { from: "verification-remediation", to: "verification", condition: "success", kind: "rework" },
    { from: "code-review-remediation-steps", to: "verification", condition: "success", kind: "rework" },
  );
  return ir;
})();

export const BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR = parseWorkflowIr(RAW_BUILTIN_REVIEW_GATED_CODING_WORKFLOW_IR);
