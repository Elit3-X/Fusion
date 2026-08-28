import { describe, expect, it } from "vitest";

import type { TaskStep } from "../types/task/task-log.js";
import {
  planRemediationPlacement,
  resolveTrailingVerificationStepIndex,
} from "../tasks/remediation-step-placement.js";

const step = (name: string, status: TaskStep["status"] = "done", dependsOn?: number[]): TaskStep => ({
  name,
  status,
  ...(dependsOn === undefined ? {} : { dependsOn }),
});
const fix = step("Fix: handle missing workspace checkout", "pending");

describe("remediation step placement", () => {
  it("appends when no trailing verification step exists", () => {
    const plan = planRemediationPlacement([step("Implement")], [fix]);
    expect(plan).toMatchObject({ insertionIndex: 1 });
    expect(plan.verificationResetIndex).toBeUndefined();
    expect(plan.steps.map((entry) => entry.name)).toEqual(["Implement", fix.name]);
  });

  it("inserts before the final verification step, resets it, and remaps dependencies", () => {
    const existing = [
      step("Design", "done"),
      step("Implement", "done", [0]),
      step("Testing & Verification", "done", [0, 1]),
    ];
    const plan = planRemediationPlacement(existing, [fix]);
    expect(plan).toMatchObject({ insertionIndex: 2, verificationResetIndex: 3 });
    expect(plan.steps.map((entry) => entry.name)).toEqual(["Design", "Implement", fix.name, "Testing & Verification"]);
    expect(plan.steps[2]?.dependsOn).toBeUndefined();
    expect(plan.steps[3]).toMatchObject({ status: "pending", dependsOn: [0, 1] });
  });

  it("preserves absent and explicitly empty dependency declarations", () => {
    const plan = planRemediationPlacement([
      step("Implement"),
      step("Testing & Verification", "done", []),
    ], [fix]);
    expect(plan.steps[0]?.dependsOn).toBeUndefined();
    expect(plan.steps[2]?.dependsOn).toEqual([]);
  });

  it("recognizes only a final verification-like step", () => {
    expect(resolveTrailingVerificationStepIndex([step("Testing notes"), step("Implement")])).toBeUndefined();
    expect(resolveTrailingVerificationStepIndex([step("Step 4: Testing and Verification")])).toBe(0);
    expect(resolveTrailingVerificationStepIndex([])).toBeUndefined();
  });
});
