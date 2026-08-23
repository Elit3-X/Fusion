import type { Task, WorkflowStepResult } from "../types.js";
import type { MergeContentDescriptor } from "./merge-content-descriptor.js";

export type PreMergeApprovalState = "approved" | "missing" | "not-approved" | "stale-content" | "unprovable-content";
export type PreMergeApproval = { workflowStepId: string; state: PreMergeApprovalState; repositories?: string[] };

export function evaluatePreMergeApprovals(
  task: Pick<Task, "workflowStepResults" | "repositoryScope">,
  options: { requiredPreMergeStepIds?: ReadonlySet<string>; mergeContent?: MergeContentDescriptor } = {},
): PreMergeApproval[] {
  const required = options.requiredPreMergeStepIds;
  if (!required?.size) return [];
  const results = task.workflowStepResults ?? [];
  return [...required].map((workflowStepId) => evaluateStep(workflowStepId, results, task, options.mergeContent));
}

function evaluateStep(
  workflowStepId: string,
  results: readonly WorkflowStepResult[],
  task: Pick<Task, "repositoryScope">,
  descriptor: MergeContentDescriptor | undefined,
): PreMergeApproval {
  const result = results.filter((candidate) => candidate.workflowStepId === workflowStepId).at(-1);
  // Workspace Code Review persists its positive proof in repositoryScope so it survives
  // the intentional workflow-result remediation wipe; singular tasks have no such carrier.
  if (!result && descriptor?.kind !== "workspace") return { workflowStepId, state: "missing" };
  if (result) {
    /*
    FNXC:PreMergeApproval 2026-08-23-08:51:
    FN-180 requires a positive current Code Review verdict, not a passed transport result. Code-review
    results may reach `passed` without a reviewer callback, so only APPROVE/APPROVE_WITH_NOTES opens a
    diff-bound gate; plan-domain rows retain their established status-only behavior because they bind
    plan text rather than source content. An absent verdict therefore exits as not-approved.
    */
    const requiresExplicitVerdict = workflowStepId === "code-review" || result.reviewKind === "code";
    const approvedVerdict = result.verdict === "APPROVE" || result.verdict === "APPROVE_WITH_NOTES";
    const approved = (result.status === "passed" && (requiresExplicitVerdict ? approvedVerdict : (result.verdict === undefined || approvedVerdict)))
      || (result.status === "skipped" && !!result.bypassedBy);
    if (!approved || !!result.remediationArchivedAt) return { workflowStepId, state: "not-approved" };
    // Plan fingerprints bind plan text rather than source diff and must never be cross-compared.
    if (result.reviewKind === "plan") return { workflowStepId, state: "approved" };
  }
  if (!descriptor) return { workflowStepId, state: "approved" };
  if (descriptor.kind === "singular") {
    if (descriptor.diff.state === "empty") return { workflowStepId, state: "approved" };
    if (descriptor.diff.state === "unavailable") return { workflowStepId, state: "unprovable-content" };
    return result?.reviewInputFingerprint === descriptor.diff.fingerprint
      ? { workflowStepId, state: "approved" }
      : { workflowStepId, state: result?.reviewInputFingerprint ? "stale-content" : "unprovable-content" };
  }
  if (task.repositoryScope?.state !== "confirmed" || descriptor.repositories.state === "unavailable") {
    return { workflowStepId, state: "unprovable-content" };
  }
  if (task.repositoryScope.reviewRemediation?.scopeRevision === task.repositoryScope.revision) {
    return { workflowStepId, state: "not-approved" };
  }
  if (result?.repositoryScopeRevision !== undefined && result.repositoryScopeRevision !== task.repositoryScope.revision) {
    return { workflowStepId, state: "stale-content" };
  }
  const missing: string[] = [];
  const stale: string[] = [];
  for (const repository of descriptor.repositories.inScopeModified) {
    const expected = descriptor.repositories.fingerprints[repository];
    const evidence = task.repositoryScope.reviewEvidence?.[repository];
    if (!evidence) missing.push(repository);
    else if (expected && evidence.fingerprint !== expected) stale.push(repository);
  }
  if (missing.length) return { workflowStepId, state: "missing", repositories: missing };
  if (stale.length) return { workflowStepId, state: "stale-content", repositories: stale };
  return { workflowStepId, state: "approved" };
}
