import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";

describe("NewTaskModal plan approval toggle contract", () => {
  it("threads the shared sticky preference into TaskForm and the create payload", () => {
    const source = readAppFile("components/NewTaskModal.tsx");
    expect(source).toContain("readRequirePlanApprovalPreference(projectId)");
    expect(source).toContain("writeRequirePlanApprovalPreference(projectId, value)");
    expect(source).toContain("...(requirePlanApproval ? { requirePlanApproval: true } : {})");
    expect(source).toContain("requirePlanApproval={requirePlanApproval}");
    expect(source).toContain("onRequirePlanApprovalChange={handleRequirePlanApprovalChange}");
  });

  it("does not treat the persistent preference as dirty or clear it in resetForm", () => {
    const source = readAppFile("components/NewTaskModal.tsx");
    const dirtyBody = source.slice(source.indexOf("const isDirty"), source.indexOf("setHasDirtyState"));
    expect(dirtyBody).not.toContain("requirePlanApproval");
    const resetBody = source.slice(source.indexOf("const resetForm"), source.indexOf("const handleClose"));
    expect(resetBody).not.toContain("setRequirePlanApproval");
  });
});
