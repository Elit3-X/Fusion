import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import type { TaskDetail, WorkflowStepResult } from "@fusion/core";
import { linkifyReactChildren } from "../utils/filePathLinkify";
import { buildTaskHistory, type TaskHistoryLabel, type TaskHistoryStageId } from "../utils/taskHistory";
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

export function TaskHistoryTab({ task, results, loading = false }: TaskHistoryTabProps) {
  const { t } = useTranslation("app");
  const stages = useMemo(() => buildTaskHistory(task, results), [task, results]);
  const [expanded, setExpanded] = useState<Set<TaskHistoryStageId>>(() => new Set());
  const renderLabel = (label: TaskHistoryLabel): string => label.kind === "text"
    ? label.text
    : t(label.key, label.defaultValue, label.params);

  return (
    <div className="task-history" data-testid="task-history-tab">
      {loading && results.length === 0 && (task.workflowStepResults?.length ?? 0) === 0 && (
        <div className="task-history-loading">{t("taskHistory.loading", "Loading history…")}</div>
      )}
      {stages.map((stage) => {
        const isExpanded = expanded.has(stage.id);
        const stageName = t(`taskHistory.stage.${stage.id}`, stage.id);
        const panelId = `task-history-panel-${stage.id}`;
        return (
          <section className="task-history-stage" key={stage.id}>
            <button
              type="button"
              className="task-history-stage-header"
              data-testid={`task-history-stage-${stage.id}`}
              aria-expanded={isExpanded}
              aria-controls={panelId}
              aria-label={t("taskHistory.stageToggleAria", "{{stage}}, {{count}} reports", { stage: stageName, count: stage.entries.length })}
              onClick={() => setExpanded((current) => {
                const next = new Set(current);
                if (next.has(stage.id)) next.delete(stage.id);
                else next.add(stage.id);
                return next;
              })}
            >
              <span className="task-history-stage-title">
                {isExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                <span>{stageName}</span>
              </span>
              <span className="task-history-count" data-testid={`task-history-count-${stage.id}`}>{stage.entries.length}</span>
            </button>
            {isExpanded && (
              <div className="task-history-panel" id={panelId}>
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
            )}
          </section>
        );
      })}
    </div>
  );
}
