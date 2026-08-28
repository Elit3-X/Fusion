import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "@fusion/core";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestState = vi.hoisted(() => ({
  calls: [] as unknown[][],
  implementation: (..._args: unknown[]): Promise<unknown> => Promise.resolve(undefined),
}));
vi.mock("../../api/tasks/task-steer", () => ({
  requestSpecRevision: (...args: unknown[]) => {
    requestState.calls.push(args);
    return requestState.implementation(...args);
  },
}));

import { RespecifyPlanDialog } from "../RespecifyPlanDialog";

const updatedTask = {
  id: "FN-212",
  description: "Revise",
  column: "planning",
  dependencies: [],
  steps: [],
  currentStep: 0,
  createdAt: "2026-08-28T06:24:00.000Z",
  updatedAt: "2026-08-28T06:24:00.000Z",
} as Task;

function renderDialog(overrides: Partial<ComponentProps<typeof RespecifyPlanDialog>> = {}) {
  const props = {
    taskId: "FN-212",
    projectId: "project-1",
    addToast: vi.fn(),
    onClose: vi.fn(),
    onSubmitted: vi.fn(),
    ...overrides,
  };
  render(<RespecifyPlanDialog {...props} />);
  return props;
}

describe("RespecifyPlanDialog", () => {
  beforeEach(() => {
    requestState.calls = [];
    requestState.implementation = () => Promise.resolve(updatedTask);
  });

  it("disables submit for empty and whitespace-only notes", async () => {
    const user = userEvent.setup();
    renderDialog();
    const submit = screen.getByTestId("respecify-plan-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(screen.getByTestId("respecify-plan-note"), "   ");
    expect(submit.disabled).toBe(true);
    expect(requestState.calls).toHaveLength(0);
  });

  it("keeps textarea identity and focus while accumulating real per-character input", async () => {
    const user = userEvent.setup();
    renderDialog();
    const textarea = screen.getByTestId("respecify-plan-note") as HTMLTextAreaElement;

    await user.type(textarea, "Change all three steps");

    expect(screen.getByTestId("respecify-plan-note")).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe("Change all three steps");
  });

  it("submits through the preservePlan API contract", async () => {
    const user = userEvent.setup();
    const props = renderDialog();

    await user.type(screen.getByTestId("respecify-plan-note"), "Revise the test strategy");
    await user.click(screen.getByTestId("respecify-plan-submit"));

    await waitFor(() => expect(requestState.calls).toEqual([[
      "FN-212",
      "Revise the test strategy",
      "project-1",
      { preservePlan: true },
    ]]));
    expect(props.onSubmitted).toHaveBeenCalledWith(updatedTask);
    expect(props.addToast).toHaveBeenCalledWith(expect.any(String), "success");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog and note open when the request fails", async () => {
    const user = userEvent.setup();
    requestState.implementation = () => Promise.reject(new Error("network unavailable"));
    const props = renderDialog();

    await user.type(screen.getByTestId("respecify-plan-note"), "Keep this note");
    fireEvent.click(screen.getByTestId("respecify-plan-submit"));

    await waitFor(() => expect(props.addToast).toHaveBeenCalled());
    expect(requestState.calls).toHaveLength(1);
    expect(props.addToast).toHaveBeenCalledWith(expect.stringContaining("network unavailable"), "error");
    expect(screen.getByTestId("respecify-plan-dialog")).toBeTruthy();
    expect((screen.getByTestId("respecify-plan-note") as HTMLTextAreaElement).value).toBe("Keep this note");
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
