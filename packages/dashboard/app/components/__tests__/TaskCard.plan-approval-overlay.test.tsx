import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Task } from "@fusion/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { approvePlan } = vi.hoisted(() => ({ approvePlan: vi.fn() }));
vi.mock("../../api", () => ({
  approvePlan,
  fetchWorkflowSettingValues: vi.fn().mockResolvedValue({ stored: {}, effective: {}, orphaned: [] }),
}));
vi.mock("../ProviderIcon", () => ({ ProviderIcon: () => null }));
vi.mock("../PrCreateModal", () => ({ PrCreateModal: () => null }));
vi.mock("../../hooks/useTaskDiffStats", () => ({ useTaskDiffStats: () => ({ stats: null, loading: false }) }));
vi.mock("../../hooks/useBadgeWebSocket", () => ({ useBadgeWebSocket: () => ({ badgeUpdates: new Map(), isConnected: true, subscribeToBadge: vi.fn(), unsubscribeFromBadge: vi.fn() }) }));
vi.mock("../../hooks/useBatchBadgeFetch", () => ({ getFreshBatchData: vi.fn(() => null) }));
vi.mock("../../hooks/useConfirm", () => ({ useConfirm: () => ({ confirm: vi.fn(), confirmWithChoice: vi.fn() }) }));

import { TaskCard } from "../TaskCard";
import { readAppFile } from "../../test/cssFixture";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "FN-212",
    title: "Approval hold",
    description: "Review before execution",
    prompt: "# Plan\n\n## Steps\n",
    column: "triage",
    status: "awaiting-approval",
    dependencies: [],
    steps: [],
    currentStep: 0,
    createdAt: "2026-08-28T06:24:00.000Z",
    updatedAt: "2026-08-28T06:24:00.000Z",
    ...overrides,
  } as Task;
}

const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  approvePlan.mockReset();
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({ width: 420, height: 240, top: 0, left: 0, right: 420, bottom: 240, x: 0, y: 0, toJSON: () => ({}) }));
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalRect;
  vi.restoreAllMocks();
});

function renderCard(row = task(), addToast = vi.fn()) {
  render(<TaskCard task={row} projectId="project-1" onOpenDetail={vi.fn()} addToast={addToast} />);
  return addToast;
}

describe("TaskCard plan approval overlay", () => {
  it("renders Need Your Review with Approve and Respecify", () => {
    renderCard();
    const notice = screen.getByTestId("plan-approval-card-FN-212");
    expect(notice).toHaveTextContent("Need Your Review");
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Respecify" })).toBeEnabled();
  });

  it("keeps distinct replan-cap copy", () => {
    renderCard(task({ column: "in-review", awaitingApprovalReason: "plan-review-replan-cap" }));
    expect(screen.getByTestId("plan-approval-card-FN-212")).toHaveTextContent("Plan Review did not converge");
  });

  it("disables Approve when no prompt is available", () => {
    renderCard(task({ prompt: undefined }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  });

  it("lets the external Blocked overlay win", () => {
    renderCard(task({
      status: "blocked",
      paused: true,
      pausedReason: "external-block",
      externalBlock: {
        origin: "host-environment",
        code: "ENOSPC",
        message: "disk full",
        source: "agent-declaration",
        blockedAt: "2026-08-28T06:24:00.000Z",
        resume: { column: "triage" },
      },
    }));
    expect(screen.getByTestId("external-block-card-FN-212")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-approval-card-FN-212")).toBeNull();
  });

  it("approves through the existing API and opens the shared respecify dialog", async () => {
    approvePlan.mockResolvedValue(task({ status: undefined, column: "todo" }));
    const addToast = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approvePlan).toHaveBeenCalledWith("FN-212", "project-1"));
    expect(addToast).toHaveBeenCalledWith(expect.any(String), "success");

    fireEvent.click(screen.getByRole("button", { name: "Respecify" }));
    expect(screen.getByTestId("respecify-plan-dialog")).toBeInTheDocument();
  });

  it("keeps mobile approval actions on the touch-target token", () => {
    const css = readAppFile("components/TaskCard.css");
    expect(css).toMatch(/@media \(max-width: 768px\)[\s\S]*\.plan-approval-notice__actions \.btn[\s\S]*min-(?:width|inline-size): var\(--touch-target-min-size\);[\s\S]*min-(?:height|block-size): var\(--touch-target-min-size\);/);
  });
});
