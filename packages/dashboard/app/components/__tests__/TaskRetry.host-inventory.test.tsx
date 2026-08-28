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

  it("keeps stage restart deleted while Respecify stays locally owned by menu hosts", () => {
    for (const name of ["TaskCard.tsx", "ListView.tsx", "TaskDetailModal.tsx", "Board.tsx", "Column.tsx", "WorktreeGroup.tsx", "AppModals.tsx", "dashboard/MainContent.tsx", "useRightDockController.tsx"]) {
      expect(component(name)).not.toContain("onRestart" + "Stage");
    }
    for (const name of ["TaskCard.tsx", "ListView.tsx", "TaskDetailModal.tsx"]) {
      expect(component(name)).toContain("onRespecify");
    }
    for (const name of ["Board.tsx", "Column.tsx", "WorktreeGroup.tsx", "AppModals.tsx", "dashboard/MainContent.tsx", "useRightDockController.tsx"]) {
      expect(component(name)).not.toContain("onRespecify");
    }
  });
});
