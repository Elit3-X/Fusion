import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";

const taskCardSource = readAppFile("components/TaskCard.tsx");
const listViewSource = readAppFile("components/ListView.tsx");

describe("plan approval badge render-site census", () => {
  it("renders beside the fast-mode badge in exactly the board and two list paths", () => {
    const planApprovalSites = [
      ...(taskCardSource.match(/className="card-plan-approval-badge"/g) ?? []),
      ...(listViewSource.match(/className="list-plan-approval-badge"/g) ?? []),
    ];
    const fastModeSites = [
      ...(taskCardSource.match(/className="card-execution-mode-badge card-execution-mode-badge--fast"/g) ?? []),
      ...(listViewSource.match(/className="list-execution-mode-badge list-execution-mode-badge--fast"/g) ?? []),
    ];

    expect(planApprovalSites).toHaveLength(3);
    expect(planApprovalSites).toHaveLength(fastModeSites.length);
    expect(taskCardSource).toContain("plan-approval-badge-card-${task.id}");
    expect(listViewSource).toContain("plan-approval-badge-list-card-${task.id}");
    expect(listViewSource).toContain("plan-approval-badge-list-table-${task.id}");
  });

  it("uses an explicit true check at every badge render site", () => {
    expect(taskCardSource.match(/task\.requirePlanApproval === true && \(/g)).toHaveLength(1);
    expect(listViewSource.match(/task\.requirePlanApproval === true && \(/g)).toHaveLength(2);
  });
});
