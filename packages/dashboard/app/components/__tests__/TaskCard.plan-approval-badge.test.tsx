import { render, screen } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  fetchWorkflowSettingValues: vi.fn().mockResolvedValue({ stored: {}, effective: {}, orphaned: [] }),
}));
vi.mock("../ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("../PrCreateModal", () => ({ PrCreateModal: () => null }));
vi.mock("../../hooks/useTaskDiffStats", () => ({ useTaskDiffStats: () => ({ stats: null, loading: false }) }));
vi.mock("../../hooks/useBadgeWebSocket", () => ({ useBadgeWebSocket: () => ({ badgeUpdates: new Map(), isConnected: true, subscribeToBadge: vi.fn(), unsubscribeFromBadge: vi.fn() }) }));
vi.mock("../../hooks/useBatchBadgeFetch", () => ({ getFreshBatchData: vi.fn(() => null) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: vi.fn(), confirmWithChoice: vi.fn() }) }));

import { TaskCard } from "../TaskCard";

function task(requirePlanApproval?: boolean): Task {
  return {
    id: "FN-228",
    title: "Human plan review",
    description: "Review before execution",
    column: "todo",
    status: null,
    requirePlanApproval,
    dependencies: [],
    steps: [],
    currentStep: 0,
    createdAt: "2026-08-28T11:48:00.000Z",
    updatedAt: "2026-08-28T11:48:00.000Z",
  } as Task;
}

function renderBadge(requirePlanApproval?: boolean) {
  return render(
    <TaskCard
      task={task(requirePlanApproval)}
      onOpenDetail={vi.fn()}
      addToast={vi.fn()}
      taskColumnFlags={{ hold: true }}
    />,
  );
}

describe("TaskCard plan approval badge", () => {
  it("renders the shield and metadata wrapper for an enabled override", () => {
    renderBadge(true);

    expect(screen.getByTestId("plan-approval-badge-card-FN-228")).toHaveAccessibleName("Human plan review required");
    expect(screen.getByTestId("card-meta-badges")).toBeInTheDocument();
  });

  it.each([false, undefined])("does not render for %s", (requirePlanApproval) => {
    renderBadge(requirePlanApproval);

    expect(screen.queryByTestId("plan-approval-badge-card-FN-228")).toBeNull();
    expect(screen.queryByTestId("card-meta-badges")).toBeNull();
  });
});
