/**
 * FNXC:CodeOrganization 2026-08-03-13:45:
 * routeGraphMergeFailureToRetry peeled from TaskExecutor (U4).
 *
 * FNXC:WorkflowMerge 2026-07-12-17:38:
 * FN-1165: never route implementation-incomplete merge failures to the merge requester.
 */
import type { TaskDetail, TaskStore } from "@fusion/core";
import type { WorkflowGraphTaskRunResult } from "../workflows/workflow-graph-task-runner.js";
import type { PausedAbortProvenance } from "./paused-abort-provenance.js";
import { isGenericAbortProvenance } from "./paused-abort-provenance.js";
import { graphFailureValue } from "./graph-failure-pure.js";
import type { EngineRunContext } from "../util/run-audit.js";
import { executorLog } from "../logger.js";
import { MERGE_BOUNDARY_UNPROVEN_VALUE } from "../workflows/workflow-merge-nodes.js";

export type RouteGraphMergeFailureToRetryDeps = {
  store: TaskStore;
  getRunContextFor: (taskId: string) => EngineRunContext | undefined;
  mergeRequester?: ((taskId: string) => Promise<unknown>) | null;
  ensureWorkflowMergeBoundaryTask: (
    live: TaskDetail,
    opts: { reason: string; nodeId: string; workflowId: string; runId: string },
  ) => Promise<{ task: TaskDetail; blocked?: { reason: string } }>;
  persistTokenUsage: (taskId: string) => Promise<void>;
};

export async function routeGraphMergeFailureToRetry(
  deps: RouteGraphMergeFailureToRetryDeps,
  live: TaskDetail,
  result: WorkflowGraphTaskRunResult,
  abortProvenance: PausedAbortProvenance | undefined,
): Promise<boolean> {
    if (!deps.mergeRequester) return false;
    /* FNXC:WorkflowMerge 2026-07-12-17:38: FN-1165 defense in depth — implementation-incomplete merge graph failures must never reach the merge requester, because a no-branch task can otherwise be finalized as an intentional no-op. */
    if (graphFailureValue(result) === "implementation-incomplete") return false;
    const failedNode = result.visitedNodeIds[result.visitedNodeIds.length - 1] ?? "unknown";
    const message = `Workflow graph merge failure at node '${failedNode}' routed to bounded auto-merge retry${abortProvenance === "merge-seam" ? " after merge-seam abort" : isGenericAbortProvenance(abortProvenance) || abortProvenance === undefined ? " after benign pause/resume abort" : ""}`;
    executorLog.warn(`${live.id}: ${message}`);
    await deps.store.logEntry(live.id, message, undefined, deps.getRunContextFor(live.id));
    try {
      const mergeBoundary = await deps.ensureWorkflowMergeBoundaryTask(live, {
        reason: "workflow-merge-retry-boundary",
        nodeId: failedNode,
        workflowId: result.context?.["workflow:id"] as string | undefined ?? "workflow-graph",
        runId: deps.getRunContextFor(live.id)?.runId ?? "graph-merge-retry",
      });
      /*
      FNXC:WorkflowMerge 2026-08-20-00:50:
      FN-9157 forbids a bounded retry from repeating an unprovable boundary check.
      Park visibly so the existing failed-status lease rule releases overlapping
      work, rather than silently retaining an in-review blocker.
      */
      if (mergeBoundary.blocked) {
        const reason = mergeBoundary.blocked.reason;
        await deps.store.logEntry(live.id, `Workflow merge boundary retry parked task: ${reason}`, undefined, deps.getRunContextFor(live.id));
        if (mergeBoundary.task.status !== "failed" || !mergeBoundary.task.error) {
          await deps.store.updateTask(
            live.id,
            { status: "failed", error: `${MERGE_BOUNDARY_UNPROVEN_VALUE.toUpperCase().replaceAll("-", "_")}: ${reason}` },
            deps.getRunContextFor(live.id),
          );
        }
        await deps.persistTokenUsage(live.id);
        return true;
      }
      await deps.mergeRequester(mergeBoundary.task.id);
    } catch (error) {
      executorLog.warn(`${live.id}: bounded auto-merge retry request failed after graph merge failure: ${error instanceof Error ? error.message : String(error)}`);
    }
    await deps.persistTokenUsage(live.id);
    return true;
}
