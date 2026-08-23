import type { WorkflowIr } from "../workflows/workflow-ir-types.js";
import {
  isWorkflowOptionalGroupEnabled,
  resolveWorkflowOptionalSteps,
} from "../workflows/workflow-optional-steps.js";

/*
FNXC:RequiredPreMergeSteps 2026-08-22-21:12:
An enabled optional group is a required merge gate even before it has produced a
result. Plan Review, Code Review, and Browser Verification omit `phase`, so they
resolve to pre-merge and must be included alongside groups that ran in earlier lanes.
Merge doors pass this resolved set while recovery scanners retain legacy result-only
semantics so they can discover and repair resultless cards.
*/
/** Resolves enabled optional-group ids that must have a terminal pre-merge result. */
export function resolveRequiredPreMergeStepIds(
  ir: WorkflowIr,
  enabledWorkflowSteps: readonly string[] | undefined,
): ReadonlySet<string> {
  return new Set(
    resolveWorkflowOptionalSteps(ir)
      .filter((step) => step.phase === "pre-merge")
      .filter((step) => isWorkflowOptionalGroupEnabled(enabledWorkflowSteps, step.templateId, step.defaultOn))
      .map((step) => step.templateId),
  );
}

/*
FNXC:RequiredPreMergeSteps 2026-08-22-22:40 (FN-9191 wedge):
Admission-side twin of the door's check. The in-review auto-merge sweep must be able to ask
"has every enabled pre-merge gate reported yet?" BEFORE it queues a card, because its sync
`canMergeTask` admission sees result rows only — and a gate that has not started has no row.
FN-9191 was queued ~2s after `fn_task_done` and ~18s before its own Code Review node started.
Shared with the door so the two can never answer differently.
*/
/** Enabled pre-merge group ids that have produced no result row on this task yet. */
export function findUnrunRequiredPreMergeStepIds(
  ir: WorkflowIr,
  task: {
    enabledWorkflowSteps?: readonly string[];
    workflowStepResults?: ReadonlyArray<{ workflowStepId?: string }>;
  },
): string[] {
  const results = task.workflowStepResults ?? [];
  return [...resolveRequiredPreMergeStepIds(ir, task.enabledWorkflowSteps)]
    .filter((workflowStepId) => !results.some((result) => result.workflowStepId === workflowStepId));
}
