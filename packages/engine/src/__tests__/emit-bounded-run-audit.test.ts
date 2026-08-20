import { describe, expect, it, vi } from "vitest";
import { EXECUTOR_RUN_AUDIT_EMIT_TIMEOUT_MS, emitBoundedRunAudit } from "../executor/emit-bounded-run-audit.js";

const event = { taskId: "FN-9172", agentId: "executor", runId: "run", domain: "database", mutationType: "task:execution-blocked-parked", target: "FN-9172", metadata: { taskId: "FN-9172", outcome: "parked" } } as any;

describe("emitBoundedRunAudit", () => {
  it.each([undefined, null, {}])("ignores an absent or non-function sink", async (store) => {
    await expect(emitBoundedRunAudit(store as any, event)).resolves.toBeUndefined();
  });

  it("forwards the event unchanged to a healthy sink", async () => {
    const recordRunAuditEvent = vi.fn().mockResolvedValue(undefined);
    await emitBoundedRunAudit({ recordRunAuditEvent } as any, event);
    expect(recordRunAuditEvent).toHaveBeenCalledOnce();
    expect(recordRunAuditEvent).toHaveBeenCalledWith(event);
  });

  it.each([
    ["throws synchronously", vi.fn(() => { throw new Error("boom"); })],
    ["rejects", vi.fn().mockRejectedValue(new Error("boom"))],
  ])("contains a sink that %s", async (_name, recordRunAuditEvent) => {
    await expect(emitBoundedRunAudit({ recordRunAuditEvent } as any, event)).resolves.toBeUndefined();
  });

  it("honors an override when a sink never settles", async () => {
    vi.useFakeTimers();
    try {
      const pending = emitBoundedRunAudit({ recordRunAuditEvent: vi.fn(() => new Promise<void>(() => {})) } as any, event, { timeoutMs: 7 });
      await vi.advanceTimersByTimeAsync(6);
      let settled = false;
      void pending.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it.each(["resolve", "reject"])("pre-observes a late %s after the default bound", async (outcome) => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      let settle!: () => void;
      let reject!: (error: Error) => void;
      const sinkPromise = new Promise<void>((resolve, rejectPromise) => { settle = resolve; reject = rejectPromise; });
      const pending = emitBoundedRunAudit({ recordRunAuditEvent: vi.fn(() => sinkPromise) } as any, event);
      await vi.advanceTimersByTimeAsync(EXECUTOR_RUN_AUDIT_EMIT_TIMEOUT_MS);
      await pending;
      if (outcome === "resolve") settle(); else reject(new Error("late"));
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      vi.useRealTimers();
    }
  });
});
