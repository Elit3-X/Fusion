import type { WorkflowIrNode } from "./workflow-ir-types.js";

export const DOCUMENTATION_DELIVERY_GROUP_ID = "documentation-delivery";

const DOCUMENTATION_DELIVERY_PROMPT = `Document and deliver the accepted implementation exactly once. Update relevant operator documentation, save a concise delivery note with fn_task_document_write(key="docs", ...), register visual or media deliverables with fn_artifact_register when present, and record only genuine out-of-scope follow-ups.`;

/** Documentation runs after passing verification and code review, never as an implementation step. */
export function documentationDeliveryOptionalGroupNode(column: string): WorkflowIrNode {
  return {
    id: DOCUMENTATION_DELIVERY_GROUP_ID,
    kind: "optional-group",
    column,
    config: {
      name: "Documentation & Delivery",
      defaultOn: true,
      template: {
        nodes: [{
          id: "documentation-delivery-step",
          kind: "prompt",
          config: {
            name: "Documentation & Delivery",
            prompt: DOCUMENTATION_DELIVERY_PROMPT,
            toolMode: "coding",
            gateMode: "gate",
            workflowAction: "documentation-delivery",
          },
        }],
        edges: [],
      },
    },
  };
}
