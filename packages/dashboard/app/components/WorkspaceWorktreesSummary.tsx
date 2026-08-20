import { useTranslation } from "react-i18next";
import type { Task } from "@fusion/core";

/*
FNXC:Workspace 2026-08-15-07:05:
Task Detail lifts the former flat-list ceiling with durable landed/pending/failed repository
status. TaskCard remains count-only because its dense layout cannot safely grow a per-repo list;
legacy and empty rows stay pending because task error prose cannot attribute a repository failure.
*/

export function isWorkspaceTask(task: Pick<Task, "worktree" | "workspaceWorktrees">): boolean {
  if (task.worktree) return false;
  const entries = task.workspaceWorktrees;
  return Boolean(entries && Object.keys(entries).length > 0);
}

type WorkspaceEntry = NonNullable<Task["workspaceWorktrees"]>[string];
type WorkspaceStatus = "landed" | "pending" | "failed";

export function deriveWorkspaceRepoStatus(
  entry: WorkspaceEntry,
  repoRelPath: string,
  mergeDetails?: Task["mergeDetails"],
): { status: WorkspaceStatus; landedSha?: string; failureMessage?: string } {
  const landedSha = entry.landedSha ?? mergeDetails?.workspaceLandedShas?.[repoRelPath];
  if (landedSha) return { status: "landed", landedSha };
  if (entry.landFailure) return { status: "failed", failureMessage: entry.landFailure.message };
  return { status: "pending" };
}

interface WorkspaceWorktreesSummaryProps {
  task: Pick<Task, "worktree" | "workspaceWorktrees" | "mergeDetails" | "error">;
  compact?: boolean;
}

export function WorkspaceWorktreesSummary({ task, compact = false }: WorkspaceWorktreesSummaryProps) {
  const { t } = useTranslation("app");
  const entries = task.workspaceWorktrees;
  if (!isWorkspaceTask(task) || !entries) return null;

  const repos = Object.entries(entries);
  const statuses = repos.map(([repoRelPath, entry]) => ({ repoRelPath, entry, ...deriveWorkspaceRepoStatus(entry, repoRelPath, task.mergeDetails) }));
  const landedCount = statuses.filter(({ status }) => status === "landed").length;
  const hasStatusEvidence = statuses.some(({ status }) => status !== "pending");
  const fullyLanded = landedCount === repos.length;
  const placeholder = hasStatusEvidence
    ? t("tasks.workspaceReposLanded", "{{landed}} of {{count}} repos landed", { landed: landedCount, count: repos.length })
    : t("tasks.workspaceReposAcquired", "{{count}} repos acquired", { count: repos.length });

  if (compact) {
    return <div className="card-branch-row" aria-label={t("tasks.workspaceWorktrees", "Workspace repos")}><span className="card-branch-chip" data-testid="workspace-worktrees-placeholder" title={t("tasks.workspaceReposAcquired", "{{count}} repos acquired", { count: repos.length })}><span className="card-branch-label">{t("tasks.workspace", "Workspace")}</span><span className="card-branch-value">{t("tasks.workspaceReposAcquired", "{{count}} repos acquired", { count: repos.length })}</span></span></div>;
  }

  return <div className="workspace-worktrees-summary" data-testid="workspace-worktrees-summary" aria-label={t("tasks.workspaceWorktrees", "Workspace repos")}>
    <div className="workspace-worktrees-placeholder" data-testid="workspace-worktrees-placeholder">{placeholder}</div>
    {!fullyLanded && task.error && <div className="workspace-worktrees-failure" data-testid="workspace-partial-land-detail">{task.error}</div>}
    <ul className="workspace-worktrees-list">
      {statuses.map(({ repoRelPath, entry, status, landedSha, failureMessage }) => <li key={repoRelPath} className="workspace-worktrees-item workspace-worktrees-item--wrapping">
        <span className="workspace-worktrees-repo" title={repoRelPath}>{repoRelPath}</span>
        <span className={`workspace-worktrees-status workspace-worktrees-status--${status}`} data-testid={`workspace-repo-status-${status}`} aria-label={`${repoRelPath}: ${status}`}>{status}</span>
        {landedSha && <span className="workspace-worktrees-sha">{landedSha.slice(0, 8)}</span>}
        <span className="workspace-worktrees-path" title={entry.worktreePath}>{entry.worktreePath}</span>
        <span className="workspace-worktrees-branch" title={entry.branch}>{entry.branch}</span>
        {entry.baseBranch && <span className="workspace-worktrees-base" data-testid="workspace-repo-base-branch" title={t("tasks.workspaceRepoBaseBranch", "Base branch for {{repo}}", { repo: repoRelPath })}>{t("tasks.workspaceRepoBase", "Base: {{branch}}", { branch: entry.baseBranch })}</span>}
        {entry.baseBranchFallbackFrom && <span className="workspace-worktrees-base-fallback" data-testid="workspace-repo-base-fallback" title={t("tasks.workspaceRepoBaseFallbackTitle", "{{requested}} was unavailable in {{repo}}; using {{resolved}}", { requested: entry.baseBranchFallbackFrom, repo: repoRelPath, resolved: entry.baseBranch ?? entry.branch })}>{t("tasks.workspaceRepoBaseFallback", "Base fallback")}</span>}
        {failureMessage && <span className="workspace-worktrees-failure-message">{failureMessage}</span>}
      </li>)}
    </ul>
  </div>;
}
