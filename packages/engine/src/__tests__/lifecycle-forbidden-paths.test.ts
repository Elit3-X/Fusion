import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  getBuiltinWorkflow,
  resolveContainedBackwardTargetForTask,
  evaluateLifecycleDirectionPostcondition,
  TransitionRejectionError,
  type Task,
  type TaskStore,
  type WorkflowIr,
} from "@fusion/core";
import { ContaminationAutoRecoveryHandler } from "../auto-recovery-handlers/contamination.js";
import { performWorkflowRerunBounce } from "../executor/workflow-rerun-bounce.js";
import { RestartRecoveryCoordinator } from "../healing/restart-recovery-coordinator.js";
import { reboundAiMergeTask } from "../merge/merger-ai.js";
import { reboundLegacyMergeTask } from "../merger.js";
import { SelfHealingManager } from "../self-healing.js";

function storeFor(workflowId: string, customIr?: WorkflowIr) {
  return {
    getTaskWorkflowSelection: vi.fn(() => ({ workflowId, stepIds: [] })),
    getWorkflowDefinition: vi.fn(async (id: string) => {
      if (customIr && id === workflowId) return { ir: customIr };
      return getBuiltinWorkflow(id);
    }),
  };
}

function productionStore(options: {
  task?: Partial<Task>;
  workflowId?: string;
  customIr?: WorkflowIr;
  capacityBlocked?: boolean;
} = {}) {
  const workflowId = options.workflowId ?? "builtin:coding";
  const task = {
    id: "FN-207-family",
    column: "in-review",
    paused: false,
    status: "failed",
    error: "Agent finished without calling fn_task_done",
    steps: [{ name: "Implementation", status: "in-progress" }],
    dependencies: [],
    log: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    ...options.task,
  } as Task;
  const emitter = new EventEmitter();
  const store = Object.assign(emitter, {
    getTask: vi.fn(async () => task),
    getSettings: vi.fn(async () => ({ autoMerge: true, taskStuckTimeoutMs: 1 })),
    getTaskWorkflowSelection: vi.fn(() => ({ workflowId, stepIds: [] })),
    getTaskWorkflowSelectionAsync: vi.fn(async () => ({ workflowId, stepIds: [] })),
    getWorkflowDefinition: vi.fn(async (id: string) => {
      if (options.customIr && id === workflowId) return { ir: options.customIr };
      return getBuiltinWorkflow(id);
    }),
    listWorkflowDefinitions: vi.fn(async () => [
      options.customIr ? { ir: options.customIr } : getBuiltinWorkflow(workflowId),
    ]),
    listTasks: vi.fn(async () => [task]),
    updateTask: vi.fn(async (_id: string, patch: Partial<Task>) => Object.assign(task, patch)),
    logEntry: vi.fn(async () => undefined),
    recordRunAuditEvent: vi.fn(async () => undefined),
    moveTask: vi.fn(async (_id: string, column: string) => {
      if (options.capacityBlocked) {
        throw new TransitionRejectionError({
          code: "capacity-exhausted",
          messageKey: "transition.rejected.capacityExhausted",
          retryable: true,
          detail: "WIP is full",
        }, "WIP is full");
      }
      task.column = column;
      return task;
    }),
  });
  return { store: store as unknown as TaskStore & EventEmitter, task };
}

describe("forbidden lifecycle rebound paths", () => {
  it.each(["builtin:coding", "builtin:coding-ideas"])(
    "contains review and WIP rebounds to one adjacent rank on %s",
    async (workflowId) => {
      const store = storeFor(workflowId);

      await expect(resolveContainedBackwardTargetForTask(store as never, "FN-207", "in-review"))
        .resolves.toBe("in-progress");
      await expect(resolveContainedBackwardTargetForTask(store as never, "FN-207", "in-progress"))
        .resolves.toBe("todo");
      await expect(resolveContainedBackwardTargetForTask(store as never, "FN-207", "todo"))
        .resolves.toBeUndefined();
    },
  );

  it("leaves review in place when a custom workflow declares no WIP lane", async () => {
    const ir = {
      version: 2,
      id: "custom:no-wip",
      name: "No WIP",
      entry: "planning",
      columns: [
        { id: "planning", name: "Planning", traits: ["hold"] },
        { id: "review", name: "Review", traits: ["merge-blocker", "human-review"] },
        { id: "done", name: "Done", traits: ["complete"] },
      ],
      nodes: [{ id: "review-node", kind: "prompt", column: "review", config: { prompt: "Review" } }],
      edges: [],
    } as unknown as WorkflowIr;
    const store = storeFor(ir.id!, ir);

    await expect(resolveContainedBackwardTargetForTask(store as never, "FN-207", "review"))
      .resolves.toBeUndefined();
  });

  it("rejects review-to-Planning structurally even when the mover supplies a registered reason", () => {
    const rejection = evaluateLifecycleDirectionPostcondition({
      taskId: "FN-207",
      from: { columnId: "in-review", flags: { mergeBlocker: true, humanReview: true } },
      to: { columnId: "todo", flags: { hold: true } },
      mergeBlockerReason: null,
      moveSource: "engine",
      lifecycleReason: "self-healing-stranded-recovery",
    });

    expect(rejection).toMatchObject({
      code: "guard-rejected",
      messageKey: "transition.rejected.forbiddenLifecyclePath",
      retryable: false,
    });
    expect(rejection?.detail).toContain("F2");
    expect(rejection?.detail).toContain("'in-review' (review)");
    expect(rejection?.detail).toContain("'todo' (hold)");
  });

  it("drives the production review-remediation bounce directly to WIP", async () => {
    const row = {
      id: "FN-207-bounce",
      column: "in-review",
      paused: false,
      executionStartedAt: "2026-08-28T00:00:00.000Z",
    };
    const store = {
      getTask: vi.fn(async () => row),
      moveTask: vi.fn(async (_id: string, column: string) => Object.assign(row, { column })),
      updateTask: vi.fn(async (_id: string, patch: object) => Object.assign(row, patch)),
      logEntry: vi.fn(async () => undefined),
    };
    const clearTerminalStepFailuresForRetry = vi.fn(async () => undefined);

    const outcome = await performWorkflowRerunBounce({
      store,
      workflowRerunPending: new Set<string>(),
      getExecutionPauseLabel: vi.fn(async () => null),
      resolveResumeLanes: vi.fn(async () => ({ wip: "in-progress", review: "in-review" })),
      clearTerminalStepFailuresForRetry,
    } as never, row.id, "/worktrees/fn-207", true);

    expect(outcome).toBe("bounced");
    expect(row.column).toBe("in-progress");
    expect(store.moveTask).toHaveBeenCalledTimes(1);
    expect(store.moveTask).toHaveBeenCalledWith(row.id, "in-progress", expect.objectContaining({
      lifecycleReason: "workflow-graph-node-column",
      preserveResumeState: true,
      preserveWorktree: true,
      workflowMoveSource: "workflow-remediation",
    }));
    expect(clearTerminalStepFailuresForRetry).toHaveBeenCalledWith(row.id, "archive");
  });

  it("repairs a remediation already in WIP without a sideways reset move", async () => {
    const row = { id: "FN-207-wip", column: "in-progress", paused: false };
    const store = {
      getTask: vi.fn(async () => row),
      moveTask: vi.fn(),
      updateTask: vi.fn(async (_id: string, patch: object) => Object.assign(row, patch)),
      logEntry: vi.fn(async () => undefined),
    };

    await expect(performWorkflowRerunBounce({
      store,
      workflowRerunPending: new Set<string>(),
      getExecutionPauseLabel: vi.fn(async () => null),
      resolveResumeLanes: vi.fn(async () => ({ wip: "in-progress", review: "in-review" })),
      clearTerminalStepFailuresForRetry: vi.fn(async () => undefined),
    } as never, row.id, "/worktrees/fn-207", true)).resolves.toBe("bounced");

    expect(store.moveTask).not.toHaveBeenCalled();
    expect(row.column).toBe("in-progress");
  });

  it("routes the production stale-incomplete self-healing sweep from review to WIP", async () => {
    const { store, task } = productionStore({
      task: { columnMovedAt: "2026-08-27T00:00:00.000Z" },
    });
    const manager = new SelfHealingManager(store, { rootDir: "/tmp/fn-207-family" });
    vi.spyOn(manager as never, "evaluateBackwardMoveTripleProof" as never).mockResolvedValue({ ok: true } as never);

    try {
      await expect(manager.recoverStaleIncompleteReviewTasks()).resolves.toBe(1);
      expect(task.column).toBe("in-progress");
      expect(store.moveTask).toHaveBeenCalledWith(task.id, "in-progress", expect.objectContaining({
        lifecycleReason: "self-healing-stranded-recovery",
        moveSource: "engine",
      }));
    } finally {
      manager.stop();
    }
  });

  it.each([
    ["legacy merger", reboundLegacyMergeTask],
    ["AI merger", reboundAiMergeTask],
  ] as const)("routes the %s production rebound seam from review to WIP", async (_family, rebound) => {
    const { store, task } = productionStore();

    await expect(rebound(store, task.id)).resolves.toEqual({ moved: true });

    expect(task.column).toBe("in-progress");
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "in-progress", expect.objectContaining({
      lifecycleReason: "merge-failure-rebound",
      moveSource: "engine",
      preserveProgress: true,
    }));
  });

  it("keeps an AI-merger rebound in review when WIP capacity is exhausted", async () => {
    const { store, task } = productionStore({ capacityBlocked: true });

    await expect(reboundAiMergeTask(store, task.id)).resolves.toEqual({
      moved: false,
      deferred: "capacity",
      detail: "WIP is full",
    });

    expect(task.column).toBe("in-review");
    expect(store.logEntry).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining("Lifecycle move deferred: in-review → in-progress"),
    );
  });

  it("routes the production contamination retry from review to WIP", async () => {
    const { store, task } = productionStore();
    const runAudit = { database: vi.fn(async () => undefined) };
    const handler = new ContaminationAutoRecoveryHandler({
      taskStore: store,
      runAudit: runAudit as never,
      repoDir: "/tmp/fn-207-family",
    });

    await handler.issueRetry(
      { class: "branch-cross-contamination", evidence: { ownCommits: 0, foreignAttributedCommits: 0 } } as never,
      { rationale: "bounded retry" } as never,
      { task, retryCount: 0, settings: { maxRetries: 3 } } as never,
    );

    expect(task.column).toBe("in-progress");
    expect(store.moveTask).toHaveBeenCalledWith(task.id, "in-progress", expect.objectContaining({
      lifecycleReason: "contamination-recovery",
      moveSource: "engine",
    }));
  });

  it("keeps restart recovery in review when the workflow declares no WIP lane", async () => {
    const noWipIr = {
      version: 2,
      id: "custom:no-wip-restart",
      name: "No WIP restart",
      entry: "planning",
      columns: [
        { id: "planning", name: "Planning", traits: ["hold"] },
        { id: "review", name: "Review", traits: ["merge-blocker", "human-review"] },
        { id: "done", name: "Done", traits: ["complete"] },
      ],
      nodes: [{ id: "review-node", kind: "prompt", column: "review", config: { prompt: "Review" } }],
      edges: [],
    } as unknown as WorkflowIr;
    const { store, task } = productionStore({
      workflowId: noWipIr.id!,
      customIr: noWipIr,
      task: { column: "review", steps: [] },
    });
    const coordinator = new RestartRecoveryCoordinator(
      store,
      { resumeOrphaned: vi.fn(async () => undefined) } as never,
    );

    await (coordinator as any).safeRequeue(task);

    expect(task.column).toBe("review");
    expect(store.moveTask).not.toHaveBeenCalled();
    expect(store.logEntry).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining("workflow declares no adjacent backward destination"),
    );
  });

  it("permits only the declared adjacent recovery pairs for automatic movers", () => {
    expect(evaluateLifecycleDirectionPostcondition({
      taskId: "FN-207",
      from: { columnId: "in-review", flags: { mergeBlocker: true } },
      to: { columnId: "in-progress", flags: { countsTowardWip: true } },
      mergeBlockerReason: null,
      moveSource: "engine",
      lifecycleReason: "merge-failure-rebound",
    })).toBeNull();

    expect(evaluateLifecycleDirectionPostcondition({
      taskId: "FN-207",
      from: { columnId: "in-progress", flags: { countsTowardWip: true } },
      to: { columnId: "todo", flags: { hold: true } },
      mergeBlockerReason: null,
      moveSource: "scheduler",
      lifecycleReason: "workflow-retry-rehome",
    })).toBeNull();
  });
});
