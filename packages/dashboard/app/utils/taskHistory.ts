import type { Task, WorkflowStepResult } from "@fusion/core";
import { workflowResultBodyParts } from "./workflowResultText";

export type TaskHistoryStageId = "plan" | "code" | "review" | "merge";
export type TaskHistoryLabel =
  | { kind: "text"; text: string }
  | { kind: "i18n"; key: string; defaultValue: string; params?: Record<string, string | number> };
export interface TaskHistoryMetaItem { label: TaskHistoryLabel; value: string }
export interface TaskHistoryEntry {
  id: string;
  stage: TaskHistoryStageId;
  title: TaskHistoryLabel;
  timestamp?: string;
  verdict?: string;
  status?: string;
  body?: string;
  meta?: TaskHistoryMetaItem[];
}
export interface TaskHistoryStage { id: TaskHistoryStageId; entries: TaskHistoryEntry[] }

/*
FNXC:TaskHistory 2026-08-28-02:23:
The browser alias exposes core types but not workflow constant modules, so these literals mirror the built-in node identities and the util test guards drift. This projection is total: every non-archived workflow result lands in one stage, while all application-authored labels are i18n descriptors. kind:text is reserved for persisted task data and report bodies remain untranslated.
*/
export const TASK_HISTORY_WORKFLOW_IDS = {
  planReviewGroup: "plan-review",
  planReviewStep: "plan-review-step",
  codeReviewGroup: "code-review",
  codeReviewStep: "code-review-step",
  browserVerificationGroup: "browser-verification",
  browserVerificationStep: "browser-verification-step",
  completionSummary: "completion-summary",
} as const;

const STAGE_ORDER: TaskHistoryStageId[] = ["plan", "code", "review", "merge"];

function i18n(key: string, defaultValue: string, params?: Record<string, string | number>): TaskHistoryLabel {
  return { kind: "i18n", key, defaultValue, ...(params ? { params } : {}) };
}

function resultBody(result: WorkflowStepResult): string | undefined {
  const parts = workflowResultBodyParts(result.output, result.notes);
  if (parts.length > 0) return parts.join("\n\n");
  if (!result.findings?.length) return undefined;
  return result.findings.map((finding) => `**${finding.title}**\n\n${finding.body}`).join("\n\n");
}

function isStrippedArchivedCarrier(result: WorkflowStepResult): boolean {
  return Boolean(
    result.remediationArchivedAt
    && !result.output?.trim()
    && !result.notes?.trim()
    && !result.verdict
    && !result.findings?.length,
  );
}

function classifyResult(result: WorkflowStepResult): TaskHistoryStageId {
  const id = result.workflowStepId.toLowerCase();
  const name = result.workflowStepName.toLowerCase();
  if (result.phase === "post-merge") return "merge";
  if (
    result.reviewKind === "plan"
    || id === TASK_HISTORY_WORKFLOW_IDS.planReviewGroup
    || id === TASK_HISTORY_WORKFLOW_IDS.planReviewStep
    || name.includes("plan review")
  ) return "plan";
  if (
    result.reviewKind === "code"
    || id === TASK_HISTORY_WORKFLOW_IDS.codeReviewGroup
    || id === TASK_HISTORY_WORKFLOW_IDS.codeReviewStep
    || id === TASK_HISTORY_WORKFLOW_IDS.browserVerificationGroup
    || id === TASK_HISTORY_WORKFLOW_IDS.browserVerificationStep
    || Boolean(result.verdict)
    || Boolean(result.findings?.length)
  ) return "review";
  return "code";
}

function timestampOf(result: WorkflowStepResult): string | undefined {
  return result.completedAt ?? result.startedAt;
}

function workflowEntry(result: WorkflowStepResult, sourceIndex: number, attemptIndex: number): TaskHistoryEntry {
  const stage = classifyResult(result);
  const timestamp = timestampOf(result);
  return {
    id: `workflow:${result.workflowStepId}:${timestamp ?? sourceIndex}:${attemptIndex}`,
    stage,
    title: { kind: "text", text: result.workflowStepName },
    timestamp,
    verdict: result.verdict,
    status: result.status,
    body: resultBody(result),
  };
}

function addMeta(meta: TaskHistoryMetaItem[], key: string, defaultValue: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  meta.push({ label: i18n(key, defaultValue), value: String(value) });
}

function compareEntries(left: TaskHistoryEntry, right: TaskHistoryEntry): number {
  if (left.timestamp && right.timestamp) {
    const byTimestamp = left.timestamp.localeCompare(right.timestamp);
    if (byTimestamp !== 0) return byTimestamp;
  } else if (left.timestamp) return -1;
  else if (right.timestamp) return 1;
  return left.id.localeCompare(right.id);
}

export function buildTaskHistory(task: Pick<Task, "stepReports" | "summary" | "mergeDetails">, results: WorkflowStepResult[]): TaskHistoryStage[] {
  const entries: TaskHistoryEntry[] = [];
  let hasCompletionSummaryResult = false;

  results.forEach((current, sourceIndex) => {
    if (current.workflowStepId === TASK_HISTORY_WORKFLOW_IDS.completionSummary) hasCompletionSummaryResult = true;
    const snapshots = [...(current.priorAttempts ?? [])].reverse();
    snapshots.forEach((attempt, attemptIndex) => entries.push(workflowEntry(attempt, sourceIndex, attemptIndex)));
    if (!isStrippedArchivedCarrier(current)) entries.push(workflowEntry(current, sourceIndex, snapshots.length));
  });

  for (const report of task.stepReports ?? []) {
    entries.push({
      id: `step-report:${report.id}`,
      stage: "code",
      title: i18n("taskHistory.entry.stepReport", "Step {{index}}: {{name}}", {
        index: report.stepIndex,
        name: report.stepName,
      }),
      timestamp: report.recordedAt,
      status: "passed",
      body: report.summary,
    });
  }

  if (task.summary?.trim() && !hasCompletionSummaryResult) {
    entries.push({
      id: "task:completion-summary",
      stage: "code",
      title: i18n("taskHistory.entry.completionSummary", "Completion summary"),
      body: task.summary,
    });
  }

  const merge = task.mergeDetails;
  if (merge && (merge.mergedAt || merge.commitSha)) {
    const meta: TaskHistoryMetaItem[] = [];
    addMeta(meta, "taskHistory.meta.commit", "Commit", merge.commitSha?.slice(0, 12));
    addMeta(meta, "taskHistory.meta.targetBranch", "Target branch", merge.mergeTargetBranch);
    addMeta(meta, "taskHistory.meta.strategy", "Strategy", merge.resolutionStrategy);
    addMeta(meta, "taskHistory.meta.method", "Method", merge.resolutionMethod);
    addMeta(meta, "taskHistory.meta.files", "Files", merge.filesChanged);
    addMeta(meta, "taskHistory.meta.insertions", "Insertions", merge.insertions);
    addMeta(meta, "taskHistory.meta.deletions", "Deletions", merge.deletions);
    addMeta(meta, "taskHistory.meta.pr", "Pull request", merge.prNumber);
    addMeta(meta, "taskHistory.meta.noOpReason", "No-op reason", merge.noOpReason);
    entries.push({
      id: `merge:${merge.commitSha ?? merge.mergedAt}`,
      stage: "merge",
      title: merge.noOpMerge
        ? i18n("taskHistory.entry.noOpMerge", "No-op merge")
        : i18n("taskHistory.entry.merged", "Merged"),
      timestamp: merge.mergedAt,
      status: merge.noOpMerge ? "skipped" : "passed",
      body: merge.mergeCommitMessage,
      meta,
    });
  }

  return STAGE_ORDER.map((id) => ({
    id,
    entries: entries.filter((entry) => entry.stage === id).sort(compareEntries),
  }));
}
