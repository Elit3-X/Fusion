import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPreservedPlanRespecifyPatch,
  computePlanApprovalFingerprint,
  isPlanReviewSatisfied,
  type Settings,
  type Task,
  type TaskDetail,
  type TaskStore,
} from "@fusion/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planLog } from "../logger.js";
import { buildSpecificationPrompt, TriageProcessor } from "../triage.js";

const PLAN = [
  "# Task: FN-212 - Approval test",
  "",
  "## Mission",
  "",
  "Implement the approved scope.",
  "",
  "## Steps",
  "",
  "### Step 0: Implement",
  "- [ ] Do the work",
  "",
].join("\n");

function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-212",
    title: "Approval test",
    description: "Wait for approval",
    column: "triage",
    status: "planning",
    dependencies: [],
    steps: [],
    currentStep: 0,
    log: [],
    createdAt: "2026-08-28T06:24:00.000Z",
    updatedAt: "2026-08-28T06:24:00.000Z",
    ...overrides,
  } as Task;
}

function storeFixture(task: Task, settings: Partial<Settings> = {}): TaskStore {
  const store: Record<string, unknown> = {
    listTasks: vi.fn().mockResolvedValue([]),
    getTask: vi.fn(async (id: string) => id === task.id ? task : undefined),
    getSettings: vi.fn().mockResolvedValue({
      planApprovalMode: "auto-approve-all",
      requirePlanApproval: false,
      ...settings,
    } as Settings),
    parseDependenciesFromPrompt: vi.fn().mockResolvedValue([]),
    parseStepsFromPrompt: vi.fn().mockResolvedValue([]),
    parseFileScopeFromPrompt: vi.fn().mockResolvedValue([]),
    updateTask: vi.fn(async (_id: string, patch: Partial<Task>) => {
      for (const [key, value] of Object.entries(patch)) {
        (task as unknown as Record<string, unknown>)[key] = value === null ? undefined : value;
      }
      return task;
    }),
    updateTaskAtomic: vi.fn(async (_id: string, patch: Partial<Task> | ((live: Task) => Partial<Task> | null)) => {
      const next = typeof patch === "function" ? patch(task) : patch;
      if (next) {
        for (const [key, value] of Object.entries(next)) {
          (task as unknown as Record<string, unknown>)[key] = value === null ? undefined : value;
        }
      }
      return task;
    }),
    moveTask: vi.fn(),
    moveTaskIf: vi.fn(async (_id: string, column: string, predicate: (live: Task) => boolean) => {
      if (!predicate(task)) return { moved: false, task };
      task.column = column;
      task.status = undefined;
      return { moved: true, task };
    }),
    withTaskLock: vi.fn(async (_id: string, fn: () => Promise<unknown>) => fn()),
    readTaskForMove: vi.fn(async (id: string) => id === task.id ? task : undefined),
    logEntry: vi.fn(async (_id: string, action: string, outcome?: string) => {
      task.log.push({ timestamp: new Date().toISOString(), action, outcome });
    }),
    recordActivity: vi.fn().mockResolvedValue(undefined),
    getTaskWorkflowSelection: vi.fn().mockReturnValue({ workflowId: "builtin:coding", stepIds: [] }),
    on: vi.fn(),
    off: vi.fn(),
  };
  return store as unknown as TaskStore;
}

describe("triage per-task plan approval", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "fusion-fn-212-plan-approval-"));
    await mkdir(join(rootDir, ".fusion", "tasks", "FN-212"), { recursive: true });
    await writeFile(join(rootDir, ".fusion", "tasks", "FN-212", "PROMPT.md"), PLAN);
    vi.spyOn(planLog, "log").mockImplementation(() => {});
    vi.spyOn(planLog, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("parks recovery at awaiting-approval when the task opts in", async () => {
    const task = taskFixture({ requirePlanApproval: true });
    const store = storeFixture(task);

    await expect(new TriageProcessor(store, rootDir).recoverApprovedTask(task)).resolves.toBe(true);

    expect(task.status).toBe("awaiting-approval");
    expect(store.moveTaskIf).not.toHaveBeenCalled();
    expect(store.logEntry).toHaveBeenCalledWith(task.id, expect.stringContaining("awaiting manual approval"));
  });

  it("parks finalize under project auto-approve-all when the task opts in", async () => {
    const task = taskFixture({ requirePlanApproval: true });
    const store = storeFixture(task);

    await (new TriageProcessor(store, rootDir) as unknown as {
      finalizeApprovedTask(task: Task, prompt: string, settings: Settings): Promise<unknown>;
    }).finalizeApprovedTask(task, PLAN, {
      planApprovalMode: "auto-approve-all",
      requirePlanApproval: false,
    } as Settings);

    expect(task.status).toBe("awaiting-approval");
    expect(store.moveTaskIf).not.toHaveBeenCalled();
  });

  it("releases an operator-approved unchanged plan exactly once", async () => {
    const task = taskFixture({
      requirePlanApproval: true,
      approvedPlanFingerprint: computePlanApprovalFingerprint(PLAN),
    });
    const store = storeFixture(task);
    const processor = new TriageProcessor(store, rootDir);

    await expect(processor.recoverApprovedTask(task)).resolves.toBe(true);
    await expect(processor.recoverApprovedTask(task)).resolves.toBe(false);

    expect(task.column).toBe("todo");
    expect(store.moveTaskIf).toHaveBeenCalledTimes(1);
  });

  it("preserves auto-approve behavior when the task override is unset", async () => {
    const task = taskFixture();
    const store = storeFixture(task);

    await expect(new TriageProcessor(store, rootDir).recoverApprovedTask(task)).resolves.toBe(true);

    expect(task.column).toBe("todo");
    expect(task.status).toBeUndefined();
    expect(store.moveTaskIf).toHaveBeenCalledTimes(1);
  });

  it("invalidates an approved unchanged plan before finalization can reuse it", async () => {
    const task = taskFixture({
      requirePlanApproval: true,
      approvedPlanFingerprint: computePlanApprovalFingerprint(PLAN),
      workflowStepResults: [{ workflowStepId: "plan-review", workflowStepName: "Plan Review", status: "passed" }],
    });
    const store = storeFixture(task);
    await store.updateTask(task.id, buildPreservedPlanRespecifyPatch(task, "2026-08-28T06:30:00.000Z"));

    expect(task.approvedPlanFingerprint).toBeUndefined();
    expect(isPlanReviewSatisfied(task.workflowStepResults![0]!)).toBe(false);
    expect(task.workflowStepResults![0]).toMatchObject({
      supersededAt: "2026-08-28T06:30:00.000Z",
      supersededReason: "respecify",
    });
    // Triage has claimed the required replan pass; the approval carriers remain invalidated.
    task.status = "planning";

    await (new TriageProcessor(store, rootDir) as unknown as {
      finalizeApprovedTask(task: Task, prompt: string, settings: Settings): Promise<unknown>;
    }).finalizeApprovedTask(task, PLAN, {
      planApprovalMode: "auto-approve-all",
      requirePlanApproval: false,
    } as Settings);

    expect(task.status).toBe("awaiting-approval");
    expect(store.logEntry).not.toHaveBeenCalledWith(
      task.id,
      "Plan unchanged since prior approval — proceeding without re-approval",
    );
  });

  it("uses a preserved plan and operator note as surgical revision source", () => {
    const detail = taskFixture({
      status: "needs-replan",
      log: [{
        timestamp: "2026-08-28T06:30:00.000Z",
        action: "AI spec revision requested",
        outcome: "Keep the architecture but split the validation step.",
      }],
    }) as TaskDetail;
    const prompt = buildSpecificationPrompt(
      detail,
      "/project/.fusion/tasks/FN-212/PROMPT.md",
      {},
      [],
      PLAN,
      "Keep the architecture but split the validation step.",
    );

    expect(prompt).toContain("## Revision Instructions");
    expect(prompt).toContain("## Existing Specification");
    expect(prompt).toContain("## Revision Feedback");
    expect(prompt).toContain("Keep the architecture but split the validation step.");
    expect(prompt).not.toContain("Re-specification Instructions");
  });

  it("never auto-finalizes a preserved needs-replan task", async () => {
    const task = taskFixture({ status: "needs-replan", requirePlanApproval: true });
    const store = storeFixture(task);

    await expect(new TriageProcessor(store, rootDir).recoverApprovedTask(task)).resolves.toBe(false);
    expect(store.moveTaskIf).not.toHaveBeenCalled();
    expect(task.status).toBe("needs-replan");
  });

  it("keeps mission symbol-lock lineage approval derived only from require-all project policy", async () => {
    const [scheduler, workflowScheduler] = await Promise.all([
      readFile(join(process.cwd(), "src", "scheduler.ts"), "utf8"),
      readFile(join(process.cwd(), "src", "workflows", "workflow-work-scheduler.ts"), "utf8"),
    ]);
    for (const source of [scheduler, workflowScheduler]) {
      expect(source).toMatch(/planApprovalRequired:\s*[^\n]*planApprovalMode\s*===\s*"require-all"/);
      expect(source).not.toMatch(/planApprovalRequired:\s*[^\n]*requirePlanApproval/);
    }
  });
});
