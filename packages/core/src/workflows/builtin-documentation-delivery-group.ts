import type { WorkflowIrNode } from "./workflow-ir-types.js";

export const DOCUMENTATION_DELIVERY_GROUP_ID = "documentation-delivery";

/*
FNXC:DocumentationMilestone 2026-08-25-10:20:
This milestone reports on accepted work; it does NOT write the repository and does NOT judge.

Repository documentation belongs to the EXECUTOR during implementation: a docs change is a code
change, and writing it here put it outside the diff the reviewer approved — the exact content-drift
the review seal exists to prevent, which is why this node used to be forced ahead of the review it
was authored to follow. Whether the change warrants a docs update is the executor's judgement, not a
mandatory stage.

It also absorbs the former `completion-summary` milestone: the card summary and the delivery note are
one pass, one model call.
*/
const DOCUMENTATION_DELIVERY_PROMPT = `Report on the accepted implementation exactly once. Do NOT modify repository files: this milestone records, it does not implement, and the code has already been reviewed.

1. Write the card summary with fn_task_done(summary=...): 2-4 sentences an operator can read on the card to know what shipped and why.
2. Save a concise delivery note with fn_task_document_write(key="docs", ...): what shipped, how to verify it, and anything an operator must know.
3. Register visual or media deliverables with fn_artifact_register when the work produced any.
4. Record genuine out-of-scope follow-ups as new tasks. Only real ones -- do not invent work.

You cannot block this card. If you cannot complete a point above, say so plainly in the summary and finish.`;

export function documentationDeliveryOptionalGroupNode(column: string): WorkflowIrNode {
  return {
    id: DOCUMENTATION_DELIVERY_GROUP_ID,
    kind: "optional-group",
    column,
    config: {
      name: "Documentation",
      defaultOn: true,
      /*
      FNXC:ReportingOnlyGroup 2026-08-26-06:56:
      Documentation ONLY documents. `gateMode: "advisory"` on the inner node was not enough and the
      gap was measured on a real card: its REVISE recorded `advisory_failure`, which held the merge
      door ("no current approval") AND bounced the card to implementation with no work to do, where
      it re-ran Code Review against an unchanged tree and merged on the second pass by luck.
      `reportingOnly` states the contract once: no approval to withhold, no remediation to request.
      */
      reportingOnly: true,
      template: {
        nodes: [{
          id: "documentation-delivery-step",
          kind: "prompt",
          config: {
            name: "Documentation",
            prompt: DOCUMENTATION_DELIVERY_PROMPT,
            toolMode: "readonly",
            gateMode: "advisory",
            workflowAction: "documentation-delivery",
          },
        }],
        edges: [],
      },
    },
  };
}
