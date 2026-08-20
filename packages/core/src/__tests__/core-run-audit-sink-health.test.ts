import { afterEach, describe, expect, it, vi } from "vitest";

const { asyncAuditSink } = vi.hoisted(() => ({ asyncAuditSink: { current: undefined as undefined | ((event: unknown) => unknown) } }));
vi.mock("../task-store/async/async-audit.js", () => ({
  recordRunAuditEvent: (_layer: unknown, event: unknown) => asyncAuditSink.current?.(event),
}));

vi.mock("../postgres/data-layer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../postgres/data-layer.js")>();
  return { ...actual, recordRunAuditEvent: (_layer: unknown, event: unknown) => asyncAuditSink.current?.(event) };
});

vi.mock("../task-store/async/async-persistence.js", () => ({
  readTaskRow: vi.fn(async () => undefined),
}));

vi.mock("../task-store/async/async-transition-pending.js", () => ({
  listTransitionPendingTaskIdsAsync: vi.fn(async () => ["FN-9177"]),
  readTransitionPendingAsync: vi.fn(async () => ({ toColumn: "todo", hooksRemaining: ["default-workflow:postCommit"], startedAt: 1 })),
  clearTransitionPendingAsync: vi.fn(async () => undefined),
  writeTransitionPendingAsync: vi.fn(async () => undefined),
}));

vi.mock("../task-store/async/async-workflow-workitems.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../task-store/async/async-workflow-workitems.js")>();
  return {
    ...actual,
    recordCompletionHandoff: vi.fn(async (_db: unknown, taskId: string, source: string, acceptedAt?: string) => ({
      taskId, source, acceptedAt: acceptedAt ?? "2026-08-20T00:00:00.000Z",
    })),
    getCompletionHandoffMarker: vi.fn(async () => ({
      taskId: "FN-9177", source: "test", acceptedAt: "2026-08-20T00:00:00.000Z",
    })),
    clearCompletionHandoffMarker: vi.fn(async () => undefined),
    getWorkflowWorkItem: vi.fn(async () => ({ id: "WI-9177", taskId: "FN-9177", runId: "run-9177", state: "running", leaseOwner: "worker" })),
    withTaskWorkflowSerialization: vi.fn(async (_tx: unknown, _projectId: string, _taskId: string, work: () => unknown) => work()),
  };
});

import {
  emitOverseerConfirmation,
  emitOverseerEscalation,
  emitOverseerObservation,
  emitOverseerRecoveryAttempt,
  emitOverseerRetry,
  emitOverseerSteering,
} from "../planner/planner-overseer-events.js";
import { CORE_RUN_AUDIT_EMIT_TIMEOUT_MS } from "../run-audit/emit-bounded-run-audit.js";
import { runPluginColumnTransitionHooksImpl } from "../task-store/audit-ops.js";
import { rehomeOccupantImpl } from "../task-store/branch-group-ops.js";
import { applyPrMergedTransitionImpl } from "../task-store/merge-queue-ops-2.js";
import { insertRunAuditEventRowImpl, recordDependencyCycleRejectedAuditImpl } from "../task-store/task-id-integrity.js";
import { setCompletionHandoffAcceptedMarkerImpl, reconcileLegacyAutoMergeStampsImpl } from "../task-store/task-mutation-ops.js";
import { clearCompletionHandoffAcceptedMarkerImpl } from "../task-store/task-artifacts-ops.js";
import { recoverStaleTransitionPendingImpl } from "../task-store/lifecycle-ops.js";
import { projectMergeRequestToWorkflowWorkItemImpl } from "../task-store/workflow-workitems-ops.js";
import { acquireWorkflowWorkItemLeaseImpl } from "../task-store/workflow-workitems-ops-2.js";
import { markLegacyAutoMergeStampsOnceImpl } from "../task-store/workflow-integrity.js";
import { getTraitRegistry } from "../workflows/trait-registry.js";

const input = { taskId: "FN-9177", stage: "executor" as const, reason: "test", timestamp: "2026-08-20T00:00:00.000Z" };
const façades = [
  emitOverseerObservation,
  emitOverseerSteering,
  emitOverseerRecoveryAttempt,
  emitOverseerRetry,
  emitOverseerConfirmation,
  emitOverseerEscalation,
] as const;

type SinkMode = "absent" | "throw" | "reject" | "never" | "late-resolve" | "late-reject";

function hostileSink(mode: SinkMode) {
  let settle: (() => void) | undefined;
  const sink = vi.fn(() => {
    if (mode === "throw") throw new Error("audit throw");
    if (mode === "reject") return Promise.reject(new Error("audit rejection"));
    if (mode === "never") return new Promise(() => undefined);
    if (mode === "late-resolve") return new Promise<void>((resolve) => { settle = resolve; });
    if (mode === "late-reject") return new Promise<void>((_resolve, reject) => { settle = () => reject(new Error("late audit rejection")); });
    return undefined;
  });
  return { store: mode === "absent" ? {} : { recordRunAuditEvent: sink }, sink, settle: () => settle?.() };
}

async function settleBounded(promise: Promise<void>, mode: SinkMode, settle: () => void): Promise<void> {
  if (mode === "never" || mode.startsWith("late-")) {
    await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
    settle();
  }
  await expect(promise).resolves.toBeUndefined();
}

afterEach(() => vi.useRealTimers());

describe("core audit emitters tolerate hostile sinks", () => {
  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps every planner façade bounded for %s sinks", async (mode) => {
      vi.useFakeTimers();
      for (const emit of façades) {
        const hostile = hostileSink(mode);
        const promise = emit({ ...input, store: hostile.store as never });
        // The planner's immediate timeline users observe this call before awaiting.
        if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
        await settleBounded(promise, mode, hostile.settle);
      }
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps synchronous store audit helpers synchronous for %s sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      asyncAuditSink.current = mode === "absent" ? undefined : hostile.sink;
      const owner = { backendMode: true, asyncLayer: {} };
      expect(() => insertRunAuditEventRowImpl(owner as never, {
        taskId: "FN-9177", domain: "database", mutationType: "test:sync-helper", target: "FN-9177",
      })).not.toThrow();
      expect(() => recordDependencyCycleRejectedAuditImpl(owner as never, "FN-9177", ["FN-9177"], "updateTask")).not.toThrow();
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(2);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
      asyncAuditSink.current = undefined;
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "does not alter workflow reconciliation for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const task = { id: "FN-9177", column: "todo" };
      const owner = {
        ...hostile.store,
        backendMode: false,
        readTaskFromDb: () => task,
        moveTask: vi.fn(async () => task),
      };
      await expect(rehomeOccupantImpl(owner as never, task.id, "todo", "workflow-edit-rehome", { fixture: true })).resolves.toEqual({ moved: true });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      // Reconciliation is fire-and-forget: its result is available before a hostile audit settles.
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "does not alter the merged-PR completion owner for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const task = { id: "FN-9177", column: "in-review", prInfo: { status: "merged", number: 17 }, dependencies: [], steps: [] };
      const owner = {
        ...hostile.store,
        getTask: vi.fn(async () => task),
        getTaskWorkflowSelection: () => undefined,
        getTaskWorkflowSelectionAsync: async () => undefined,
        moveTask: vi.fn(async () => ({ ...task, column: "done" })),
        emit: vi.fn(),
      };
      await expect(applyPrMergedTransitionImpl(owner as never, task.id, { agentId: "merger", runId: "run-9177" })).resolves.toEqual({ moved: true });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps completion handoff marker ownership non-blocking for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      // The marker helper is driven through its real exported owner. Persistence is stubbed only to
      // isolate the post-commit optional audit dependency from the marker's durable write contract.
      const hostile = hostileSink(mode);
      const marker = { taskId: "FN-9177", acceptedAt: "2026-08-20T00:00:00.000Z", source: "test" };
      const owner = { ...hostile.store, asyncLayer: { db: {} } };
      await expect(setCompletionHandoffAcceptedMarkerImpl(owner as never, marker.taskId, { source: marker.source, acceptedAt: marker.acceptedAt })).resolves.toMatchObject({ source: marker.source });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps completion handoff clearing non-blocking for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const owner = { ...hostile.store, asyncLayer: { db: {} } };
      await expect(clearCompletionHandoffAcceptedMarkerImpl(owner as never, "FN-9177")).resolves.toBeUndefined();
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps legacy stamp reconciliation results unchanged for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const task = { id: "FN-9177", column: "in-review", autoMerge: true, autoMergeProvenance: "legacy-stamp" };
      const owner = {
        ...hostile.store,
        listLegacyAutoMergeStampCandidates: vi.fn(async () => [task]),
        listWorkflowDefinitions: vi.fn(async () => []),
        getTask: vi.fn(async () => ({ ...task })),
        isLegacyAutoMergeStampCandidate: vi.fn(() => true),
        atomicWriteTaskJson: vi.fn(async () => undefined),
        taskDir: vi.fn(() => "/fixture/FN-9177"),
        isWatching: false,
        emitTaskLifecycleEventSafely: vi.fn(),
      };
      await expect(reconcileLegacyAutoMergeStampsImpl(owner as never, { apply: true })).resolves.toEqual([
        { taskId: task.id, column: task.column, cleared: true },
      ]);
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps work-item lease acquisition non-blocking for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const tx = { update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })) };
      const owner = {
        ...hostile.store,
        asyncLayer: { projectId: "project-9177", transactionImmediate: async (work: (tx: typeof tx) => unknown) => work(tx) },
      };
      await expect(acquireWorkflowWorkItemLeaseImpl(owner as never, "WI-9177", "worker", { leaseDurationMs: 1, now: "2026-08-20T00:00:00.000Z" })).resolves.toMatchObject({ id: "WI-9177" });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps legacy stamp marking non-blocking for %s audit sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const task = { id: "FN-9177", column: "in-review", autoMerge: true };
      const prepare = vi.fn(() => ({ get: vi.fn(() => undefined), run: vi.fn() }));
      const owner = {
        ...hostile.store,
        db: { prepare, bumpLastModified: vi.fn() },
        listLegacyAutoMergeStampCandidates: vi.fn(async () => [task]),
        listWorkflowDefinitions: vi.fn(async () => []),
        getTask: vi.fn(async () => ({ ...task })),
        isLegacyAutoMergeStampCandidate: vi.fn(() => true),
        atomicWriteTaskJson: vi.fn(async () => undefined),
        taskDir: vi.fn(() => "/fixture/FN-9177"),
        isWatching: false,
        emitTaskLifecycleEventSafely: vi.fn(),
      };
      await expect(markLegacyAutoMergeStampsOnceImpl(owner as never)).resolves.toBeUndefined();
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

});

describe("remaining production owners retain hostile-sink isolation", () => {
  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps plugin trait degradation and merge-request projection non-blocking for %s sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const registry = getTraitRegistry();
      // The exported hook runner is exercised with a real plugin descriptor whose missing
      // implementation takes the production "no-impl" degradation audit branch.
      try { registry.registerTrait({ id: "plugin:fn-9177-audit", name: "audit", flags: {}, hooks: { onEnter: true } }); } catch { /* singleton may retain the fixture trait */ }
      const hookOwner = { ...hostile.store, asyncLayer: { db: {} }, rowToTask: (value: unknown) => value };
      await expect(runPluginColumnTransitionHooksImpl(hookOwner as never, "FN-9177", {
        version: 1, nodes: [], edges: [], columns: [{ id: "todo", name: "Todo", traits: [{ trait: "plugin:fn-9177-audit" }] }],
      } as never, "other", "todo")).resolves.toBeUndefined();

      asyncAuditSink.current = mode === "absent" ? undefined : hostile.sink;
      const projectionOwner = {
        asyncLayer: {}, getMergeRequestRecordAsync: vi.fn(async () => ({ state: "pending", attemptCount: 1, updatedAt: "2026-08-20T00:00:00.000Z" })),
        workflowStateForMergeRequestState: vi.fn(() => "runnable"),
        upsertWorkflowWorkItem: vi.fn(async () => ({ id: "WI-9177", runId: "run-9177", state: "runnable", kind: "merge" })),
        cancelActiveWorkflowWorkItemsForTask: vi.fn(async () => undefined),
      };
      await expect(projectMergeRequestToWorkflowWorkItemImpl(projectionOwner as never, "FN-9177")).resolves.toMatchObject({ id: "WI-9177" });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalled();
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
      asyncAuditSink.current = undefined;
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps transition-pending recovery results unchanged for %s sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const owner = {
        ...hostile.store, backendMode: true, asyncLayer: { db: {} },
        withTaskLock: async (_id: string, work: () => unknown) => work(),
      };
      await expect(recoverStaleTransitionPendingImpl(owner as never)).resolves.toEqual({ scanned: 1, recovered: 1, degradedHooks: 0 });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );

  it.each(["absent", "throw", "reject", "never", "late-resolve", "late-reject"] as const)(
    "keeps the already-rehomed reconciliation owner non-blocking for %s sinks", async (mode) => {
      vi.useFakeTimers();
      const hostile = hostileSink(mode);
      const task = { id: "FN-9177", column: "todo" };
      const owner = { ...hostile.store, backendMode: false, readTaskFromDb: () => task, moveTask: vi.fn() };
      await expect(rehomeOccupantImpl(owner as never, task.id, "todo", "workflow-edit-rehome", { fixture: true })).resolves.toEqual({ moved: true });
      if (mode !== "absent") expect(hostile.sink).toHaveBeenCalledTimes(1);
      if (mode === "never" || mode.startsWith("late-")) await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
      hostile.settle();
    },
  );
});
