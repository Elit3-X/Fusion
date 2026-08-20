import { afterEach, describe, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => vi.fn());
const asyncAudit = vi.hoisted(() => vi.fn());
const softDelete = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const readTaskRow = vi.hoisted(() => vi.fn());
const lifecycle = vi.hoisted(() => ({
  acknowledgeTaskLifecycleEvent: vi.fn(async () => true),
  acquireTaskLifecycleLease: vi.fn(async () => ({ token: "lease", fencingToken: 1n })),
  advanceTaskLifecycleConsumerCursor: vi.fn(async () => true),
  hasTaskLifecycleConsumerReceipt: vi.fn(async () => false),
  listTaskLifecycleEvents: vi.fn(async () => []),
  readTaskLifecycleConsumerCursor: vi.fn(async () => ({ fencingToken: 1n, lastAckedSeq: 0n, retryAttempts: 0, updatedAt: new Date().toISOString() })),
  readTaskLifecycleEventBounds: vi.fn(async () => ({ headSeq: 4n, oldestSeq: 1n })),
  registerTaskLifecycleConsumer: vi.fn(async () => undefined),
  releaseTaskLifecycleLease: vi.fn(async () => undefined),
  renewTaskLifecycleLease: vi.fn(async () => true),
  setTaskLifecycleConsumerActive: vi.fn(async () => undefined),
}));
vi.mock("../postgres/data-layer.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../postgres/data-layer.js")>()),
  recordRunAuditEvent: audit,
}));
vi.mock("../task-store/async/async-audit.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../task-store/async/async-audit.js")>()),
  recordRunAuditEvent: asyncAudit,
}));
vi.mock("../task-store/async/async-persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../task-store/async/async-persistence.js")>()),
  softDeleteTaskRow: softDelete,
  readTaskRow,
}));
vi.mock("../task-store/task-lifecycle-consumer-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../task-store/task-lifecycle-consumer-registry.js")>()),
  acknowledgeTaskLifecycleEvent: lifecycle.acknowledgeTaskLifecycleEvent,
  acquireTaskLifecycleLease: lifecycle.acquireTaskLifecycleLease,
  advanceTaskLifecycleConsumerCursor: lifecycle.advanceTaskLifecycleConsumerCursor,
  hasTaskLifecycleConsumerReceipt: lifecycle.hasTaskLifecycleConsumerReceipt,
  listTaskLifecycleEvents: lifecycle.listTaskLifecycleEvents,
  readTaskLifecycleConsumerCursor: lifecycle.readTaskLifecycleConsumerCursor,
  readTaskLifecycleEventBounds: lifecycle.readTaskLifecycleEventBounds,
  registerTaskLifecycleConsumer: lifecycle.registerTaskLifecycleConsumer,
  releaseTaskLifecycleLease: lifecycle.releaseTaskLifecycleLease,
  renewTaskLifecycleLease: lifecycle.renewTaskLifecycleLease,
  setTaskLifecycleConsumerActive: lifecycle.setTaskLifecycleConsumerActive,
}));

import { createRecallCaptureWriter } from "../memory/recall-capture.js";
import { resolveSameAgentDuplicateIntake } from "../task-store/task-creation.js";
import { maybeResolveTombstonedTaskIdImpl } from "../task-store/task-id-integrity.js";
import { TombstonedTaskResurrectionError } from "../task-store/errors.js";
import { pruneTaskLifecycleEvents } from "../task-store/task-lifecycle-event-retention.js";
import { TaskDeletedOutboxConsumer } from "../task-store/task-deleted-outbox-consumer.js";

/*
 * FNXC:RunAudit 2026-08-20-06:40:
 * FN-9178 invokes real helper-owned entry points with hostile audit helpers. It records existing
 * awaiting/ordering behavior only; fake timers make the never-settling observation deterministic.
 */
function emptyQuery() {
  const query: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy", "limit"]) query[method] = () => query;
  query.then = (resolve: (value: unknown[]) => unknown) => resolve([]);
  return query;
}

function retentionLayer() {
  return { projectId: "project", db: { select: vi.fn(() => emptyQuery()) } } as never;
}

describe("FN-9178 awaited data-layer audit characterization", () => {
  afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

  function resurrectionStore() {
    return {
      asyncLayer: { projectId: "project", db: {} }, isWatching: true, taskCache: new Map(),
      taskDir: vi.fn(() => "/definitely-absent"), getSettings: vi.fn().mockResolvedValue({ tombstoneStickyWindowDays: 7 }),
      listTasksBySourceLineage: vi.fn(),
    } as never;
  }

  it.each([
    ["absent", () => undefined, true],
    ["synchronous throw", () => { throw new Error("sync"); }, false],
    ["rejection", () => Promise.reject(new Error("reject")), false],
  ])("intake resurrection keeps destructive follow-up ordered after a %s audit", async (_state, sink, deletes) => {
    asyncAudit.mockImplementation(sink as never);
    const store = resurrectionStore();
    const deletedAt = new Date().toISOString();
    const task = { id: "FN-INTAKE", title: "new", description: "new", column: "todo", createdAt: deletedAt, sourceAgentId: "agent", sourceParentTaskId: null };
    store.listTasksBySourceLineage.mockResolvedValue([task, { ...task, id: "FN-TOMB", deletedAt, allowResurrection: false }]);
    const operation = resolveSameAgentDuplicateIntake(store, task as never, task as never);
    if (deletes) await expect(operation).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);
    else await expect(operation).resolves.toBeUndefined(); // The helper fails open when forensic audit cannot land.
    expect(softDelete).toHaveBeenCalledTimes(deletes ? 1 : 0);
  });

  it("intake resurrection remains pending and cannot delete before a never-settling audit", async () => {
    const store = resurrectionStore(); const deletedAt = new Date().toISOString();
    const task = { id: "FN-never-settling", title: "new", description: "new", column: "todo", createdAt: deletedAt, sourceAgentId: "agent", sourceParentTaskId: null };
    store.listTasksBySourceLineage.mockResolvedValue([task, { ...task, id: "FN-TOMB", deletedAt, allowResurrection: false }]);
    asyncAudit.mockImplementation(() => new Promise<never>(() => undefined));
    vi.useFakeTimers(); let settled = false;
    void resolveSameAgentDuplicateIntake(store, task as never, task as never).finally(() => { settled = true; }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(softDelete).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it("intake resurrection throws its typed error after a late audit permits destructive cleanup", async () => {
    const store = resurrectionStore(); const deletedAt = new Date().toISOString();
    const task = { id: "FN-late-settling", title: "new", description: "new", column: "todo", createdAt: deletedAt, sourceAgentId: "agent", sourceParentTaskId: null };
    store.listTasksBySourceLineage.mockResolvedValue([task, { ...task, id: "FN-TOMB", deletedAt, allowResurrection: false }]);
    asyncAudit.mockImplementation(() => new Promise<void>((resolve) => setTimeout(resolve, 2_100)));
    vi.useFakeTimers();
    const operation = resolveSameAgentDuplicateIntake(store, task as never, task as never);
    // FNXC:RunAudit 2026-08-20-07:16: Observe the deferred forensic rejection before fake-time advancement, then assert its real type.
    void operation.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(softDelete).toHaveBeenCalledOnce();
    await expect(operation).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);
  });

  it.each([
    ["absent", () => undefined],
    ["synchronous throw", () => { throw new Error("sync"); }],
    ["rejection", () => Promise.reject(new Error("reject"))],
    ["never-settling", () => new Promise<never>(() => undefined)],
    ["late-settling", () => new Promise<void>((resolve) => setTimeout(resolve, 2_100))],
  ])("id-integrity resurrection preserves its typed throw after %s audit behavior", async (_state, sink) => {
    const deletedAt = new Date().toISOString();
    readTaskRow.mockResolvedValue({ deletedAt, allowResurrection: false });
    asyncAudit.mockImplementation(sink as never);
    const store = resurrectionStore();
    if (_state.includes("settling")) vi.useFakeTimers();
    const operation = maybeResolveTombstonedTaskIdImpl(store, "FN-TOMB", {}, "createTask");
    // Attach an observer immediately: fake-time advancement may settle the late audit before the
    // assertion below awaits this deliberately rejecting forensic entry point.
    void operation.catch(() => undefined);
    if (_state === "never-settling") {
      let settled = false; void operation.finally(() => { settled = true; }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(2_100); expect(settled).toBe(false);
    } else if (_state === "late-settling") {
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(operation).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);
    } else if (_state === "absent") {
      await expect(operation).rejects.toBeInstanceOf(TombstonedTaskResurrectionError);
    } else {
      // Unlike the intake helper, this forensic pre-throw entry lets audit failure replace its
      // typed resurrection error; that observable ordering is class-B evidence, not a fix.
      await expect(operation).rejects.toThrow(_state === "synchronous throw" ? "sync" : "reject");
    }
  });
  it.each([
    ["absent", () => undefined],
    ["synchronous throw", () => { throw new Error("sync"); }],
    ["rejection", () => Promise.reject(new Error("rejected"))],
  ])("drives retention pruning through a %s audit helper", async (_state, sink) => {
    audit.mockImplementation(sink as never);
    const layer = retentionLayer();
    const operation = pruneTaskLifecycleEvents(layer, "project");
    if (_state === "absent") await expect(operation).resolves.toMatchObject({ prunedCount: 0 });
    else await expect(operation).rejects.toThrow();
    expect(audit).toHaveBeenCalledWith(layer, expect.objectContaining({ mutationType: "task-deleted-outbox:retention-pruned" }));
  });

  it("retention pruning remains pending for a never-settling audit helper", async () => {
    const layer = retentionLayer();
    audit.mockImplementation(() => new Promise<never>(() => undefined));
    vi.useFakeTimers();
    try {
      let settled = false;
      void pruneTaskLifecycleEvents(layer, "project").finally(() => { settled = true; }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(settled).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it("a late retention audit delays the real return until it settles", async () => {
    const layer = retentionLayer();
    let resolve!: () => void;
    audit.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    audit.mockClear();
    const operation = pruneTaskLifecycleEvents(layer, "project");
    await vi.waitFor(() => expect(audit).toHaveBeenCalled());
    resolve();
    await expect(operation).resolves.toMatchObject({ prunedCount: 0 });
  });

  it.each([
    ["absent", () => undefined, true],
    ["synchronous throw", () => { throw new Error("sync"); }, false],
    ["rejection", () => Promise.reject(new Error("rejected")), false],
  ])("reconciliation fallback advances its cursor before a %s audit helper", async (_state, sink, completes) => {
    audit.mockImplementation(sink as never);
    const layer = retentionLayer();
    const store = { asyncLayer: layer, consumerId: "consumer", taskCache: new Map(), emitObservedTaskDeleted: vi.fn() } as never;
    const operation = (new TaskDeletedOutboxConsumer(store) as never).reconcile(0n, { fencingToken: 1n }, "pruned-gap");
    if (completes) await expect(operation).resolves.toBe(true); else await expect(operation).rejects.toThrow();
    expect(lifecycle.advanceTaskLifecycleConsumerCursor).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(layer, expect.objectContaining({ mutationType: "task-deleted-outbox:reconciliation-fallback" }));
  });

  it.each(["never-settling", "late-settling"])("reconciliation fallback waits after its cursor advance for %s audit", async (state) => {
    const layer = retentionLayer();
    audit.mockImplementation((state === "never-settling" ? () => new Promise<never>(() => undefined) : () => new Promise<void>((resolve) => setTimeout(resolve, 2_100))) as never);
    const store = { asyncLayer: layer, consumerId: "consumer", taskCache: new Map(), emitObservedTaskDeleted: vi.fn() } as never;
    vi.useFakeTimers();
    let settled = false;
    void (new TaskDeletedOutboxConsumer(store) as never).reconcile(0n, { fencingToken: 1n }, "pruned-gap").finally(() => { settled = true; }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(lifecycle.advanceTaskLifecycleConsumerCursor).toHaveBeenCalledOnce();
    expect(settled).toBe(state === "late-settling");
  });

  function catchUpStore() {
    return {
      asyncLayer: retentionLayer(), consumerId: "consumer", taskCache: new Map([["FN-DELETED", { id: "FN-DELETED" }]]),
      emitObservedTaskDeleted: vi.fn(),
    } as never;
  }

  function deletedEvent() {
    return {
      eventId: "event-1", eventType: "task:deleted", taskId: "FN-DELETED", occurredAt: new Date().toISOString(), seq: 1n,
      payload: { taskId: "FN-DELETED", previousColumn: "todo", previousStatus: null, deletedAt: new Date().toISOString(), allowResurrection: false, githubIssueAction: null, closureContext: null, deletedBy: null },
    };
  }

  it.each([
    ["absent", () => undefined, true],
    ["synchronous throw", () => { throw new Error("sync"); }, false],
    ["rejection", () => Promise.reject(new Error("rejected")), false],
  ])("drives catch-up through the production poll batch before a %s audit helper", async (_state, sink, completes) => {
    lifecycle.listTaskLifecycleEvents.mockResolvedValueOnce([deletedEvent()]);
    audit.mockImplementation(sink as never);
    const consumer = new TaskDeletedOutboxConsumer(catchUpStore());
    /*
     * FNXC:RunAudit 2026-08-20-07:04:
     * The characterization must use poll's production batch path. Set only its lifecycle-owned
     * running gate to avoid adding a background scheduler while retaining lease-to-release order.
     */
    (consumer as never).running = true;
    const operation = consumer.poll();
    if (completes) await expect(operation).resolves.toBe("active"); else await expect(operation).rejects.toThrow();
    expect(lifecycle.acknowledgeTaskLifecycleEvent).toHaveBeenCalledOnce();
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mutationType: "task-deleted-outbox:catch-up" }));
    expect(lifecycle.releaseTaskLifecycleLease).toHaveBeenCalledOnce();
  });

  it("keeps the real catch-up poll and its lease cleanup pending for a never-settling audit", async () => {
    lifecycle.listTaskLifecycleEvents.mockResolvedValueOnce([deletedEvent()]);
    audit.mockImplementation(() => new Promise<never>(() => undefined));
    const consumer = new TaskDeletedOutboxConsumer(catchUpStore());
    (consumer as never).running = true;
    vi.useFakeTimers();
    try {
      let settled = false;
      void consumer.poll().finally(() => { settled = true; }).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(2_100);
      expect(lifecycle.acknowledgeTaskLifecycleEvent).toHaveBeenCalledOnce();
      expect(settled).toBe(false);
      expect(lifecycle.releaseTaskLifecycleLease).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("finishes the real catch-up poll only after a late audit settles beyond the bounded window", async () => {
    lifecycle.listTaskLifecycleEvents.mockResolvedValueOnce([deletedEvent()]);
    let resolveAudit!: () => void;
    audit.mockImplementation(() => new Promise<void>((resolve) => { resolveAudit = resolve; }));
    const consumer = new TaskDeletedOutboxConsumer(catchUpStore());
    (consumer as never).running = true;
    vi.useFakeTimers();
    try {
      const operation = consumer.poll();
      await vi.advanceTimersByTimeAsync(2_100);
      expect(lifecycle.acknowledgeTaskLifecycleEvent).toHaveBeenCalledOnce();
      expect(lifecycle.releaseTaskLifecycleLease).not.toHaveBeenCalled();
      resolveAudit();
      await expect(operation).resolves.toBe("active");
      expect(lifecycle.releaseTaskLifecycleLease).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ["absent", () => undefined, true],
    ["synchronous throw", () => { throw new Error("sync"); }, false],
    ["rejection", () => Promise.reject(new Error("rejected")), false],
  ])("drives the real outbox lease-fenced entry through a %s audit helper", async (_state, sink, completes) => {
    audit.mockImplementation(sink as never);
    const store = { asyncLayer: retentionLayer(), consumerId: "consumer" } as never;
    const operation = (new TaskDeletedOutboxConsumer(store) as never).recordLeaseFenced({ fencingToken: 1n }, 1);
    if (completes) await expect(operation).resolves.toBeUndefined(); else await expect(operation).rejects.toThrow();
    expect(audit).toHaveBeenCalledWith(store.asyncLayer, expect.objectContaining({ mutationType: "task-deleted-outbox:lease-fenced" }));
  });

  it.each(["never-settling", "late-settling"])("outbox lease-fenced awaits a %s audit helper", async (state) => {
    audit.mockImplementation((state === "never-settling" ? () => new Promise<never>(() => undefined) : () => new Promise<void>((resolve) => setTimeout(resolve, 2_100))) as never);
    const store = { asyncLayer: retentionLayer(), consumerId: "consumer" } as never;
    vi.useFakeTimers(); let settled = false;
    void (new TaskDeletedOutboxConsumer(store) as never).recordLeaseFenced({ fencingToken: 1n }, 1).finally(() => { settled = true; }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(2_100);
    expect(settled).toBe(state === "late-settling");
  });

  it.each([
    ["absent", () => undefined],
    ["synchronous throw", () => { throw new Error("sync"); }],
    ["rejection", () => Promise.reject(new Error("reject"))],
    ["never-settling", () => new Promise<never>(() => undefined)],
    ["late-settling", () => new Promise<void>((resolve) => setTimeout(resolve, 2_100))],
  ])("recall capture contains %s injected audit without unhandled rejection", async (_state, injectedAudit) => {
    const logger = { warn: vi.fn() };
    const writer = createRecallCaptureWriter({
      layer: {} as never, append: async () => ({ status: "created", record: { id: "recall-1" } }) as never,
      audit: injectedAudit as never, logger,
    });
    if (_state.includes("settling")) vi.useFakeTimers();
    writer.capture({ origin: "insight", summary: "summary", insightId: "INS-1" });
    if (_state === "never-settling") {
      await vi.advanceTimersByTimeAsync(2_100);
      expect(logger.warn).not.toHaveBeenCalled();
    } else if (_state === "late-settling") {
      await vi.advanceTimersByTimeAsync(2_100);
      await writer.flushPendingCaptures();
      expect(logger.warn).not.toHaveBeenCalled();
    } else {
      await writer.flushPendingCaptures();
      expect(logger.warn).toHaveBeenCalledTimes(_state === "absent" ? 0 : 1);
    }
  });
});
