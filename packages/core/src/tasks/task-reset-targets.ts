import { join, resolve } from "node:path";
import { isWorkspaceTask, type Settings, type Task } from "../types.js";
import {
  assertWorkspaceRepoRelPath,
  isLegacyWorkspaceWorktreeLayout,
  resolveWorktreesDirLayout,
  resolveWorkspaceTaskWorktreeDir,
} from "./worktree-layout.js";

export const SINGULAR_RESET_WORKTREE_REPO_REL = "__singular_worktree__";

export interface TaskResetWorktreeTarget {
  repoRel: string;
  worktreePath: string;
  canonicalPath: string;
  branch?: string;
  repoRootDir: string;
  containmentRoot: string;
  reservationWorktreesDir: string;
  aliasRepoRels: string[];
}

export interface TaskResetWorktreePlan {
  kind: "singular" | "workspace";
  layout: "singular" | "workspace-task-dir" | "workspace-legacy";
  targets: TaskResetWorktreeTarget[];
  workspaceTaskDir?: string;
  ignoredSingularWorktree?: string;
}

export interface BuildTaskResetWorktreePlanOptions {
  rootDir: string;
  settings: Pick<Settings, "worktreesDir"> | undefined;
}

/*
FNXC:TaskReset 2026-08-27-22:02:
Reset derives its target directories and reservation roots from the same workspace layout
math as acquisition, so a per-repository reset reservation excludes a concurrent acquire.
A workspace task's singular pointer is ignored unless it aliases a recorded repository child:
the workspace root is a coordinator, not a disposable Git worktree.
*/
export function buildTaskResetWorktreePlan(
  task: Pick<Task, "id" | "worktree" | "branch" | "workspaceWorktrees">,
  { rootDir, settings }: BuildTaskResetWorktreePlanOptions,
): TaskResetWorktreePlan {
  if (!isWorkspaceTask(task)) {
    const worktreesDir = resolveWorktreesDirLayout(rootDir, settings);
    const targets = task.worktree ? [{
      repoRel: SINGULAR_RESET_WORKTREE_REPO_REL,
      worktreePath: task.worktree,
      canonicalPath: resolve(task.worktree),
      branch: task.branch,
      repoRootDir: rootDir,
      containmentRoot: worktreesDir,
      reservationWorktreesDir: worktreesDir,
      aliasRepoRels: [],
    }] : [];
    return { kind: "singular", layout: "singular", targets };
  }

  const workspaceTaskDir = resolveWorkspaceTaskWorktreeDir(rootDir, settings, task.id);
  const legacy = isLegacyWorkspaceWorktreeLayout(task, workspaceTaskDir);
  const targetsByCanonical = new Map<string, TaskResetWorktreeTarget>();
  for (const [repoRel, entry] of Object.entries(task.workspaceWorktrees ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    assertWorkspaceRepoRelPath(repoRel);
    const repoRootDir = join(rootDir, repoRel);
    const reservationWorktreesDir = resolveWorktreesDirLayout(repoRootDir, settings, {
      workspaceRootDir: rootDir,
      repoRelPath: repoRel,
    });
    const canonicalPath = resolve(entry.worktreePath);
    const existing = targetsByCanonical.get(canonicalPath);
    if (existing) {
      existing.aliasRepoRels.push(repoRel);
      continue;
    }
    targetsByCanonical.set(canonicalPath, {
      repoRel,
      worktreePath: entry.worktreePath,
      canonicalPath,
      branch: entry.branch,
      repoRootDir,
      containmentRoot: legacy ? reservationWorktreesDir : workspaceTaskDir,
      reservationWorktreesDir,
      aliasRepoRels: [],
    });
  }

  let ignoredSingularWorktree: string | undefined;
  if (task.worktree) {
    const existing = targetsByCanonical.get(resolve(task.worktree));
    if (existing) existing.aliasRepoRels.push(SINGULAR_RESET_WORKTREE_REPO_REL);
    else ignoredSingularWorktree = task.worktree;
  }
  return {
    kind: "workspace",
    layout: legacy ? "workspace-legacy" : "workspace-task-dir",
    targets: [...targetsByCanonical.values()],
    ...(legacy ? {} : { workspaceTaskDir }),
    ...(ignoredSingularWorktree ? { ignoredSingularWorktree } : {}),
  };
}
