import { describe, expect, it } from "vitest";
import { readAppFile } from "../../test/cssFixture";

const source = readAppFile("components/ListView.tsx");
const notices = source.match(/<PlanApprovalNotice\b[^>]*variant="list"[^>]*\/>/g) ?? [];

describe("ListView plan approval overlays", () => {
  it("renders the notice in the compact card path", () => {
    expect(notices[0]).toContain("projectId={projectId}");
    expect(notices[0]).toContain("isIntakeColumn={isIntakeColumnForTask(task)}");
  });

  it("renders the notice in the table status-cell path", () => {
    expect(notices).toHaveLength(2);
    expect(notices[1]).toContain("projectId={projectId}");
    expect(notices[1]).toContain("addToast={addToast}");
  });
});
