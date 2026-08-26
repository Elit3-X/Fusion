import type { WorkflowIr } from "./workflow-ir-types.js";
import { parseWorkflowIr } from "./workflow-ir.js";
import { BUILTIN_CODING_IDEAS_WORKFLOW_IR } from "./builtin-coding-ideas-workflow-ir.js";

import { documentationDeliveryOptionalGroupNode } from "./builtin-documentation-delivery-group.js";
import { codeReviewRemediationStepsNode } from "./builtin-workflow-remediation-nodes.js";
import { builtinPromptConfig, builtinSeamPrompt } from "./builtin-workflow-prompts.js";
import { applyImplementationOnlyStepReview } from "./builtin-plan-review-group.js";

const clone = (ir: WorkflowIr): WorkflowIr => JSON.parse(JSON.stringify(ir)) as WorkflowIr;

/*
FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
Operator intent: keep the Coding (Ideas) board exactly as it is (manual "Ideas" intake, autoTriage
false), but stop hiding testing and documentation inside the implementation checklist. They become
VISIBLE review-column gates, and the merge is the last thing that happens after delivery.

in-progress : steps            = implementation only
in-review   : verification -> documentation-delivery -> completion-summary -> code-review -> merge

Ordering is NOT cosmetic. `execute-workflow-graph.ts` refuses any write-capable node once a Code
Review APPROVE exists (`workspace-review-seal-required`): a passed review seals the tree so nothing
unreviewed can reach main. `verification-step` (its name matches the write-capable classifier) and
`documentation-delivery-step` (`toolMode: "coding"`) are both write-capable, so both MUST precede
`code-review`. builtin:review-gated-coding places them after it and therefore deadlocks on every
task the moment the review approves — that defect is the reason this ordering is explicit here.

`completion-summary` runs BEFORE `code-review`, matching the inherited graph. It escapes the review
seal (it is `toolMode: "readonly"`, so the write-capable classifier ignores it), which made "summary
last, so it can describe the approved state" look correct — and it is wrong. The node still acquires
a task worktree, and ANY node running between the review and the merge changes the tree the review
approved, so `canMergeTask` refuses with "task has no provable approval for the content being
merged" (FN-180's review-diff fingerprint). Measured: the pipeline-smoke S01 run on this workflow
failed exactly there, then looped through verification-remediation. The seal is not the only thing
ordering these nodes; the merge fingerprint is the other, and it is stricter.
It stays best-effort with a success-only edge — a summary failure must never wedge a task.
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
  /*
  FNXC:ReviewGatedPlanning 2026-08-24-06:45:
  The SEAM stays `planning`; only the PROMPT changes. `resolveSeamName`
  (engine/workflows/workflow-node-handlers.ts) accepts exactly seven seam names and throws
  `WorkflowIrError: Unsupported workflow seam` for anything else. Declaring
  `seam: "planning-implementation-only"` therefore made the `plan` node throw on every task: the
  graph failed at `plan`, the card bounced back to todo, and the board reported "Execution dispatch
  refused — task is still unplanned" — i.e. pressing Start appeared to do nothing.
  builtin:review-gated-coding still carries that unsupported seam; it is fixed there too.
  */
  const plan = ir.nodes.find((node) => node.id === "plan");
  if (plan) plan.config = { ...plan.config, ...builtinPromptConfig("planning", "Plan"), prompt: builtinSeamPrompt("planning-implementation-only") };
  const planReview = ir.nodes.find((node) => node.id === "plan-review");
  if (planReview) applyImplementationOnlyStepReview(planReview);
  /*
  FNXC:ReviewGatedRemediation 2026-08-24-22:10:
  Named remediation is enabled: `implementationOnlySteps` + `preserveRemediationSteps` select
  `review-remediation-steps`, so a rejected review derives NAMED work from the reviewer's findings,
  appends it to `task.steps` as a numbered wave, and widens the PROMPT.md File Scope to the files it
  touches — the operator sees exactly what must be fixed instead of a bounced card with an unchanged
  checklist. This depends on the foreach covering appended steps
  (`FNXC:WorkflowForeachGrowth` in workflow-graph-foreach.ts); before that, an appended step never
  received an instance and stayed `pending` forever.
  */
  const parse = ir.nodes.find((node) => node.id === "parse");
  if (parse) parse.config = { ...parse.config, implementationOnlySteps: true, preserveRemediationSteps: true };
  const codeReviewRemediation = ir.nodes.find((node) => node.id === "code-review-remediation");
  if (codeReviewRemediation) {
    codeReviewRemediation.config = {
      ...codeReviewRemediation.config,
      ...codeReviewRemediationStepsNode().config,
      name: "Code Review Remediation",
    };
  }
  /* Superseded note, kept for the reasoning it records:
  This workflow deliberately did NOT set the parse node's `implementationOnlySteps` +
  `preserveRemediationSteps`, so `resolveStepReopenPolicy` kept the inherited "reopen-trailing".
  That pair selects named remediation (`review-remediation-steps`), which cannot execute here: the
  parse node preserves the appended step and then answers `already-expanded`, because the foreach is
  PINNED to the step list it first expanded. A step appended afterwards never receives an instance,
  so it stays `pending` forever — measured on S05, where the card advanced to review with
  `steps=["done","pending"]` and the merge boundary refused with `merge-boundary-unproven`.
  Reopening trailing steps re-runs instances the foreach already owns, which is why the inherited
  Coding (Ideas) rework converges. Named remediation stays unavailable to foreach-executed workflows
  until the foreach can re-expand; builtin:review-gated-coding pairs them too and never reached a
  merge to expose it.
  The planner is still constrained — that is the SEAM PROMPT's job, not this flag, which only audits.
  */

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-25-10:20:
  In-review is THREE milestones: Code Review -> Documentation -> Delivery (the merge).

  A separate deterministic `Verification` gate is deliberately GONE. It duplicated the executor's
  own verification, it produced a green badge on projects that had configured no command, and it
  split the merge evidence across two authorities that could disagree. Code Review now RUNS the
  commands itself and rules on their real output, so exit codes still decide and one node owns the
  verdict.

  `completion-summary` is gone as a milestone too: the card summary is written by Documentation in
  the same pass as the delivery note, which removes one model call per card.

  Documentation runs AFTER the review — the ordering the original documentation-delivery node always
  intended ("runs after passing verification and code review") and which the review seal previously
  forbade. It is legal now because Documentation no longer writes the repository: it records a
  Fusion-side delivery note, artifacts, follow-ups, and the card summary. Repository documentation
  is the EXECUTOR's call during implementation, where it is reviewed with the code it documents.
  */
  const codeReviewIndex = ir.nodes.findIndex((node) => node.id === "code-review");
  if (codeReviewIndex < 0) throw new Error("coding-ideas-v2 requires the inherited code-review gate");
  /*
  FNXC:CodingIdeasV2Workflow 2026-08-25-10:20:
  Code Review RUNS the checks here; it does not receive someone else's verdict. The shared prompt is
  AUGMENTED rather than edited, so `builtin:coding` and `builtin:coding-ideas` keep the reviewer they
  have always had.
  The evidence requirement is the whole point. A reviewer that may state "tests pass" without
  running anything reproduces, in prose, the false green a silently-passing gate produced
  mechanically — and a fluent claim is harder to spot than a 46ms step. Absent commands report that
  fact instead of blocking: a project that never configured verification has never been refused a
  merge on that basis, and this is not the place to change that contract.
  */
  const codeReviewStep = (ir.nodes[codeReviewIndex]?.config?.template as { nodes?: Array<{ id: string; config?: Record<string, unknown> }> } | undefined)
    ?.nodes?.find((node) => node.id === "code-review-step");
  if (!codeReviewStep?.config) throw new Error("coding-ideas-v2 requires the inherited code-review-step template node");
  codeReviewStep.config.prompt = `${String(codeReviewStep.config.prompt ?? "")}

## Step 0: Run the checks yourself (do this FIRST)

This review is the only gate before merge, so the verdict must rest on real command output.

1. Determine the project's lint, test, and build commands. Prefer explicitly configured commands; otherwise infer them from the repository (package scripts, Makefile, CI config).
2. Run them with \`fn_run_verification\`, scoped to what the change touches. Do NOT run a full workspace suite as your normal path.
3. Quote, in your review, each command you ran with its exit code and the tail of its output.

Rules that are not negotiable:
- A non-zero exit is REVISE. State which command failed and the failing output.
- NEVER claim a check passed without its output in your review. A verdict with no execution evidence is invalid.
- If no command is determinable, say so explicitly ("no lint/test/build command could be determined") and review the diff on its merits. Do not invent a command, and do not treat the absence as failure.`;
  ir.nodes.splice(codeReviewIndex + 1, 0, documentationDeliveryOptionalGroupNode("in-review"));
  const summaryIndex = ir.nodes.findIndex((node) => node.id === "completion-summary");
  if (summaryIndex >= 0) ir.nodes.splice(summaryIndex, 1);
  /*
  FNXC:ReviewGatedRemediation 2026-08-24-18:30:
  Both gates MUST derive named remediation steps, because this workflow also sets the parse node's
  `implementationOnlySteps` + `preserveRemediationSteps`, and `resolveStepReopenPolicy` reads that
  pair as reopen policy "none". The two are a matched pair: with trailing-step reopening disabled,
  a remediation that appends nothing returns the card to in-progress with every step already done
  and no work to execute. Inheriting Coding (Ideas)' `pre-merge-remediation` therefore stalled the
  card after a Code Review REVISE — S05 ("REVISE twice, then approve") failed with
  "did not persist completed implementation-step projection".
  An earlier attempt at this alignment was reverted because the merge then ran `git merge --squash`
  with an empty ref. That was NOT this node: the pipeline-smoke merger mock resolved its branch from
  `task.branch`, which is absent on a workspace row and unset at install time, and it is fixed at
  the harness. The node id is kept so the inherited edges stay valid;
  `appendReviewRemediationSteps` keys on the failing GATE id, not on this node's id.
  */
  /* Code Review keeps the inherited `pre-merge-remediation`, which reopens trailing steps the
     foreach already owns. See the parse-node note above. */

  /* Every inherited edge touching `completion-summary` dies with the node; the lane is rebuilt below. */
  ir.edges = ir.edges.filter((edge) => edge.from !== "completion-summary" && edge.to !== "completion-summary");

  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
  Both remediation loops re-enter at `verification`, never directly at `code-review`. That is what
  keeps the documentation honest: a REVISE sends the fix back to in-progress, then the walk replays
  verification AND documentation-delivery, so the docs and changeset are regenerated to include what
  the review demanded before it re-reads them. Re-entering at `code-review` would leave the docs
  describing a tree that no longer exists. `verification` is the rework-region head (`reworkRegion:
  true`, `maxReworkCycles: 3`), which is what makes these edges legal.
  */
  /*
  FNXC:CodingIdeasV2Workflow 2026-08-24-20:40:
  Push ONLY the genuinely new edges. `completion-summary -> code-review`, `code-review -> merge-gate`
  and the code-review rework are inherited from Coding (Ideas) and were being re-pushed, so the
  graph carried each of them twice — a duplicated success edge out of a review gate is a second,
  competing traversal of the same lane.
  */
  /* `code-review -> merge-gate` is inherited and must not survive: Documentation now sits between them. */
  ir.edges = ir.edges.filter((edge) => !(edge.from === "code-review" && edge.to === "merge-gate"));
  ir.edges.push(
    { from: "steps", to: "code-review", condition: "success" },
    { from: "code-review", to: "documentation-delivery", condition: "success" },
    { from: "documentation-delivery", to: "merge-gate", condition: "success" },
    /*
    FNXC:CodingIdeasV2Workflow 2026-08-25-10:20:
    Documentation is ADVISORY: it reports, it never vetoes. Its failure edge reaches the merge gate
    exactly like its success edge, so a delivery note that could not be written cannot strand a
    card whose code is already approved. Measured why: as a blocking gate it bounced a task whose
    own plan said not to implement anything ("No task-specific implementation is present"), and the
    card looped through the review lane every five minutes indefinitely.
    */
    { from: "documentation-delivery", to: "merge-gate", condition: "failure" },
  );
  /*
  FNXC:ReviewGatedRemediation 2026-08-24-20:10:
  Code Review rework stays on the INHERITED `code-review-remediation -> code-review` edge. The
  remediation node is itself a coding session that fixes the findings and completes the trailing
  steps it reopened; routing that rework through `verification` walked the graph forward past the
  foreach, so the reopened step was never re-executed and the card terminalized with
  `merge-boundary-unproven`.
  Cost, stated: a Code Review REVISE does NOT replay Verification or Documentation & Delivery.
  Verification rework does replay the doc node, because it re-enters upstream of it.
  */
  return ir;
})();

export const BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR = parseWorkflowIr(RAW_BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR);
