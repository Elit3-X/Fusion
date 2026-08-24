import { describe, expect, it } from "vitest";
import { BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR, type WorkflowIr, type WorkflowIrNode } from "@fusion/core";
import { workflowNodeRequiresWorktree } from "../workflows/workflow-node-execution-needs.js";

/*
FNXC:CodingIdeasV2Workflow 2026-08-24-05:35:
The ratchet FN-175 did not have. `execute-workflow-graph.ts` refuses any write-capable node once a
Code Review APPROVE exists (`workspace-review-seal-required`), because a passed review seals the
tree so nothing unreviewed reaches main. builtin:review-gated-coding routes code-review straight
into two write-capable nodes, so every task on it deadlocks the moment the review approves — and
nothing caught it, because its only coverage asserted graph shape by hand rather than running the
production classifier over the graph.

This test runs the REAL classifier over the real success chain. It fails if anyone ever moves a
write-capable gate after the review again.
*/

/** The executed node for a gate: an optional-group runs its template's inner node. */
function executableNodes(node: WorkflowIrNode): Array<{ node: WorkflowIrNode; optionalGroupId?: string }> {
  const template = node.config?.template as { nodes?: WorkflowIrNode[] } | undefined;
  if (node.kind === "optional-group" && Array.isArray(template?.nodes)) {
    return template.nodes.map((inner) => ({ node: inner, optionalGroupId: node.id }));
  }
  return [{ node }];
}

function isWriteCapable(node: WorkflowIrNode): boolean {
  return executableNodes(node).some(({ node: executed, optionalGroupId }) =>
    workflowNodeRequiresWorktree(executed, { optionalGroupId }) || executed.kind === "code");
}

function successChainFrom(ir: WorkflowIr, start: string): WorkflowIrNode[] {
  const chain: WorkflowIrNode[] = [];
  const seen = new Set<string>();
  let current: string | undefined = start;
  while (current && !seen.has(current)) {
    seen.add(current);
    const edge = ir.edges.find((candidate) => candidate.from === current && candidate.condition === "success");
    if (!edge) break;
    const next = ir.nodes.find((node) => node.id === edge.to);
    if (next) chain.push(next);
    current = edge.to;
  }
  return chain;
}

describe("builtin:coding-ideas-v2 review seal", () => {
  const ir = BUILTIN_CODING_IDEAS_V2_WORKFLOW_IR as WorkflowIr;

  it("has no write-capable node after Code Review", () => {
    const after = successChainFrom(ir, "code-review");
    // Guard the guard: an empty chain would make this assertion vacuously true. Everything the
    // review must cover now runs before it, so what remains downstream is the merge machinery.
    expect(after.map((node) => node.id)).toContain("merge-gate");

    const offenders = after.filter(isWriteCapable).map((node) => node.id);
    expect(offenders).toEqual([]);
  });

  it("keeps both write-capable gates strictly before Code Review", () => {
    // If these ever stop being write-capable the ordering constraint is moot and this
    // whole ratchet is measuring nothing — so assert the premise, not just the outcome.
    for (const gateId of ["verification", "documentation-delivery"]) {
      const gate = ir.nodes.find((node) => node.id === gateId);
      expect(gate, `${gateId} is missing`).toBeDefined();
      expect(isWriteCapable(gate!), `${gateId} is expected to be write-capable`).toBe(true);
    }

    const chain = successChainFrom(ir, "steps").map((node) => node.id);
    expect(chain.indexOf("verification")).toBeLessThan(chain.indexOf("code-review"));
    expect(chain.indexOf("documentation-delivery")).toBeLessThan(chain.indexOf("code-review"));
    /*
    Not seal-driven but merge-driven: `completion-summary` escapes the write-capable classifier
    (readonly) yet still acquires a worktree, and any node between the review and the merge
    invalidates FN-180's review-diff fingerprint ("no provable approval for the content being
    merged"). Nothing may sit between them.
    */
    expect(chain.indexOf("completion-summary")).toBeLessThan(chain.indexOf("code-review"));
    expect(chain[chain.indexOf("code-review") + 1]).toBe("merge-gate");
  });

  it("keeps the completion summary readonly so it may run after the seal", () => {
    const summary = ir.nodes.find((node) => node.id === "completion-summary");
    expect(summary?.config?.toolMode).toBe("readonly");
    expect(isWriteCapable(summary!)).toBe(false);
  });
});
