import "./RespecifyPlanDialog.css";

import type { Task } from "@fusion/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { requestSpecRevision } from "../api/tasks/task-steer";
import type { ToastType } from "../hooks/useToast";

export interface RespecifyPlanDialogProps {
  taskId: string;
  projectId?: string;
  addToast: (message: string, type?: ToastType) => void;
  onClose: () => void;
  onSubmitted?: (task: Task) => void;
}

export function RespecifyPlanDialog({
  taskId,
  projectId,
  addToast,
  onClose,
  onSubmitted,
}: RespecifyPlanDialogProps) {
  const { t } = useTranslation("app");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = () => {
    const feedback = note.trim();
    if (!feedback || isSubmitting) return;
    setIsSubmitting(true);
    void requestSpecRevision(taskId, feedback, projectId, { preservePlan: true }).then(
      (task) => {
        addToast(t("taskDetail.respecify.success", "Plan sent back for revision"), "success");
        onSubmitted?.(task);
        onClose();
      },
      (error: unknown) => {
        try {
          setIsSubmitting(false);
          const message = error instanceof Error ? error.message : String(error);
          addToast(`${t("taskDetail.respecify.error", "Failed to request plan revision")}: ${message}`, "error");
        } catch {
          // Request failures remain handled even if a host toast sink is unavailable during teardown.
        }
      },
    );
  };

  return (
    <div
      className="modal-overlay open respecify-plan-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`respecify-plan-title-${taskId}`}
      data-testid="respecify-plan-dialog"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="modal modal-md respecify-plan-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3 id={`respecify-plan-title-${taskId}`}>
            {t("taskDetail.respecify.modalTitle", "Respecify plan")}
          </h3>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label={t("common.close", "Close")}
          >
            &times;
          </button>
        </div>
        <div className="respecify-plan-dialog__body">
          <p>{t("taskDetail.respecify.help", "Describe what you want changed in the existing plan.")}</p>
          <textarea
            className="input respecify-plan-dialog__textarea"
            data-testid="respecify-plan-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("taskDetail.respecify.placeholder", "Enter your requested changes...")}
            rows={6}
            maxLength={2000}
            autoFocus
            disabled={isSubmitting}
          />
          <div className="respecify-plan-dialog__count">
            {t("taskDetail.respecify.charCount", "{{count}}/2000 characters", { count: note.length })}
          </div>
        </div>
        <div className="modal-actions respecify-plan-dialog__actions">
          <button
            type="button"
            className="btn btn-sm"
            data-testid="respecify-plan-cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="respecify-plan-submit"
            onClick={() => void submit()}
            disabled={!note.trim() || isSubmitting}
          >
            {isSubmitting
              ? t("taskDetail.respecify.submitting", "Submitting...")
              : t("taskDetail.respecify.submit", "Respecify")}
          </button>
        </div>
      </div>
    </div>
  );
}
