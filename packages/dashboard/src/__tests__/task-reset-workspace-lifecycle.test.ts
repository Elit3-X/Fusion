// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Task, TaskStore } from "@fusion/core";
import { registerTaskResetDisposer } from "@fusion/core";
import {
  ActiveSessionWorktreeRemovalError,
  activeSessionRegistry,
  getRegisteredWorktreeBranches,
  pruneWorktreeAdminEntries,
  removeTaskResetWorktree,
  ResetWorktreeForeignSessionError,
  registerPlanningLivenessProbe,
} from "@fusion/engine";
import { createApiRoutes } from "../routes.js";
import { request as performRequest } from "../test-request.js";

vi.mock("@fusion/engine", async () => {
  const actual = await vi.importActual<typeof import("@fusion/engine")>("@fusion/engine");
  return {
    ...actual,
    removeTaskResetWorktree: vi.fn(async (input: Parameters<typeof actual.removeTaskResetWorktree>[0]) => await actual.removeTaskResetWorktree({
      ...input,
      remove: async ({ worktreePath }) => {
        await rm(worktreePath, { recursive: true, force: true });
        return { removed: true, classification: "removed" };
      },
    })),
    pruneWorktreeAdminEntries: vi.fn().mockResolvedValue(undefined),
    getRegisteredWorktreeBranches: vi.fn().mockResolvedValue([]),
  };
});

const WORKFLOW_IR = {
  version: "v2",
  name: "Workspace reset test workflow",
  columns: [{ id: "triage", name: "Planning", traits: [{ trait: "intake" }] }],
  nodes: [{ id: "start", kind: "start", column: "triage" }],
  edges: [],
};

function workspaceTask(root: string, legacy = false): Task {
  const taskDir = join(root, ".fusion", "worktrees", "fn-401");
  const worktree = (repo: string) => legacy
    ? join(root, repo, ".worktrees", "fn-401")
    : join(taskDir, repo);
  return {
    id: "FN-401", title: "Workspace reset", description: "A workspace task", column: "in-progress", status: "failed",
    dependencies: [], steps: [{ name: "Implement", status: "done" }], currentStep: 0,
    workspaceWorktrees: {
      "apps/a": { worktreePath: worktree("apps/a"), branch: "fusion/fn-401" },
      "apps/b": { worktreePath: worktree("apps/b"), branch: "fusion/fn-401" },
    },
    log: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as unknown as Task;
}

async function createWorkspace(root: string, task: Task): Promise<void> {
  for (const entry of Object.values(task.workspaceWorktrees ?? {})) await mkdir(entry.worktreePath, { recursive: true });
  await mkdir(join(root, ".fusion", "tasks", task.id), { recursive: true });
  await writeFile(join(root, ".fusion", "tasks", task.id, "PROMPT.md"), "# Discarded plan\n");
}

function createApp(store: TaskStore) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRoutes(store));
  return app;
}

function createStore(root: string, initialTask: Task, otherTasks: Task[] = []) {
  let currentTask = initialTask;
  const publication = vi.fn(async (_id: string, intake: string) => ({
    ...currentTask,
    column: intake,
    status: "needs-replan",
    worktree: undefined,
    workspaceWorktrees: undefined,
    branch: undefined,
    steps: currentTask.steps.map((step) => ({ ...step, status: "pending" as const })),
  }));
  const store = {
    getRootDir: vi.fn().mockReturnValue(root),
    getSettings: vi.fn().mockResolvedValue({}),
    getTask: vi.fn(async () => currentTask),
    listTasks: vi.fn(async () => [currentTask, ...otherTasks]),
    withPlanningLifecycleLock: vi.fn(async (_id: string, callback: () => Promise<Task>) => await callback()),
    getTaskWorkflowSelectionAsync: vi.fn().mockResolvedValue({ workflowId: "wf-reset" }),
    getWorkflowDefinition: vi.fn().mockResolvedValue({ id: "wf-reset", name: "Reset", ir: WORKFLOW_IR }),
    resetTaskPublication: publication,
    logEntry: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(), off: vi.fn(), getProjectScopedPluginMcpServers: vi.fn().mockResolvedValue([]),
  } as unknown as TaskStore;
  return {
    store,
    publication,
    setTask: (task: Task) => { currentTask = task; },
  };
}

function registerWorkspaceBranches(root: string, task: Task) {
  vi.mocked(getRegisteredWorktreeBranches).mockImplementation(async (repoRoot) => {
    const repoRel = repoRoot.slice(root.length + 1);
    const entry = task.workspaceWorktrees?.[repoRel];
    return entry ? [{ branch: entry.branch, worktreePath: entry.worktreePath }] : [];
  });
}

async function reset(store: TaskStore) {
  return performRequest(createApp(store), "POST", "/api/tasks/FN-401/reset", JSON.stringify({ confirm: true }), { "content-type": "application/json" });
}

describe("POST /api/tasks/:id/reset workspace lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    activeSessionRegistry.unregisterPath("");
  });

  it("reproduces the former workspace refusal shape and publishes a clean reset", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const { store, publication } = createStore(root, task);

    const res = await reset(store);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("does not support workspace tasks");
    expect(publication).toHaveBeenCalledOnce();
    expect(publication).toHaveBeenCalledWith("FN-401", "triage");
    for (const entry of Object.values(task.workspaceWorktrees ?? {})) await expect(stat(entry.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(root, ".fusion", "tasks", task.id, "PROMPT.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes an empty new-layout task directory but retains a non-empty one", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-dir-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const { store } = createStore(root, task);
    const taskDir = join(root, ".fusion", "worktrees", "fn-401");
    expect((await reset(store)).status).toBe(200);
    expect(existsSync(taskDir)).toBe(false);

    const retainedRoot = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-retained-"));
    const retainedTask = workspaceTask(retainedRoot);
    await createWorkspace(retainedRoot, retainedTask);
    const retainedDir = join(retainedRoot, ".fusion", "worktrees", "fn-401");
    await writeFile(join(retainedDir, "operator-file"), "keep");
    registerWorkspaceBranches(retainedRoot, retainedTask);
    const retained = createStore(retainedRoot, retainedTask);
    expect((await reset(retained.store)).status).toBe(200);
    expect(existsSync(retainedDir)).toBe(true);
  });

  it("removes legacy worktrees using their repository roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-legacy-"));
    const task = workspaceTask(root, true);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const { store } = createStore(root, task);
    expect((await reset(store)).status).toBe(200);
    expect(vi.mocked(removeTaskResetWorktree).mock.calls.slice(-2).map(([input]) => input.rootDir)).toEqual([join(root, "apps/a"), join(root, "apps/b")]);
    expect(existsSync(join(root, ".fusion", "worktrees", "fn-401"))).toBe(false);
  });

  it("refuses a live first repository before touching the second repository or prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-live-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const first = task.workspaceWorktrees!["apps/a"]!.worktreePath;
    activeSessionRegistry.registerPath(first, { taskId: task.id, kind: "planning", ownerKey: `planning:${task.id}` });
    (activeSessionRegistry.lookupByPath(first) as { registeredAt: number }).registeredAt = 0;
    const unregisterProbe = registerPlanningLivenessProbe((id) => id === task.id);
    try {
      const { store, publication } = createStore(root, task);
      const res = await reset(store);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/apps\/a/);
      expect(publication).not.toHaveBeenCalled();
      expect(existsSync(task.workspaceWorktrees!["apps/b"]!.worktreePath)).toBe(true);
      await expect(readFile(join(root, ".fusion", "tasks", task.id, "PROMPT.md"), "utf8")).resolves.toContain("Discarded");
    } finally {
      unregisterProbe();
      activeSessionRegistry.unregisterPath(first);
    }
  });

  it("reports a foreign session holder with its repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-foreign-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    vi.mocked(removeTaskResetWorktree).mockRejectedValueOnce(new ResetWorktreeForeignSessionError({ worktreePath: task.workspaceWorktrees!["apps/a"]!.worktreePath, holderTaskId: "FN-OTHER", holderKind: "executor" }));
    const { store } = createStore(root, task);
    const res = await reset(store);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/active task FN-OTHER.*apps\/a/i);
  });

  it("refuses an unregistered repository before cancellation", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-unregistered-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    vi.mocked(getRegisteredWorktreeBranches).mockResolvedValueOnce([]);
    const { store, publication } = createStore(root, task);
    const res = await reset(store);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/managed task ownership cannot be proven/);
    expect(publication).not.toHaveBeenCalled();
    await expect(readFile(join(root, ".fusion", "tasks", task.id, "PROMPT.md"), "utf8")).resolves.toContain("Discarded");
  });

  it("refuses external and repository-root workspace targets before cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-unsafe-"));
    const external = workspaceTask(root);
    external.workspaceWorktrees!["apps/a"]!.worktreePath = join(root, "outside");
    await createWorkspace(root, external);
    registerWorkspaceBranches(root, external);
    let scenario = createStore(root, external);
    expect((await reset(scenario.store)).status).toBe(400);

    const rootTarget = workspaceTask(root);
    rootTarget.workspaceWorktrees!["apps/a"]!.worktreePath = join(root, "apps/a");
    await createWorkspace(root, rootTarget);
    registerWorkspaceBranches(root, rootTarget);
    scenario = createStore(root, rootTarget);
    expect((await reset(scenario.store)).status).toBe(400);
  });

  it("refuses a target claimed by another task's workspace entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-owner-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const owner = { ...task, id: "FN-OTHER", workspaceWorktrees: { "apps/a": task.workspaceWorktrees!["apps/a"] } };
    const { store } = createStore(root, task, [owner]);
    const res = await reset(store);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/owned by another task.*apps\/a/i);
  });

  it("refuses publication when the reset disposer changes workspace targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-fence-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    const state = createStore(root, task);
    const unregister = registerTaskResetDisposer(state.store, async () => state.setTask({ ...task, workspaceWorktrees: {} }));
    try {
      const res = await reset(state.store);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/target changed while cancellation was settling/);
      expect(state.publication).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it("refuses incomplete removal and reconciles an already-absent repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-incomplete-"));
    const task = workspaceTask(root);
    await createWorkspace(root, task);
    registerWorkspaceBranches(root, task);
    vi.mocked(removeTaskResetWorktree).mockResolvedValueOnce({ removed: false, classification: "already-absent" });
    const state = createStore(root, task);
    expect((await reset(state.store)).status).toBe(409);
    expect(state.publication).not.toHaveBeenCalled();

    vi.mocked(removeTaskResetWorktree).mockReset();
    vi.mocked(removeTaskResetWorktree).mockImplementation(async (input) => {
      await rm(input.worktreePath, { recursive: true, force: true });
      return { removed: true, classification: "removed" };
    });
    const absentRoot = await mkdtemp(join(tmpdir(), "fusion-workspace-reset-absent-"));
    const absent = workspaceTask(absentRoot);
    await createWorkspace(absentRoot, absent);
    await rm(absent.workspaceWorktrees!["apps/a"]!.worktreePath, { recursive: true });
    registerWorkspaceBranches(absentRoot, absent);
    const absentState = createStore(absentRoot, absent);
    expect((await reset(absentState.store)).status).toBe(200);
    expect(vi.mocked(pruneWorktreeAdminEntries)).toHaveBeenCalledWith(expect.objectContaining({ rootDir: join(absentRoot, "apps/a") }));
  });

  it("retains singular reset behavior with the project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "fusion-reset-singular-"));
    const worktreePath = join(root, ".worktrees", "fn-401");
    const task = {
      ...workspaceTask(root), worktree: worktreePath, branch: "fusion/fn-401", workspaceWorktrees: undefined,
    } as Task;
    await mkdir(worktreePath, { recursive: true });
    await mkdir(join(root, ".fusion", "tasks", task.id), { recursive: true });
    await writeFile(join(root, ".fusion", "tasks", task.id, "PROMPT.md"), "# Discarded plan\n");
    vi.mocked(getRegisteredWorktreeBranches).mockResolvedValue([{ branch: task.branch!, worktreePath }]);
    const { store } = createStore(root, task);
    expect((await reset(store)).status).toBe(200);
    expect(vi.mocked(removeTaskResetWorktree)).toHaveBeenCalledWith(expect.objectContaining({ rootDir: root }));
  });
});
