import { afterEach, describe, expect, it, vi } from "vitest";
import { CORE_RUN_AUDIT_EMIT_TIMEOUT_MS, emitBoundedRunAudit } from "../run-audit/emit-bounded-run-audit.js";

const event = { taskId: "FN-1", agentId: "system", runId: "run", domain: "database" as const, mutationType: "test:audit", target: "FN-1", metadata: {} };

afterEach(() => vi.useRealTimers());

describe("emitBoundedRunAudit", () => {
  it("calls sinks synchronously and resolves healthy, absent, throwing, and rejecting sinks", async () => {
    const log = { warn: vi.fn() };
    const sink = vi.fn(() => undefined);
    const promise = emitBoundedRunAudit({ recordRunAuditEvent: sink }, event, { log });
    expect(sink).toHaveBeenCalledWith(event);
    await expect(promise).resolves.toBeUndefined();
    await expect(emitBoundedRunAudit(undefined, event, { log })).resolves.toBeUndefined();
    await expect(emitBoundedRunAudit({ recordRunAuditEvent: () => { throw new Error("no"); } }, event, { log })).resolves.toBeUndefined();
    await expect(emitBoundedRunAudit({ recordRunAuditEvent: () => Promise.reject(new Error("no")) }, event, { log })).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith("[run-audit] failed to record test:audit");
  });

  it("bounds never-settling and late-settling sinks without unhandled rejections", async () => {
    vi.useFakeTimers();
    const log = { warn: vi.fn() };
    const never = emitBoundedRunAudit({ recordRunAuditEvent: () => new Promise(() => undefined) }, event, { log });
    await vi.advanceTimersByTimeAsync(CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
    await expect(never).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith("[run-audit] timed out recording test:audit");

    let reject!: (error: Error) => void;
    const late = emitBoundedRunAudit({ recordRunAuditEvent: () => new Promise<unknown>((_, fail) => { reject = fail; }) }, event, { timeoutMs: 1, log });
    await vi.advanceTimersByTimeAsync(1);
    reject(new Error("late"));
    await expect(late).resolves.toBeUndefined();
  });
});
