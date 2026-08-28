import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import type { TaskDetail, WorkflowStepResult } from "@fusion/core";
import { linkifyReactChildren } from "../utils/filePathLinkify";
import { buildTaskHistory, type TaskHistoryLabel } from "../utils/taskHistory";
import "./TaskHistoryTab.css";

const markdownComponents: Components = {
  p: ({ children, ...props }) => <p {...props}>{linkifyReactChildren(children)}</p>,
  li: ({ children, ...props }) => <li {...props}>{linkifyReactChildren(children)}</li>,
  code: ({ children, ...props }) => <code {...props}>{linkifyReactChildren(children)}</code>,
  pre: ({ children, className, ...props }) => <pre {...props} className={["workflow-markdown-pre", className].filter(Boolean).join(" ")}>{linkifyReactChildren(children)}</pre>,
  table: ({ children, className, ...props }) => <table {...props} className={["workflow-markdown-table", className].filter(Boolean).join(" ")}>{children}</table>,
};

export interface TaskHistoryTabProps {
  task: TaskDetail;
  results: WorkflowStepResult[];
  loading?: boolean;
}

function formatTimestamp(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString();
}

function normalizeToken(token: string): string {
  return token.toLowerCase().replaceAll("_", "-");
}

/*
FNXC:TaskHistory 2026-08-28-13:46:
Operators need planning, implementation, review, and merge summaries visible in sequence rather than hidden in an accordion. Every stage therefore renders a static heading followed immediately by its reports or stage-specific empty state, with no toggle shell or collapsed state.
*/
export function TaskHistoryTab({ task, results, loading = false }: TaskHistoryTabProps) {
  const { t } = useTranslation("app");
  const stages = useMemo(() => buildTaskHistory(task, results), [task, results]);
  const renderLabel = (label: TaskHistoryLabel): string => label.kind === "text"
    ? label.text
    : t(label.key, label.defaultValue, label.params);

  return (
    <div className="task-history" data-testid="task-history-tab">
      {loading && results.length === 0 && (task.workflowStepResults?.length ?? 0) === 0 && (
        <div className="task-history-loading">{t("taskHistory.loading", "Loading history…")}</div>
      )}
      {stages.map((stage) => {
        const stageName = t(`taskHistory.stage.${stage.id}`, stage.id);
        return (
          <section className="task-history-stage" key={stage.id} data-testid={`task-history-stage-${stage.id}`}>
            <div className="task-history-stage-heading">
              <h2 className="task-history-stage-title">{stageName}</h2>
              <span className="task-history-count" data-testid={`task-history-count-${stage.id}`}>{stage.entries.length}</span>
            </div>
            <div className="task-history-panel">
              {stage.entries.length === 0 ? (
                <p className="task-history-empty">{t(`taskHistory.empty.${stage.id}`, "No reports recorded.")}</p>
              ) : (
                <div className="task-history-entries">
                  {stage.entries.map((entry) => {
                    const token = entry.verdict ?? entry.status;
                    return (
                      <article className="task-history-entry" key={entry.id}>
                        <header className="task-history-entry-header">
                          <h3>{renderLabel(entry.title)}</h3>
                          {token && (
                            <span className={`workflow-result-badge workflow-result-badge--${normalizeToken(token)}`}>
                              {t(`taskHistory.verdict.${normalizeToken(token)}`, token)}
                            </span>
                          )}
                        </header>
                        {entry.timestamp && <time dateTime={entry.timestamp}>{formatTimestamp(entry.timestamp)}</time>}
                        {entry.meta && entry.meta.length > 0 && (
                          <dl className="task-history-meta">
                            {entry.meta.map((item, index) => (
                              <div key={`${entry.id}:meta:${index}`}><dt>{renderLabel(item.label)}</dt><dd>{item.value}</dd></div>
                            ))}
                          </dl>
                        )}
                        <div className="task-history-body markdown-body">
                          {entry.body?.trim() ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{entry.body}</ReactMarkdown>
                          ) : (
                            <p>{t("taskHistory.entry.noBody", "No report body was recorded.")}</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
