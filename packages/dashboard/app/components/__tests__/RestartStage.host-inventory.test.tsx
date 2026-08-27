import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";

const component = (name: string) => readAppFile(`components/${name}`);

describe("Restart stage host inventory", () => {
  it("wires every shared task-menu host", () => {
    for (const name of ["TaskCard.tsx", "ListView.tsx", "TaskDetailModal.tsx"]) {
      const source = component(name);
      expect(source).toContain("buildTaskActionMenuModel");
      expect(source).toContain("onRestartStage");
    }
  });

  it("forwards the action through the board and modal ownership chains", () => {
    for (const name of ["Board.tsx", "Column.tsx", "WorktreeGroup.tsx", "AppModals.tsx", "dashboard/MainContent.tsx", "useRightDockController.tsx"]) {
      expect(component(name)).toContain("onRestartStage");
    }
  });
});
