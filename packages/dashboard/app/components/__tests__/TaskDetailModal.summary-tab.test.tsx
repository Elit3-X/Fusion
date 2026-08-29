import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Column, Task, TaskDetail } from "@fusion/core";
import {
  makeTask,
  noop,
  noopDelete,
  noopMerge,
  noopOpenDetail,
  setupTaskDetailModalHooks,
} from "./TaskDetailModal.test-helpers";
import { TaskDetailContent, TaskDetailModal } from "../TaskDetailModal";

setupTaskDetailModalHooks();

function doneTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return makeTask({
    column: "done",
    summary: "Completed report for the Summary tab.",
    steps: [{ name: "Implement", status: "done" }],
    ...overrides,
  });
}

function modal(task: Task | TaskDetail, initialTab?: any) {
  return (
    <TaskDetailModal
      task={task}
      initialTab={initialTab}
      onClose={noop}
      onDeleteTask={noopDelete}
      onMergeTask={noopMerge}
      onOpenDetail={noopOpenDetail}
      addToast={noop}
    />
  );
}

describe("TaskDetailModal Summary tab", () => {
  it("lands completed work on its report-first Summary while Activity remains first in the strip", () => {
    render(modal(doneTask()));

    expect(document.querySelector(".detail-tabs")?.firstElementChild?.textContent).toContain("Activity");
    expect(screen.getByRole("button", { name: "Summary" })).toHaveClass("detail-tab-active");
    expect(screen.getByRole("heading", { name: "Work done by agents", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Completed report for the Summary tab.")).toBeInTheDocument();
    expect(screen.getByText("Implement")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "What changed" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Token usage & cost" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("button", { name: "Activity" })).toHaveClass("detail-tab-active");
    expect(screen.queryByText("Completed report for the Summary tab.")).toBeNull();
  });

  it("renders Summary for every live column without changing its activity-first default", () => {
    for (const column of ["todo", "in-progress", "in-review"] as Column[]) {
      const view = render(modal(makeTask({ column })));
      expect(screen.getByRole("button", { name: "Summary" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Activity" })).toHaveClass("detail-tab-active");
      fireEvent.click(screen.getByRole("button", { name: "Summary" }));
      expect(screen.getByTestId("task-summary-tab")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("places captured recommendations under Summary without restoring a Recommendations tab", () => {
    render(modal(doneTask({ recommendations: [{ id: "REC-244", title: "Audit a related path", description: "Optional future work.", category: "improvement" }] })));

    expect(screen.queryByRole("button", { name: "Recommendations" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Recommendations", level: 3 })).toBeInTheDocument();
    expect(screen.getByText("Audit a related path")).toBeInTheDocument();
  });

  it("hides the recommendation section when no captured recommendation belongs to the task", () => {
    render(modal(doneTask({ recommendations: [] })));

    expect(screen.queryByRole("heading", { name: "Recommendations", level: 3 })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recommendations" })).toBeNull();
  });

  it("keeps Summary in the shared horizontally scrollable strip for embedded detail", () => {
    render(
      <TaskDetailContent
        task={doneTask()}
        embedded
        initialTab="summary"
        onDeleteTask={noopDelete}
        onMergeTask={noopMerge}
        onOpenDetail={noopOpenDetail}
        addToast={noop}
      />,
    );

    expect(document.querySelector(".detail-tabs")?.contains(screen.getByRole("button", { name: "Summary" }))).toBe(true);
    expect(screen.getByTestId("task-summary-tab")).toBeInTheDocument();
  });
});
