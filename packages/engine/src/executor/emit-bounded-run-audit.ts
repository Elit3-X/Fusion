import type { RunAuditEventInput, TaskStore } from "@fusion/core";
import { executorLog } from "../logger.js";

export const EXECUTOR_RUN_AUDIT_EMIT_TIMEOUT_MS = 2_000;

/**
 * FNXC:RunAudit 2026-08-20-03:02:
 * FN-9172 requires executor audit writes to remain best-effort telemetry rather than lifecycle
 * dependencies. Every sink state is swallow-log-and-bound: no retry, backoff, or queueing may
 * abort, stall, delay, or alter the owning executor branch.
 */
export async function emitBoundedRunAudit(
  store: TaskStore | null | undefined,
  event: RunAuditEventInput,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const sink = store?.recordRunAuditEvent;
  if (typeof sink !== "function") return;

  let sinkPromise: Promise<unknown>;
  try {
    sinkPromise = Promise.resolve(sink.call(store, event));
  } catch {
    executorLog.warn(`[run-audit] failed to record ${event.mutationType}`);
    return;
  }

  // Observe late rejection before the bounded wait returns so it cannot become unhandled.
  void sinkPromise.catch(() => undefined);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      executorLog.warn(`[run-audit] timed out recording ${event.mutationType}`);
      resolve();
    }, options.timeoutMs ?? EXECUTOR_RUN_AUDIT_EMIT_TIMEOUT_MS);
    timer.unref?.();
    void sinkPromise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        executorLog.warn(`[run-audit] failed to record ${event.mutationType}`);
        resolve();
      },
    );
  });
}
