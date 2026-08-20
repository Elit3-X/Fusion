import type { RunAuditEventInput } from "../types.js";
import { createLogger } from "../process/logger.js";

export const CORE_RUN_AUDIT_EMIT_TIMEOUT_MS = 2_000;

export type RunAuditSinkHost = {
  recordRunAuditEvent?: (input: RunAuditEventInput) => unknown;
} | null | undefined;

export type RunAuditLogger = { warn: (message: string) => void };

type RunAuditEvent = RunAuditEventInput | { mutationType: string; [key: string]: unknown };

const defaultLog = createLogger("run-audit");

/**
 * FNXC:RunAudit 2026-08-20-05:49:
 * FN-9177 keeps this bounded optional-audit seam in core deliberately: core cannot import engine
 * without creating its documented dependency cycle. Best-effort telemetry must not block, reject,
 * or otherwise alter the lifecycle operation which emitted it; no retry, queue, or backoff belongs here.
 */
export async function emitBoundedRunAudit(
  host: RunAuditSinkHost,
  event: RunAuditEvent,
  options: { timeoutMs?: number; log?: RunAuditLogger } = {},
): Promise<void> {
  const log = options.log ?? defaultLog;
  const sink = host?.recordRunAuditEvent;
  if (typeof sink !== "function") return;

  let sinkPromise: Promise<unknown>;
  try {
    sinkPromise = Promise.resolve(sink.call(host, event as RunAuditEventInput));
  } catch {
    log.warn(`[run-audit] failed to record ${event.mutationType}`);
    return;
  }

  void sinkPromise.catch(() => undefined);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      log.warn(`[run-audit] timed out recording ${event.mutationType}`);
      resolve();
    }, options.timeoutMs ?? CORE_RUN_AUDIT_EMIT_TIMEOUT_MS);
    timer.unref?.();
    void sinkPromise.then(
      () => { clearTimeout(timer); resolve(); },
      () => { clearTimeout(timer); log.warn(`[run-audit] failed to record ${event.mutationType}`); resolve(); },
    );
  });
}
