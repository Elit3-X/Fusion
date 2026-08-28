import {
  hasOpenEquivalentRemediationStep,
  remediationDeclaredFiles,
  remediationWaveCount,
  planRemediationPlacement,
  type Task,
  type TaskStep,
  type TaskStore,
} from "@fusion/core";
import { deriveRemediationSteps } from "./derive-remediation-steps.js";
import type { RequestPreMergeOptionalStepFixInfo } from "./request-pre-merge-optional-step-fix.js";
import { deriveWorkspaceReviewRemediation } from "./workspace-review-remediation.js";
import { resolveReviewRemediationGate } from "./review-remediation-gate.js";
import { resolveRemediationCheckout } from "./resolve-remediation-checkout.js";

export type AppendReviewRemediationStepsDeps = {
  store: TaskStore;
  readTaskArtifact: (taskId: string, key: string) => Promise<string | undefined>;
  sendTaskBackForFix: (...args: any[]) => Promise<void>;
};

export type AppendReviewRemediationOutcome =
  | "appended"
  | "released-wave-exhausted"
  | "released-upstream-out-of-scope"
  | "released-no-actionable-findings"
  | "released-no-pending-work"
  | "released-workspace-worktree-missing"
  | "superseded-scope"
  | "not-applicable";

/**
 * FNXC:ReviewGatedRemediation 2026-08-23-05:14:
 * A review-gated rejection appends named provenance work before it can bounce. This deliberately
 * refuses a blind return to implementation: no candidate, out-of-scope evidence, duplicate-only
 * work, or the fourth wave is recorded and released as non-blocking rather than producing either
 * an empty executor dispatch or an engine-authored human hold.
 *
 * FNXC:ReviewGatedRemediation 2026-08-28-07:48:
 * Review remediation may ask for human action only when an operator authored that gate. Automatic
 * convergence failures leave task lifecycle state untouched and release the review as advice.
 */
/*
FNXC:VerificationRemediation 2026-08-26-06:31:
`worktreePath` lets a caller that already HOLDS the live checkout hand it in instead of falling back
to `task.worktree`. The executor's deterministic-verification gate is such a caller, and the fallback
is not safe for it: `performWorkflowRerunBounce` persists whatever path it receives back onto
`task.worktree`, so an empty fallback WIPES the pointer — the card renders "Unassigned" and
self-healing can no longer reclaim the worktree as idle. Graph-driven callers (the Code Review
remediation node) have no such path in hand and keep the task-record fallback.
*/
export async function appendReviewRemediationSteps(
  deps: AppendReviewRemediationStepsDeps,
  task: Task,
  info: RequestPreMergeOptionalStepFixInfo,
  options: { worktreePath?: string } = {},
): Promise<AppendReviewRemediationOutcome> {
  const gate = resolveReviewRemediationGate(info);
  if (!gate) return "not-applicable";
  const wave = remediationWaveCount(task.steps ?? []) + 1;
  if (wave > 3) {
    return release(deps.store, task.id, "review-remediation-wave-exhausted", "released-wave-exhausted");
  }
  const prompt = await deps.readTaskArtifact(task.id, "PROMPT.md");
  const derived = deriveRemediationSteps({
    gate,
    gateStepId: info.nodeId!,
    wave,
    findings: info.findings,
    verificationOutput: info.feedback,
    verificationCommandLabel: gate === "Verification" ? info.stepName : undefined,
    prompt,
    changedFiles: task.modifiedFiles,
    confirmedRepositories: task.repositoryScope?.state === "confirmed"
      ? task.repositoryScope.repositories
      : undefined,
  });
  if (derived.reason === "upstream-out-of-scope") {
    return release(
      deps.store,
      task.id,
      `review-remediation-upstream-out-of-scope:${derived.outOfScope.map((item) => item.filePath).filter(Boolean).join(",")}`,
      "released-upstream-out-of-scope",
    );
  }
  if (derived.steps.length === 0) {
    return release(
      deps.store,
      task.id,
      "review-remediation-no-actionable-findings",
      "released-no-actionable-findings",
    );
  }
  /*
  FNXC:WorkspaceReviewRemediation 2026-08-27-12:26:
  A named-remediation workflow reaches this appender only under the `none` reopen policy, which
  bypasses requestPreMergeOptionalStepFix's workspace-routing branch. Claim the scope generation
  before changing steps or PROMPT.md so a superseded Code Review cannot leave stale work behind.
  */
  const reviewResult = (task.workflowStepResults ?? []).find((result) =>
    (result.workflowStepId === info.nodeId || result.workflowStepName === info.stepName)
    && result.verdict === "REVISE",
  );
  const remediation = task.workspaceWorktrees && reviewResult
    ? deriveWorkspaceReviewRemediation(reviewResult)
    : undefined;
  if (remediation) {
    const updateWorkspaceReviewState = (deps.store as TaskStore & {
      updateWorkspaceReviewState?: TaskStore["updateWorkspaceReviewState"];
    }).updateWorkspaceReviewState;
    if (updateWorkspaceReviewState) {
      const persisted = await updateWorkspaceReviewState.call(deps.store, task.id, remediation.scopeRevision, remediation);
      if (!persisted.updated) {
        await deps.store.logEntry(task.id, "Workspace review remediation superseded by repository scope change");
        return "superseded-scope";
      }
    }
  }

  let appended: TaskStep[];
  let live: Task;
  if (remediation) {
    let scopeSuperseded = false;
    appended = [];
    live = await deps.store.updateTaskAtomic(task.id, (current) => {
      /*
      FNXC:WorkspaceReviewRemediation 2026-08-27-12:32:
      A successful review-remediation CAS only claims the target at that instant. Append its named
      work and widen PROMPT.md in the same revision-fenced mutation, so an intervening scope edit
      cannot leave an invalid review episode's steps or File Scope behind.
      */
      if (current.repositoryScope?.revision !== remediation.scopeRevision) {
        scopeSuperseded = true;
        return null;
      }
      const existing = current.steps ?? [];
      appended = derived.steps
        .filter((candidate) => candidate.remediation !== undefined)
        .filter((candidate) => !hasOpenEquivalentRemediationStep([...existing, ...appended], candidate))
        .map((candidate) => ({
          ...candidate,
          status: "pending" as const,
          remediation: { ...candidate.remediation!, wave: candidate.remediation?.wave ?? wave },
          ...(candidate.dependsOn ? { dependsOn: [...candidate.dependsOn] } : {}),
        }));
      if (appended.length === 0) return null;
      const placement = planRemediationPlacement(existing, appended);
      const nextPrompt = widenPromptFileScopeContent(current.prompt ?? prompt, remediationDeclaredFiles(appended));
      return {
        steps: placement.steps,
        currentStep: placement.insertionIndex,
        ...(nextPrompt !== current.prompt ? { prompt: nextPrompt } : {}),
      };
    });
    if (scopeSuperseded) {
      await deps.store.logEntry(task.id, "Workspace review remediation superseded by repository scope change");
      return "superseded-scope";
    }
  } else {
    const appendResult = await deps.store.appendRemediationSteps(task.id, derived.steps, { wave });
    appended = appendResult.appended;
    live = await deps.store.getTask(task.id);
    await widenPromptFileScope(deps.store, task.id, prompt, remediationDeclaredFiles(appended));
  }
  if (appended.length === 0 || !live.steps.some((step) => step.status === "pending")) {
    return release(
      deps.store,
      task.id,
      "review-remediation-no-pending-work",
      "released-no-pending-work",
    );
  }
  if (remediation) {
    const workspaceWorktreePath = live.workspaceWorktrees?.[remediation.repository]?.worktreePath;
    if (!workspaceWorktreePath) {
      return release(
        deps.store,
        task.id,
        "review-remediation-workspace-worktree-missing",
        "released-workspace-worktree-missing",
      );
    }
    await deps.sendTaskBackForFix(
      live,
      workspaceWorktreePath,
      info.feedback,
      info.stepName,
      `Review gate ${gate} requested named remediation`,
      true,
      false,
      undefined,
      info.findings,
      false,
      "none",
    );
    return "appended";
  }
  const providedPath = options.worktreePath?.trim();
  const checkout = providedPath
    ? { path: providedPath, persist: undefined }
    : resolveRemediationCheckout(live, reviewResult);
  if (!checkout) {
    return release(
      deps.store,
      task.id,
      "review-remediation-workspace-worktree-missing",
      "released-workspace-worktree-missing",
    );
  }
  await deps.sendTaskBackForFix(
    live,
    checkout.path,
    info.feedback,
    info.stepName,
    `Review gate ${gate} requested named remediation`,
    true,
    false,
    undefined,
    info.findings,
    checkout.persist,
    "none",
  );
  return "appended";
}

async function release<T extends AppendReviewRemediationOutcome>(
  store: TaskStore,
  taskId: string,
  reason: string,
  outcome: T,
): Promise<T> {
  await store.logEntry(taskId, "Review remediation released as non-blocking", reason);
  return outcome;
}

/**
 * FNXC:ReviewGatedRemediation 2026-08-23-05:23:
 * A remediation accepted from the branch diff may be outside the original prompt scope. Persist its
 * declared files before the bounce so the executor and scope-aware squash merge see the same contract.
 */
async function widenPromptFileScope(store: TaskStore, taskId: string, prompt: string | undefined, files: readonly string[]): Promise<void> {
  const updated = widenPromptFileScopeContent(prompt, files);
  if (updated !== prompt) await store.updateTask(taskId, { prompt: updated });
}

function widenPromptFileScopeContent(prompt: string | undefined, files: readonly string[]): string | undefined {
  const additions = [...new Set(files.map((file) => file.trim()).filter(Boolean))];
  if (additions.length === 0 || !prompt) return prompt;
  const heading = /^##\s+File Scope\s*$/m.exec(prompt);
  if (!heading || heading.index === undefined) return prompt;
  const sectionStart = heading.index + heading[0].length;
  const rest = prompt.slice(sectionStart);
  const nextHeading = rest.search(/^##\s/m);
  const sectionEnd = nextHeading === -1 ? prompt.length : sectionStart + nextHeading;
  const section = prompt.slice(sectionStart, sectionEnd);
  const existing = new Set((section.match(/`([^`]+)`/g) ?? []).map((entry) => entry.slice(1, -1)));
  const missing = additions.filter((file) => !existing.has(file));
  if (missing.length === 0) return prompt;
  const trimmed = section.replace(/\s+$/, "");
  const insertion = missing.map((file) => `- \`${file}\``).join("\n");
  const replacement = trimmed.length === 0 ? `\n\n${insertion}\n` : `${trimmed}\n${insertion}\n`;
  return prompt.slice(0, sectionStart) + replacement + prompt.slice(sectionEnd);
}
