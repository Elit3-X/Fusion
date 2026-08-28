import { beforeEach, describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";
import {
  readRequirePlanApprovalPreference,
  writeRequirePlanApprovalPreference,
} from "../../utils/planApprovalPreference";

describe("QuickEntryBox plan approval preference contract", () => {
  beforeEach(() => localStorage.clear());

  it("shares a project-scoped sticky preference", () => {
    expect(readRequirePlanApprovalPreference("project-1")).toBe(false);
    writeRequirePlanApprovalPreference("project-1", true);
    expect(readRequirePlanApprovalPreference("project-1")).toBe(true);
    expect(readRequirePlanApprovalPreference("project-2")).toBe(false);
    writeRequirePlanApprovalPreference("project-1", false);
    expect(readRequirePlanApprovalPreference("project-1")).toBe(false);
  });

  it("renders and submits the toggle without clearing it from resetForm", () => {
    const source = readAppFile("components/QuickEntryBox.tsx");
    expect(source).toContain('data-testid="quick-entry-plan-approval-toggle"');
    expect(source).toContain("...(requirePlanApproval ? { requirePlanApproval: true } : {})");
    const resetBody = source.slice(source.indexOf("const resetForm"), source.indexOf("const submitTask"));
    expect(resetBody).not.toContain("setRequirePlanApproval");
  });
});
