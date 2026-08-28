import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskDetail, WorkflowStepResult } from "@fusion/core";
import realEnApp from "../../../../i18n/locales/en/app.json";
import { TaskHistoryTab } from "../TaskHistoryTab";

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return { id: "FN-208", title: "History", description: "", priority: "normal", column: "todo", currentStep: 0, steps: [], dependencies: [], log: [], prompt: "# History", createdAt: "2026-08-28T00:00:00.000Z", updatedAt: "2026-08-28T00:00:00.000Z", ...overrides } as TaskDetail;
}

function result(overrides: Partial<WorkflowStepResult>): WorkflowStepResult {
  return { workflowStepId: "code-review-step", workflowStepName: "Code Review", phase: "pre-merge", reviewKind: "code", status: "passed", ...overrides };
}

async function renderHistory(taskValue = task(), results: WorkflowStepResult[] = [], resources: Record<string, unknown> = realEnApp) {
  const i18n = createInstance().use(initReactI18next);
  await i18n.init({ lng: "en", fallbackLng: "en", resources: { en: { app: resources } }, interpolation: { escapeValue: false } });
  return render(<I18nextProvider i18n={i18n}><TaskHistoryTab task={taskValue} results={results} /></I18nextProvider>);
}

describe("TaskHistoryTab", () => {
  it("renders four collapsed stage accordions", async () => {
    await renderHistory();
    for (const id of ["plan", "code", "review", "merge"]) expect(screen.getByTestId(`task-history-stage-${id}`)).toHaveAttribute("aria-expanded", "false");
  });

  it("shows zero counts and stage-specific empty states", async () => {
    await renderHistory();
    for (const id of ["plan", "code", "review", "merge"]) expect(screen.getByTestId(`task-history-count-${id}`)).toHaveTextContent("0");
    fireEvent.click(screen.getByTestId("task-history-stage-code"));
    expect(screen.getByText(/No implementation summaries recorded/)).toBeInTheDocument();
  });

  it("shows review attempts chronologically with dates and markdown", async () => {
    await renderHistory(task(), [result({ verdict: "APPROVE", output: "**Approved** body", completedAt: "2026-08-28T03:00:00.000Z", priorAttempts: [result({ status: "failed", verdict: "REVISE", output: "Revise body", completedAt: "2026-08-28T01:00:00.000Z" })] })]);
    expect(screen.getByTestId("task-history-count-review")).toHaveTextContent("2");
    fireEvent.click(screen.getByTestId("task-history-stage-review"));
    expect(screen.getByText("Revise body")).toBeInTheDocument();
    expect(screen.getByText("Approved", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByRole("time")).toHaveLength(2);
  });

  it("updates the Code count when step reports arrive", async () => {
    const rendered = await renderHistory(task());
    expect(screen.getByTestId("task-history-count-code")).toHaveTextContent("0");
    rendered.rerender(<TaskHistoryTab task={task({ stepReports: [{ id: "one", stepIndex: 1, stepName: "Build", summary: "Built it", recordedAt: "2026-08-28T02:00:00.000Z", source: "agent", attempt: 1 }] })} results={[]} />);
    expect(screen.getByTestId("task-history-count-code")).toHaveTextContent("1");
  });

  it("toggles a panel without disabling zero-count rows", async () => {
    await renderHistory();
    const button = screen.getByTestId("task-history-stage-plan");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the Code empty state when no step summary exists", async () => {
    await renderHistory(task({ steps: [{ name: "Completed without report", status: "done" }] }));
    fireEvent.click(screen.getByTestId("task-history-stage-code"));
    expect(screen.getByText(/Summaries appear when implementation steps report/)).toBeInTheDocument();
  });

  it("keeps narrow stage headers accessible and single-row scaffolded", async () => {
    window.innerWidth = 375;
    await renderHistory();
    const button = screen.getByRole("button", { name: /Plan, 0 reports/ });
    expect(button).toHaveClass("task-history-stage-header");
    expect(button.querySelector(".task-history-count")).toHaveTextContent("0");
  });

  it("renders stage and merge titles through localization keys", async () => {
    const resources = structuredClone(realEnApp) as typeof realEnApp;
    resources.taskHistory.stage.plan = "PLAN_SENTINEL";
    resources.taskHistory.entry.merged = "MERGED_SENTINEL";
    await renderHistory(task({ mergeDetails: { commitSha: "abcdef", mergedAt: "2026-08-28T04:00:00.000Z" } }), [], resources);
    expect(screen.getByText("PLAN_SENTINEL")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("task-history-stage-merge"));
    expect(screen.getByText("MERGED_SENTINEL")).toBeInTheDocument();
  });
});
