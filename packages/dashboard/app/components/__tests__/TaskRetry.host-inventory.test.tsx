import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";

const component = (name: string) => readAppFile(`components/${name}`);

describe("Retry host inventory", () => {
  it("wires the shared action model and stage copy in every menu host", () => {
    for (const name of ["TaskCard.tsx", "ListView.tsx", "TaskDetailModal.tsx"]) {
      const source = component(name);
      expect(source).toContain("buildTaskActionMenuModel");
      expect(source).toContain("onRetry");
      expect(source).toContain("resolveRetryStageCopy");
    }
  });

  it("removes the retired stage-restart plumbing from the ownership chain", () => {
    for (const name of ["TaskCard.tsx", "ListView.tsx", "TaskDetailModal.tsx", "Board.tsx", "Column.tsx", "WorktreeGroup.tsx", "AppModals.tsx", "dashboard/MainContent.tsx", "useRightDockController.tsx"]) {
      const source = component(name);
      expect(source).not.toContain("onRestart" + "Stage");
      expect(source).not.toContain("onRespecify");
    }
  });
});
