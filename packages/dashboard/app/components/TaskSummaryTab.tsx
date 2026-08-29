import { useTranslation } from "react-i18next";
import type { TaskDetail, TaskStep, WorkflowStepResult } from "@fusion/core";
import { TaskHistoryTab } from "./TaskHistoryTab";

interface TaskSummaryTabProps {
  task: TaskDetail;
  results: WorkflowStepResult[];
  loading?: boolean;
}

function getCompletedSteps(steps: TaskStep[] | undefined): TaskStep[] {
  return (steps ?? []).filter((step) => step.status === "done" || step.status === "skipped");
}

/*
FNXC:TaskDetailSummaryTab 2026-08-28-23:05:
Summary is available in every task column and starts with the agents' chronological reports. It owns
neither token or cost data nor landed-commit facts: Stats owns spend and Changes owns merge results,
so the same task fact has one readable home.
*/
export function TaskSummaryTab({ task, results, loading = false }: TaskSummaryTabProps) {
  const { t } = useTranslation("app");
  const completedSteps = getCompletedSteps(task.steps);

  return (
    <div className="task-summary-tab" data-testid="task-summary-tab">
      <section className="task-summary-section task-summary-section--agent-work">
        <h3>{t("taskDetail.summaryTab.agentWorkHeading", "Work done by agents")}</h3>
        {completedSteps.length > 0 && (
          <div className="task-summary-subsection">
            <h4>{t("taskDetail.summaryTab.completedSteps", "Completed steps")}</h4>
            <ul className="task-summary-work-list">
              {completedSteps.map((step, index) => (
                <li key={`${step.name}-${index}`}>
                  <span className={`task-summary-status task-summary-status--${step.status}`}>{step.status}</span>
                  <span>{step.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <TaskHistoryTab task={task} results={results} loading={loading} />
      </section>
    </div>
  );
}
