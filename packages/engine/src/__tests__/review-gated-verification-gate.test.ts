import { describe, expect, it, vi } from "vitest";
import type { Settings, TaskStore, WorkflowIrNode } from "@fusion/core";
import { runDeterministicVerificationGate } from "../workflow-node-runners/verification-gate.js";

const node: WorkflowIrNode = { id: "verification-step", kind: "gate", column: "in-review", config: { workflowAction: "deterministic-verification" } };
const task = { id: "FN-175" };
const settings = (overrides: Partial<Settings> = {}) => ({ testCommand: "pnpm test", buildCommand: "pnpm build", ...overrides }) as Settings;

function result(overrides: Record<string, unknown> = {}) {
  return { command: "pnpm test", exitCode: 0, stdout: "", stderr: "", success: true, ...overrides };
}

describe("runDeterministicVerificationGate", () => {
  it("passes only after every configured command exits zero", async () => {
    const runCommand = vi.fn().mockResolvedValue(result());
    const gate = await runDeterministicVerificationGate(
      { store: {} as TaskStore, runCommand: runCommand as never }, node, task, settings(), "/worktree",
    );
    expect(gate).toMatchObject({ outcome: "success", value: "passed" });
    expect(runCommand).toHaveBeenCalledTimes(2);
  });

  it("fails on a non-zero result and preserves its command label", async () => {
    const runCommand = vi.fn().mockResolvedValue(result({ exitCode: 1, success: false, stderr: "failure tail" }));
    const gate = await runDeterministicVerificationGate(
      { store: {} as TaskStore, runCommand: runCommand as never }, node, task, settings(), "/worktree",
    );
    expect(gate).toMatchObject({ outcome: "failure", value: "failed" });
    expect(String(gate.contextPatch.output)).toContain("testCommand");
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("fails closed when no command is configured", async () => {
    const runCommand = vi.fn();
    const gate = await runDeterministicVerificationGate(
      { store: {} as TaskStore, runCommand: runCommand as never }, node, task, settings({ testCommand: undefined, buildCommand: undefined }), "/worktree",
    );
    expect(gate).toMatchObject({ outcome: "failure", value: "no-verification-command-configured" });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("preserves infrastructure failure classification instead of accepting claimed text", async () => {
    const runCommand = vi.fn().mockResolvedValue(result({ exitCode: null, success: false, timedOut: true, stdout: "verification passed" }));
    const gate = await runDeterministicVerificationGate(
      { store: {} as TaskStore, runCommand: runCommand as never }, node, task, settings({ buildCommand: undefined }), "/worktree",
    );
    expect(gate).toMatchObject({ outcome: "failure", value: "verification-infrastructure-failure" });
    expect(String(gate.contextPatch.output)).toContain("timed-out");
  });
});
