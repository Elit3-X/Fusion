import type { TaskStep } from "../types/task/task-log.js";

export interface RemediationPlacementPlan {
  steps: TaskStep[];
  insertionIndex: number;
  verificationResetIndex?: number;
}

/** Return the final step only when it is the task's trailing verification gate. */
export function resolveTrailingVerificationStepIndex(steps: readonly TaskStep[]): number | undefined {
  const index = steps.length - 1;
  if (index < 0) return undefined;
  const name = steps[index]!.name.replace(/^\s*Step\s+\d+\s*:\s*/i, "").trim();
  return /(?:testing|verification)/i.test(name) ? index : undefined;
}

/**
 * Insert remediation before trailing verification, preserving dependency meaning.
 * An absent dependency declaration stays absent; explicit independent roots stay
 * explicit empty arrays.
 */
export function planRemediationPlacement(
  existing: readonly TaskStep[],
  appended: readonly TaskStep[],
): RemediationPlacementPlan {
  const verificationIndex = resolveTrailingVerificationStepIndex(existing);
  const insertionIndex = verificationIndex ?? existing.length;
  const offset = appended.length;
  const surviving = existing.map((step, index) => {
    const remappedDependsOn = step.dependsOn?.map((dependency) => dependency >= insertionIndex ? dependency + offset : dependency);
    const reset = index === verificationIndex ? { status: "pending" as const } : {};
    return {
      ...step,
      ...reset,
      ...(remappedDependsOn === undefined ? {} : { dependsOn: remappedDependsOn }),
    };
  });
  return {
    steps: [...surviving.slice(0, insertionIndex), ...appended, ...surviving.slice(insertionIndex)],
    insertionIndex,
    ...(verificationIndex === undefined ? {} : { verificationResetIndex: verificationIndex + offset }),
  };
}
