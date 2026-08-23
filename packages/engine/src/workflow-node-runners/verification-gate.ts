import type { Settings, TaskStore, WorkflowIrNode } from "@fusion/core";
import { runVerificationCommand, truncateWithEllipsis } from "../execution/verification-utils.js";
import { executorLog } from "../logger.js";

export type DeterministicVerificationGateDeps = {
  store: TaskStore;
  runCommand?: typeof runVerificationCommand;
};

export type DeterministicVerificationGateResult = {
  outcome: "success" | "failure";
  value: "passed" | "failed" | "no-verification-command-configured" | "verification-infrastructure-failure";
  contextPatch: Record<string, unknown>;
};

/**
 * FNXC:ReviewGatedVerification 2026-08-23-05:02:
 * Review-gated Verification is a measurement rather than an agent claim. Its result comes only
 * from configured command exit outcomes; absent commands are an explicit failed gate so a task
 * cannot acquire green merge evidence without running a real check.
 */
export async function runDeterministicVerificationGate(
  deps: DeterministicVerificationGateDeps,
  _node: WorkflowIrNode,
  task: { id: string },
  settings: Settings,
  worktreePath: string,
): Promise<DeterministicVerificationGateResult> {
  const commands = [
    { label: "testCommand", command: settings.testCommand?.trim(), type: "test" as const },
    { label: "buildCommand", command: settings.buildCommand?.trim(), type: "build" as const },
  ].filter((item): item is { label: string; command: string; type: "test" | "build" } => Boolean(item.command));

  if (commands.length === 0) {
    return {
      outcome: "failure",
      value: "no-verification-command-configured",
      contextPatch: { output: "no-verification-command-configured" },
    };
  }

  const runCommand = deps.runCommand ?? runVerificationCommand;
  for (const item of commands) {
    const result = await runCommand(
      deps.store,
      worktreePath,
      task.id,
      item.command,
      item.type,
      undefined,
      executorLog,
      "executor",
      undefined,
      settings.verificationCommandTimeoutMs,
    );
    if (!result.success) {
      const infrastructureReason = result.timedOut
        ? "timed-out"
        : result.aborted
          ? "aborted"
          : result.executionError
            ? "execution-error"
            : undefined;
      const output = truncateWithEllipsis([result.stdout, result.stderr].filter(Boolean).join("\n"), 20_000);
      return {
        outcome: "failure",
        value: infrastructureReason ? "verification-infrastructure-failure" : "failed",
        contextPatch: {
          output: `${item.label}: ${infrastructureReason ?? "non-zero-exit"}${output ? `\n${output}` : ""}`,
          verificationFailure: { commandLabel: item.label, ...(infrastructureReason ? { reason: infrastructureReason } : {}) },
        },
      };
    }
  }

  return { outcome: "success", value: "passed", contextPatch: { output: "Verification passed." } };
}
