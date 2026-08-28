import { getScopedItem, setScopedItem } from "./projectStorage";

export const REQUIRE_PLAN_APPROVAL_PREFERENCE_KEY = "kb-task-create-require-plan-approval";

/*
FNXC:PlanApproval 2026-08-28-06:24:
The operator's create preference is sticky across both create surfaces. Submission never clears it;
only another explicit toggle click writes false.
*/
export function readRequirePlanApprovalPreference(projectId?: string): boolean {
  return getScopedItem(REQUIRE_PLAN_APPROVAL_PREFERENCE_KEY, projectId) === "true";
}

export function writeRequirePlanApprovalPreference(projectId: string | undefined, value: boolean): void {
  setScopedItem(REQUIRE_PLAN_APPROVAL_PREFERENCE_KEY, value ? "true" : "false", projectId);
}
