import { describe, expect, it, vi } from "vitest";
import type { Task, TaskStep } from "@fusion/core";
import { deriveRemediationSteps } from "../executor/derive-remediation-steps.js";
import { appendReviewRemediationSteps } from "../executor/append-review-remediation-steps.js";

describe("deriveRemediationSteps", () => {
  const base = { gateStepId: "code-review", wave: 1, prompt: "## File Scope\n- `src/**`", changedFiles: [] } as const;

  it("turns each blocking code-review finding into provenance-backed work", () => {
    const result = deriveRemediationSteps({
      ...base,
      gate: "Code Review",
      findings: [{ id: "finding-1", title: "wrong guard", body: "Reverse the guard", filePath: "src/guard.ts", line: 8, severity: "critical" }],
    });
    expect(result.steps).toEqual([expect.objectContaining({
      name: "Fix: Reverse the guard",
      status: "pending",
      remediation: expect.objectContaining({ gate: "Code Review", findingId: "finding-1", filePath: "src/guard.ts", line: 8 }),
    })]);
    expect(result.steps[0].name).not.toMatch(/test|verif|qa|review/i);
  });

  it("does not create work for non-blocking or out-of-scope findings", () => {
    const nonBlocking = deriveRemediationSteps({
      ...base, gate: "Code Review",
      findings: [{ id: "note", title: "note", body: "note", filePath: "src/a.ts", severity: "medium" }],
    });
    expect(nonBlocking.steps).toEqual([]);

    const upstream = deriveRemediationSteps({
      ...base, gate: "Code Review",
      findings: [{ id: "upstream", title: "upstream", body: "outside", filePath: "other/a.ts", severity: "critical" }],
    });
    expect(upstream).toMatchObject({ steps: [], reason: "upstream-out-of-scope" });
    expect(upstream.outOfScope).toEqual([{ filePath: "other/a.ts", detail: "outside" }]);
  });

  it("derives distinct verification files and a fallback when output has none", () => {
    const files = deriveRemediationSteps({ ...base, gate: "Verification", gateStepId: "verification", verificationCommandLabel: "testCommand", verificationOutput: "src/a.ts:3 failed\nsrc/b.ts:6 failed" });
    expect(files.steps.map((step) => step.remediation?.filePath)).toEqual(["src/a.ts", "src/b.ts"]);
    const fallback = deriveRemediationSteps({ ...base, gate: "Verification", gateStepId: "verification", verificationCommandLabel: "buildCommand", verificationOutput: "failed" });
    expect(fallback.steps).toHaveLength(1);
    expect(fallback.steps[0].name).toBe("Fix: Fix failing buildCommand");
  });
});

describe("non-blocking review remediation releases", () => {
  function subject(overrides: Partial<Task> = {}): Task {
    return {
      id: "FN-217-release",
      column: "in-review",
      status: null,
      paused: false,
      prompt: "## File Scope\n- `src/**`\n",
      modifiedFiles: [],
      steps: [],
      ...overrides,
    } as Task;
  }

  function storeFor(task: Task, append: readonly TaskStep[] = []) {
    const logEntry = vi.fn(async () => undefined);
    return {
      logEntry,
      updateTask: vi.fn(async (_id: string, patch: Partial<Task>) => Object.assign(task, patch)),
      getTask: vi.fn(async () => task),
      appendRemediationSteps: vi.fn(async () => ({ task, appended: [...append], appendedCount: append.length, wave: 1 })),
      updateTaskAtomic: vi.fn(async (_id: string, callback: (current: Task) => Partial<Task> | null) => {
        const patch = callback(task);
        if (patch) Object.assign(task, patch);
        return task;
      }),
    };
  }

  async function append(task: Task, store: ReturnType<typeof storeFor>, findings: any[] = []) {
    const outcome = await appendReviewRemediationSteps(
      { store: store as never, readTaskArtifact: async () => task.prompt, sendTaskBackForFix: vi.fn(async () => undefined) },
      task,
      { stepName: "Code Review", feedback: "advisory", phase: "pre-merge", status: "failed", verdict: "REVISE", nodeId: "code-review", findings },
    );
    expect(task).toMatchObject({ status: null, paused: false });
    expect(task).not.toHaveProperty("awaitingApprovalReason");
    return outcome;
  }

  it("releases an exhausted remediation wave without lifecycle mutation", async () => {
    const task = subject({ steps: [{ name: "prior", status: "done", remediation: { wave: 3, gate: "Code Review", gateStepId: "code-review", detail: "prior" } }] });
    const store = storeFor(task);
    await expect(append(task, store)).resolves.toBe("released-wave-exhausted");
    expect(store.logEntry).toHaveBeenCalledWith(task.id, "Review remediation released as non-blocking", "review-remediation-wave-exhausted");
  });

  it("releases an out-of-scope finding without lifecycle mutation", async () => {
    const task = subject();
    const store = storeFor(task);
    await expect(append(task, store, [{ id: "outside", title: "outside", body: "fix outside", filePath: "other/a.ts", severity: "critical" }]))
      .resolves.toBe("released-upstream-out-of-scope");
    expect(store.logEntry.mock.calls.at(-1)?.[2]).toContain("review-remediation-upstream-out-of-scope");
  });

  it("releases a finding-less review without lifecycle mutation", async () => {
    const task = subject();
    const store = storeFor(task);
    await expect(append(task, store)).resolves.toBe("released-no-actionable-findings");
    expect(store.logEntry).toHaveBeenCalledWith(task.id, "Review remediation released as non-blocking", "review-remediation-no-actionable-findings");
  });

  it("releases duplicate-only remediation with no pending work", async () => {
    const task = subject({
      steps: [{
        name: "Fix: fix guard",
        status: "done",
        remediation: { wave: 1, gate: "Code Review", gateStepId: "code-review", findingId: "same", filePath: "src/a.ts", detail: "fix guard" },
      }],
    });
    const store = storeFor(task, []);
    await expect(append(task, store, [{ id: "same", title: "guard", body: "fix guard", filePath: "src/a.ts", severity: "critical" }]))
      .resolves.toBe("released-no-pending-work");
    expect(store.logEntry).toHaveBeenCalledWith(task.id, "Review remediation released as non-blocking", "review-remediation-no-pending-work");
  });

  it("releases a workspace remediation whose checkout is missing", async () => {
    const task = subject({
      repositoryScope: { state: "confirmed", revision: 1, repositories: ["Merge"] } as never,
      workspaceWorktrees: { Merge: {} } as never,
      workflowStepResults: [{
        workflowStepId: "code-review",
        workflowStepName: "Code Review",
        phase: "pre-merge",
        status: "failed",
        verdict: "REVISE",
        repositoryScopeRevision: 1,
        repositoryReviewOutcomes: [{
          repository: "Merge",
          status: "REVIEWED",
          verdict: "REVISE",
          fingerprint: "tree-1",
          findings: [{ id: "workspace", title: "guard", body: "fix guard", filePath: "src/a.ts", severity: "critical" }],
        }],
      }] as never,
    });
    const store = storeFor(task);
    await expect(append(task, store, [{ id: "workspace", title: "guard", body: "fix guard", filePath: "src/a.ts", severity: "critical" }]))
      .resolves.toBe("released-workspace-worktree-missing");
    expect(store.logEntry).toHaveBeenCalledWith(task.id, "Review remediation released as non-blocking", "review-remediation-workspace-worktree-missing");
  });
});
