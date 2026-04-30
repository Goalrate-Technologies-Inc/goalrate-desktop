import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  MoveRight,
  Pencil,
  X,
} from "lucide-react";
import {
  AGENDA_TIME_INPUT_STEP_SECONDS,
  agendaTimeToInputValue,
  timeInputValueToAgendaTime,
} from "./agendaRows";

export interface TaskRowEdit {
  taskId: string;
  title: string;
  startTime: string;
  durationMinutes: number;
}

interface TaskRowProps {
  taskId: string;
  title: string;
  startTime?: string | null;
  durationMinutes?: number | null;
  eisenhowerQuadrant?: string | null;
  deferralCount?: number;
  isCompleted?: boolean;
  onComplete?: () => void;
  onDefer?: () => void;
  onEdit?: (edit: TaskRowEdit) => void;
  onRemove?: () => void;
  onOpenGoalNotes?: () => void;
  dragHandle?: ReactNode;
}

export function TaskRow({
  taskId,
  title,
  startTime,
  durationMinutes,
  eisenhowerQuadrant,
  deferralCount = 0,
  isCompleted = false,
  onComplete,
  onDefer,
  onEdit,
  onRemove,
  onOpenGoalNotes,
  dragHandle,
}: TaskRowProps): React.ReactElement {
  const [justDeferred, setJustDeferred] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftStartTime, setDraftStartTime] = useState(
    agendaTimeToInputValue(startTime) || "09:00",
  );
  const [draftDuration, setDraftDuration] = useState(
    String(durationMinutes ?? 30),
  );
  // Optimistic UI: toggle immediately, sync with prop on next render
  const [optimisticCompleted, setOptimisticCompleted] = useState(isCompleted);
  const lastCompletedProp = useRef(isCompleted);

  // Sync optimistic state when the prop changes (after backend confirms)
  useEffect(() => {
    if (lastCompletedProp.current === isCompleted) {
      return undefined;
    }
    lastCompletedProp.current = isCompleted;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setOptimisticCompleted(isCompleted);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isCompleted]);

  // Auto-clear the "just deferred" state after 2 seconds
  useEffect(() => {
    if (!justDeferred) {
      return;
    }
    const timer = setTimeout(() => setJustDeferred(false), 2000);
    return () => clearTimeout(timer);
  }, [justDeferred]);

  const handleComplete = (): void => {
    setOptimisticCompleted((prev) => !prev);
    onComplete?.();
  };

  const handleDefer = (): void => {
    if (onDefer) {
      onDefer();
      setJustDeferred(true);
    }
  };

  const handleEditSave = (): void => {
    const title = draftTitle.trim();
    const startTime = timeInputValueToAgendaTime(draftStartTime);
    const durationMinutes = Number.parseInt(draftDuration, 10);
    if (!title || !startTime || !Number.isFinite(durationMinutes)) {
      return;
    }
    onEdit?.({
      taskId,
      title,
      startTime,
      durationMinutes: Math.max(1, durationMinutes),
    });
    setIsEditing(false);
  };

  const startEditing = (): void => {
    setDraftTitle(title);
    setDraftStartTime(agendaTimeToInputValue(startTime) || "09:00");
    setDraftDuration(String(durationMinutes ?? 30));
    setIsEditing(true);
  };

  const titleClassName = `truncate text-sm ${
    optimisticCompleted
      ? "text-text-muted line-through"
      : "text-text-primary"
  }`;
  const removeButtonLabel = `Remove "${title}" from Agenda`;

  if (isEditing) {
    return (
      <div className="flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-surface-warm">
        <input
          aria-label="Agenda item start time"
          type="time"
          step={AGENDA_TIME_INPUT_STEP_SECONDS}
          value={draftStartTime}
          onChange={(event) => setDraftStartTime(event.target.value)}
          className="w-28 rounded border border-border bg-surface px-2 py-1 font-mono text-xs tabular-nums text-text-secondary outline-none focus:border-accent-projects"
        />
        <input
          aria-label="Agenda item title"
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-projects"
        />
        <input
          aria-label="Agenda item duration minutes"
          type="number"
          min={1}
          step={5}
          value={draftDuration}
          onChange={(event) => setDraftDuration(event.target.value)}
          className="w-16 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text-secondary outline-none focus:border-accent-projects"
        />
        <button
          type="button"
          onClick={handleEditSave}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
          title="Save Agenda item"
          aria-label="Save Agenda item"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setIsEditing(false)}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
          title="Cancel Agenda item edit"
          aria-label="Cancel Agenda item edit"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-warm ${
        optimisticCompleted ? "opacity-50" : ""
      } ${justDeferred ? "opacity-60" : ""}`}
    >
      {dragHandle}

      <button
        type="button"
        onClick={handleComplete}
        className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
          optimisticCompleted
            ? "border-progress-high bg-progress-high text-white"
            : "border-border hover:border-text-secondary hover:bg-surface-strong"
        }`}
        aria-label={
          optimisticCompleted
            ? `Mark "${title}" incomplete`
            : `Mark "${title}" complete`
        }
        role="checkbox"
        aria-checked={optimisticCompleted}
      >
        {optimisticCompleted && <Check className="h-3 w-3" />}
      </button>

      {startTime && (
        <div className="w-[5.75rem] shrink-0 font-mono text-xs tabular-nums text-text-muted">
          <span className="text-text-secondary">{startTime}</span>
        </div>
      )}

      <div className="min-w-0 flex-1">
        {onOpenGoalNotes ? (
          <button
            type="button"
            onClick={onOpenGoalNotes}
            className={`block max-w-full text-left underline-offset-2 transition-colors hover:underline focus:outline-none focus:ring-2 focus:ring-accent-projects ${titleClassName}`}
            title={`Open goal notes for "${title}"`}
            aria-label={`Open goal notes for "${title}"`}
          >
            {title}
          </button>
        ) : (
          <div className={titleClassName}>{title}</div>
        )}
        {durationMinutes && (
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-text-muted">
            <span>{durationMinutes} min</span>
          </div>
        )}
      </div>

      {justDeferred && (
        <span className="rounded-full bg-surface-strong px-2 py-0.5 font-mono text-xs text-text-muted transition-opacity">
          Deferred to tomorrow
        </span>
      )}

      {!justDeferred && deferralCount > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-progress-low-light px-2 py-0.5">
          {deferralCount >= 3 && (
            <AlertTriangle className="h-3 w-3 text-progress-low" />
          )}
          <span className="font-mono text-xs text-progress-low">
            {deferralCount}x deferred
          </span>
        </span>
      )}

      {!optimisticCompleted && !justDeferred && eisenhowerQuadrant === "delegate" && (
        <span
          className="rounded-full border border-progress-mid/30 bg-surface-strong px-2 py-0.5 font-mono text-xs text-progress-mid"
          title="Delegate task"
          aria-label="Delegate task"
        >
          Delegate
        </span>
      )}

      {!optimisticCompleted && !justDeferred && onDefer && (
        <button
          type="button"
          onClick={handleDefer}
          className="invisible rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary group-hover:visible"
          title="Defer to tomorrow"
        >
          <MoveRight className="h-3.5 w-3.5" />
        </button>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={startEditing}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
          title={`Edit "${title}"`}
          aria-label={`Edit "${title}"`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
          title={removeButtonLabel}
          aria-label={removeButtonLabel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
