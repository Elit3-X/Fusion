import { describe, expect, it, vi } from "vitest";
import { MERGE_BOUNDARY_UNPROVEN_VALUE, classifyMergePrimitiveResult, runWorkflowMergeAttemptNode } from "../workflows/workflow-merge-nodes.js";
import { graphFailureValue, isMergeGraphFailure } from "../executor/graph-failure-pure.js";
import { isTerminalMergeGraphFailureValue } from "../executor/task-predicates.js";
import { routeGraphMergeFailureToRetry } from "../executor/route-graph-merge-failure-to-retry.js";
import { shouldHoldActiveFileScopeLease } from "../scheduler.js";

const task = { id: "FN-9157", column: "in-review", steps: [], dependencies: [], log: [], createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z", title: "t", description: "", prompt: "# t" } as any;
const graphResult = (nodeId = "merge") => ({ visitedNodeIds: [nodeId], context: { [`node:${nodeId}:value`]: MERGE_BOUNDARY_UNPROVEN_VALUE } }) as any;

describe("FN-9157 merge-boundary-unproven terminal routing", () => {
  it("preserves the explicit terminal value before failed-data classification", () => {
    expect(classifyMergePrimitiveResult(undefined, MERGE_BOUNDARY_UNPROVEN_VALUE, "failure")).toEqual({ outcome: "failure", value: MERGE_BOUNDARY_UNPROVEN_VALUE });
    expect(classifyMergePrimitiveResult({ status: "failed", reason: MERGE_BOUNDARY_UNPROVEN_VALUE } as any, MERGE_BOUNDARY_UNPROVEN_VALUE, "failure")).toEqual({ outcome: "failure", value: MERGE_BOUNDARY_UNPROVEN_VALUE });
  });

  it("keeps the value on direct merge-attempt dispatch and both graph context ids", async () => {
    const output = await runWorkflowMergeAttemptNode({ primitives: {
      requestMerge: vi.fn().mockResolvedValue({ outcome: "failure", value: MERGE_BOUNDARY_UNPROVEN_VALUE }),
      audit: vi.fn(),
    } }, {} as any, task);
    expect(output).toMatchObject({ outcome: "failure", value: MERGE_BOUNDARY_UNPROVEN_VALUE });
    expect(graphFailureValue(graphResult("merge"))).toBe(MERGE_BOUNDARY_UNPROVEN_VALUE);
    expect(graphFailureValue(graphResult("merge-attempt"))).toBe(MERGE_BOUNDARY_UNPROVEN_VALUE);
    expect(isMergeGraphFailure("merge")).toBe(true);
    expect(isMergeGraphFailure("merge-attempt")).toBe(true);
    expect(isTerminalMergeGraphFailureValue(MERGE_BOUNDARY_UNPROVEN_VALUE)).toBe(true);
  });

  it("parks an unprovable retry once without requesting merge and releases its lease", async () => {
    const live = { ...task, worktree: "/worktree", status: undefined };
    const updateTask = vi.fn(async (_id, patch) => ({ ...live, ...patch }));
    const logEntry = vi.fn();
    const mergeRequester = vi.fn();
    const handled = await routeGraphMergeFailureToRetry({
      store: { updateTask, logEntry } as any,
      getRunContextFor: () => undefined,
      mergeRequester,
      ensureWorkflowMergeBoundaryTask: vi.fn().mockResolvedValue({ task: live, blocked: { reason: "no pre-merge node result recorded" } }),
      persistTokenUsage: vi.fn(),
    }, live, graphResult(), undefined);
    expect(handled).toBe(true);
    expect(mergeRequester).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith("FN-9157", expect.objectContaining({ status: "failed", error: expect.stringContaining("MERGE_BOUNDARY_UNPROVEN:") }), undefined);
    expect(logEntry).toHaveBeenCalledWith("FN-9157", expect.stringContaining("retry parked task"), undefined, undefined);
    expect(shouldHoldActiveFileScopeLease({ ...live, status: "failed" }, [])).toBe(false);
  });
});
