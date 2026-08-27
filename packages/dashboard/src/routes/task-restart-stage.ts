import { rm } from "node:fs/promises";
import {
  computeWorkflowIrPin,
  disposeTaskBeforeReset,
  planTaskColumnRestart,
  RESTART_STAGE_FENCE_REASON,
  resolveTaskSymbolsForTask,
  resolveWorkflowIrForTask,
  type Task,
  type TaskStore,
} from "@fusion/core";
import { isStaleMergeActiveStatus, resolveColumnResumeNode } from "@fusion/engine";
import { badRequest, conflict, notFound } from "../api-error.js";

interface RestartTaskStageEngine {
  clearTaskPauseAbortState?: (taskId: string) => void | Promise<void>;
}

type RestartTaskStageStore = TaskStore & {
  clearWorkflowRunStepInstancesAsync?: (taskId: string) => Promise<void>;
};

export interface RestartTaskStageDeps {
  store: RestartTaskStageStore;
  engine?: RestartTaskStageEngine;
  taskId: string;
  confirm?: boolean;
  activeMergeTaskId?: string | null;
  staleMergingStatusMinAgeMs?: number;
}

function refusalError(plan: Extract<ReturnType<typeof planTaskColumnRestart>, { kind: "refused" }>) {
  if (plan.reason === "workspace-task") return conflict("Restart stage does not support workspace tasks");
  if (plan.reason === "no-entry-node-in-column") {
    const later = plan.detail?.resolvedEntryNodeColumn;
    return badRequest(later
      ? `The ${later} workflow node is later than the task's ${plan.detail?.resolvedEntryNodeColumn === later ? "current" : ""} column; this stage cannot be restarted in place`
      : "This column has no workflow entry node and cannot be restarted in place");
  }
  return badRequest(`Restart stage is unavailable: ${plan.reason}`);
}

/*
FNXC:ColumnRestart 2026-08-27-23:23:
Restart publishes task state and a workflow continuation through separate durable writes, so write
ordering alone cannot prevent a dispatcher from observing stale artifacts with a new continuation,
or a discarded row through an old continuation. A durable pause is the publication fence every
existing dispatcher and merge gate already honours: W1 raises it before cancellation and W6 lowers
it only after the successor is armed. Re-read the task after W1 before disposing its runtime owner;
production reads materialize a new row, so the pre-fence validation snapshot cannot prove that the
disposer operates behind the durable fence.

A crash between those writes intentionally leaves `restart-stage-publishing` parked and visible.
No automatic sweep owns this reason; rerunning the operator action reuses the same filter and
replace primitive. PROMPT.md deletion is W4, after the durable plan patch and before arm/unfence,
so neither an unmarked plan nor a freshly replanned prompt can be removed. This route adds no new
run-audit mutation: reset/retry use task log entries and pause lifecycle records already provide
the operator audit trail.
*/
export async function restartTaskStage(deps: RestartTaskStageDeps): Promise<Task> {
  const { store, engine, taskId, confirm } = deps;
  if (confirm !== true) {
    throw badRequest("Restart stage discards work produced in the current stage. Pass { \"confirm\": true } to proceed.");
  }

  return store.withPlanningLifecycleLock(taskId, async () => {
    let publicationStep = "validate";
    let fenced = false;
    try {
      const task = await store.getTask(taskId);
      if (!task) throw notFound(`Task ${taskId} not found`);
      const ir = await resolveWorkflowIrForTask(store, task.id);
      const entryNode = resolveColumnResumeNode(ir, task.column);
      const plan = planTaskColumnRestart({ task, ir, entryNode });
      if (plan.kind === "refused") throw refusalError(plan);
      if (!isStaleMergeActiveStatus(task, {
        activeMergeTaskId: deps.activeMergeTaskId ?? null,
        minAgeMs: deps.staleMergingStatusMinAgeMs,
      }) && ["merging", "merging-pr", "merging-fix", "landing"].includes(task.status ?? "")) {
        throw conflict("Restart stage is unavailable while a merge is active");
      }

      publicationStep = "raise publication fence";
      await store.pauseTask(taskId, true, undefined, { pausedReason: RESTART_STAGE_FENCE_REASON });
      fenced = true;

      const fencedTask = await store.getTask(taskId);
      if (!fencedTask) throw notFound(`Task ${taskId} not found after fencing`);

      publicationStep = "dispose active runtime owner";
      await Promise.resolve(engine?.clearTaskPauseAbortState?.(taskId));
      await disposeTaskBeforeReset(store, fencedTask);

      publicationStep = "confirm restart target";
      const freshTask = await store.getTask(taskId);
      if (!freshTask || freshTask.column !== task.column || resolveColumnResumeNode(ir, freshTask?.column)?.id !== plan.entryNodeId) {
        await store.pauseTask(taskId, false);
        fenced = false;
        throw conflict("Restart target changed while cancellation was settling; retry Restart stage");
      }

      publicationStep = "clear restart boundaries";
      await store.resetTerminalFailureAutoRecoveryBudget(taskId);
      await store.clearWorkflowRunStepInstancesAsync?.(taskId);
      if (plan.releaseSymbolLocks) {
        const symbols = resolveTaskSymbolsForTask(freshTask);
        if (symbols.resolvable) await store.releaseSymbolLocks?.(symbols.symbols, taskId);
      }

      publicationStep = "retire predecessor continuations";
      await store.cancelActiveWorkflowWorkItemsForTask(taskId, {
        kinds: ["task"],
        lastError: "restart-stage-fence",
      });

      publicationStep = "publish discarded stage artifacts";
      await store.updateTask(taskId, {
        ...plan.patch,
        paused: true,
        pausedReason: RESTART_STAGE_FENCE_REASON,
      });

      publicationStep = "remove superseded prompt";
      if (plan.deletePrompt) {
        const promptPath = `${store.getRootDir()}/.fusion/tasks/${taskId}/PROMPT.md`;
        await rm(promptPath, { force: true });
      }

      publicationStep = "arm workflow continuation";
      const continuationSequence = (await store.listWorkflowWorkItemsForTask(taskId)).length;
      await store.replaceActiveTaskWorkflowContinuation({
        taskId,
        nodeId: plan.entryNodeId,
        kind: "task",
        state: "runnable",
        waitReason: null,
        blockedReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        retryAfter: null,
        sourceColumn: freshTask.column,
        targetColumn: freshTask.column,
        continuationSequence,
        stableWorkflowRunId: `${taskId}:${ir.name}`,
        runId: `${taskId}:restart-stage:${plan.entryNodeId}:${continuationSequence}`,
        irHash: computeWorkflowIrPin(ir, plan.entryNodeId).irHash,
      });

      publicationStep = "lower publication fence";
      await store.pauseTask(taskId, false);
      fenced = false;
      await store.logEntry(taskId, `Restart stage requested from dashboard (${plan.scope} restart in ${task.column}, discarded ${plan.discardedWorkflowStepIds.length} workflow step result(s), re-entering at ${plan.entryNodeId})`);
      const updated = await store.getTask(taskId);
      if (!updated) throw notFound(`Task ${taskId} not found after restart`);
      return updated;
    } catch (error) {
      if (fenced) {
        await store.logEntry(taskId, `Restart stage publication parked at ${publicationStep}; rerun Restart stage safely`).catch(() => undefined);
        if (error instanceof Error && ("status" in error)) throw error;
        throw conflict(`Restart stage paused at ${publicationStep}; the card is parked with ${RESTART_STAGE_FENCE_REASON} and can be restarted again safely`);
      }
      throw error;
    }
  });
}
