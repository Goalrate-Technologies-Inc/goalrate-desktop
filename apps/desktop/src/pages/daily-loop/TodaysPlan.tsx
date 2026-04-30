import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  FileText,
  GripVertical,
  Plus,
  Undo2,
  X,
} from "lucide-react";
import type { DailyStats, ScheduledTask } from "@goalrate-app/shared";
import type { UseDailyLoopReturn } from "../../hooks/useDailyLoop";
import { OutcomeCard } from "./OutcomeCard";
import { TaskRow, type TaskRowEdit } from "./TaskRow";
import { PlanGenerateButton } from "./PlanGenerateButton";
import { CheckInDialog } from "./CheckInDialog";
import {
  AGENDA_TIME_INPUT_STEP_SECONDS,
  agendaTimeToInputValue,
  agendaTimeToMinutes,
  formatScheduleMinutes,
  reflowAgendaRowsFromTaskId,
  reorderAgendaRowsByTaskId,
  scheduleMinutes,
  timeInputValueToAgendaTime,
  type AgendaTaskRow,
} from "./agendaRows";

const MAX_AGENDA_UNDO_DEPTH = 50;

/** Convert a task_slug_id into a human-readable label: "task_mvp_core_feature" → "MVP core feature" */
function humanizeTaskId(id: string): string {
  return id
    .replace(/^task_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/, (c) => c.toUpperCase());
}

/** Pick the progress color based on completion percentage */
function progressColor(pct: number): string {
  if (pct <= 33) {
    return "var(--progress-low)";
  }
  if (pct <= 74) {
    return "var(--progress-mid)";
  }
  return "var(--progress-high)";
}

/** Compute a 7-day average completion rate from recent stats, excluding today */
function weeklyAverage(stats: DailyStats[], todayDate: string): number | null {
  const past = stats.filter((s) => s.date !== todayDate && s.plannedCount > 0);
  if (past.length < 2) {
    return null;
  }
  const totalCompleted = past.reduce((sum, s) => sum + s.completedCount, 0);
  const totalPlanned = past.reduce((sum, s) => sum + s.plannedCount, 0);
  if (totalPlanned === 0) {
    return null;
  }
  return Math.round((totalCompleted / totalPlanned) * 100);
}

function sortedUniqueScheduledTasks(tasks: ScheduledTask[]): AgendaTaskRow[] {
  const seenTaskIds = new Set<string>();
  return [...tasks]
    .sort((a, b) => {
      const byTime = scheduleMinutes(a.startTime) - scheduleMinutes(b.startTime);
      if (byTime !== 0) {
        return byTime;
      }
      return a.title.localeCompare(b.title);
    })
    .filter((task) => {
      if (!task.taskId) {
        return true;
      }
      if (seenTaskIds.has(task.taskId)) {
        return false;
      }
      seenTaskIds.add(task.taskId);
      return true;
    });
}

function scheduledTaskFromRow(row: AgendaTaskRow): ScheduledTask {
  return {
    id: row.id || `scheduled_${row.taskId}`,
    taskId: row.taskId,
    title: row.title,
    startTime: row.startTime || "9:00 AM",
    durationMinutes: row.durationMinutes ?? 30,
    estimateSource: row.estimateSource ?? "manual",
    eisenhowerQuadrant: row.eisenhowerQuadrant ?? null,
  };
}

function cloneAgendaRows(rows: AgendaTaskRow[]): AgendaTaskRow[] {
  return rows.map((row) => ({ ...row }));
}

function agendaRowsSignature(rows: AgendaTaskRow[]): string {
  return JSON.stringify(rows.map(scheduledTaskFromRow));
}

function manualTaskId(title: string, existingIds: Set<string>): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "item";
  const base = `task_manual_${slug}`;
  let candidate = base;
  let suffix = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function nextAgendaStartTime(rows: AgendaTaskRow[]): string {
  if (rows.length === 0) {
    return "9:00 AM";
  }
  const last = rows[rows.length - 1];
  const start = scheduleMinutes(last.startTime);
  if (start === Number.MAX_SAFE_INTEGER) {
    return "9:00 AM";
  }
  return formatScheduleMinutes(start + (last.durationMinutes ?? 30));
}

// ── Progress Bar ──────────────────────────────────────────────

interface DailyProgressBarProps {
  completed: number;
  total: number;
  recentStats: DailyStats[];
  todayDate: string;
}

function DailyProgressBar({
  completed,
  total,
  recentStats,
  todayDate,
}: DailyProgressBarProps): React.ReactElement {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const avg = weeklyAverage(recentStats, todayDate);

  return (
    <div className="mb-6 mt-2">
      {/* Bar track */}
      <div className="flex items-center gap-3">
        <div
          className="h-1 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--border-light)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              backgroundColor: progressColor(pct),
            }}
          />
        </div>
        <span
          className="font-mono text-xs font-medium tabular-nums"
          style={{ color: progressColor(pct) }}
        >
          {pct}%
        </span>
      </div>
      {/* 7-day average */}
      {avg !== null && (
        <p className="mt-1 font-mono text-[11px] text-text-muted">
          7-day avg: {avg}%
        </p>
      )}
    </div>
  );
}

interface SortableAgendaTaskRowProps {
  task: AgendaTaskRow;
  planId: string;
  completedTasks: ReadonlySet<string>;
  dailyLoop: UseDailyLoopReturn;
  onEdit: (edit: TaskRowEdit) => void;
  onRemove: (taskId: string) => void;
  onOpenGoalNotes?: (goalId: string, title: string) => void;
  onKeyboardReorder: (taskId: string, direction: -1 | 1) => void;
}

function SortableAgendaTaskRow({
  task,
  planId,
  completedTasks,
  dailyLoop,
  onEdit,
  onRemove,
  onOpenGoalNotes,
  onKeyboardReorder,
}: SortableAgendaTaskRowProps): React.ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.taskId });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const listenerKeyDown =
    typeof listeners.onKeyDown === "function"
      ? (listeners.onKeyDown as (event: KeyboardEvent<HTMLButtonElement>) => void)
      : undefined;
  const handleDragHandleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onKeyboardReorder(task.taskId, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    listenerKeyDown?.(event);
  };
  const dragHandle = (
    <button
      type="button"
      className="touch-none cursor-grab rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent-projects active:cursor-grabbing"
      title={`Drag "${task.title}" to reorder`}
      aria-label={`Drag "${task.title}" to reorder`}
      {...attributes}
      {...listeners}
      onKeyDown={handleDragHandleKeyDown}
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  );
  const goalMetadata = dailyLoop.taskMetadata[task.taskId];
  const eisenhowerQuadrant =
    task.eisenhowerQuadrant ?? goalMetadata?.eisenhowerQuadrant ?? null;
  const openGoalNotes =
    goalMetadata?.goalId && onOpenGoalNotes
      ? () =>
          onOpenGoalNotes(
            goalMetadata.goalId,
            goalMetadata.goalTitle || goalMetadata.goalId,
          )
      : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "relative z-10 opacity-70" : undefined}
    >
      <TaskRow
        taskId={task.taskId}
        title={task.title}
        startTime={task.startTime}
        durationMinutes={task.durationMinutes}
        eisenhowerQuadrant={eisenhowerQuadrant}
        isCompleted={completedTasks.has(task.taskId)}
        onComplete={() => {
          void dailyLoop.toggleTaskCompletion(planId, task.taskId);
        }}
        onDefer={() => {
          void dailyLoop.deferTask(task.taskId);
        }}
        onEdit={onEdit}
        onRemove={() => onRemove(task.taskId)}
        onOpenGoalNotes={openGoalNotes}
        dragHandle={dragHandle}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

interface TodaysPlanProps {
  dailyLoop: UseDailyLoopReturn;
  onOpenGoalNotes?: (goalId: string, title: string) => void;
}

export function TodaysPlan({
  dailyLoop,
  onOpenGoalNotes,
}: TodaysPlanProps): React.ReactElement {
  const {
    plan,
    outcomes,
    isLoading,
    error,
    agendaWarnings,
    date,
    checkIn,
    taskTitles,
    recentStats,
  } = dailyLoop;
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskStartTime, setNewTaskStartTime] = useState("09:00");
  const [newTaskDuration, setNewTaskDuration] = useState("30");
  const undoStackRef = useRef<AgendaTaskRow[][]>([]);
  const [undoDepth, setUndoDepth] = useState(0);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Completed tasks are persisted on the plan in the DB
  const completedTasks = new Set(plan?.completedTaskIds ?? []);
  const scheduledTasks = plan?.scheduledTasks?.length
    ? sortedUniqueScheduledTasks(plan.scheduledTasks)
    : [];
  const hasScheduledTasks = scheduledTasks.length > 0;

  const totalCount = hasScheduledTasks
    ? scheduledTasks.length
    : (plan?.taskOrder?.length ?? 0);
  const completedCount = plan?.completedTaskIds?.length ?? 0;

  // Preserve AI task ordering for legacy plans — only move completed tasks to the bottom
  const sortedTaskOrder = [...(plan?.taskOrder ?? [])].sort((a, b) => {
    const aCompleted = completedTasks.has(a) ? 1 : 0;
    const bCompleted = completedTasks.has(b) ? 1 : 0;
    if (aCompleted !== bCompleted) {
      return aCompleted - bCompleted;
    }

    // Within same completion status, preserve original AI ordering
    return 0;
  });
  const taskRows = hasScheduledTasks
    ? scheduledTasks
    : sortedTaskOrder.map((taskId) => ({
        taskId,
        title: taskTitles[taskId] || humanizeTaskId(taskId),
        startTime: null,
        durationMinutes: null,
        eisenhowerQuadrant:
          dailyLoop.taskMetadata[taskId]?.eisenhowerQuadrant ?? null,
      }));

  const pushUndoSnapshot = (rows: AgendaTaskRow[]): void => {
    const stack = undoStackRef.current;
    const snapshot = cloneAgendaRows(rows);
    if (
      stack.length > 0 &&
      agendaRowsSignature(stack[stack.length - 1] ?? []) ===
        agendaRowsSignature(snapshot)
    ) {
      return;
    }
    stack.push(snapshot);
    if (stack.length > MAX_AGENDA_UNDO_DEPTH) {
      stack.shift();
    }
    setUndoDepth(stack.length);
  };

  const persistTaskRows = async (
    rows: AgendaTaskRow[],
    options: { captureUndo?: boolean } = {},
  ): Promise<void> => {
    if (options.captureUndo !== false) {
      pushUndoSnapshot(taskRows);
    }
    await dailyLoop.updateScheduledTasks(rows.map(scheduledTaskFromRow));
  };

  const undoLastAgendaEdit = (): void => {
    const previous = undoStackRef.current.pop();
    setUndoDepth(undoStackRef.current.length);
    if (!previous) {
      return;
    }
    void persistTaskRows(previous, { captureUndo: false });
  };

  const editTaskRow = (edit: TaskRowEdit): void => {
    const existingRow = taskRows.find((row) => row.taskId === edit.taskId);
    const existingStartMinutes = agendaTimeToMinutes(
      existingRow?.startTime ?? "9:00 AM",
    );
    const editedStartMinutes = agendaTimeToMinutes(edit.startTime);
    const shouldReflowFromEdit =
      Boolean(existingRow) &&
      (existingStartMinutes !== editedStartMinutes ||
        (existingRow?.durationMinutes ?? 30) !== edit.durationMinutes);
    const editedRows = taskRows.map((row) =>
      row.taskId === edit.taskId
        ? {
            ...row,
            title: edit.title,
            startTime: edit.startTime,
            durationMinutes: edit.durationMinutes,
            estimateSource: "manual",
          }
        : row,
    );

    void persistTaskRows(
      shouldReflowFromEdit
        ? reflowAgendaRowsFromTaskId(editedRows, edit.taskId)
        : editedRows,
    );
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const reordered = reorderAgendaRowsByTaskId(
      taskRows,
      String(active.id),
      String(over.id),
    );
    if (reordered === taskRows) {
      return;
    }
    void persistTaskRows(reordered);
  };

  const keyboardReorderTaskRow = (taskId: string, direction: -1 | 1): void => {
    const index = taskRows.findIndex((row) => row.taskId === taskId);
    const target = taskRows[index + direction];
    if (index < 0 || !target) {
      return;
    }
    const reordered = reorderAgendaRowsByTaskId(taskRows, taskId, target.taskId);
    if (reordered === taskRows) {
      return;
    }
    void persistTaskRows(reordered);
  };

  const removeTaskRowsFromAgenda = (
    taskIds: ReadonlySet<string>,
    options: { captureUndo?: boolean } = {},
  ): Promise<void> =>
    persistTaskRows(
      taskRows.filter((row) => !taskIds.has(row.taskId)),
      options,
    );

  const removeTaskRow = (taskId: string): void => {
    void removeTaskRowsFromAgenda(new Set([taskId]));
  };

  const startAddingTask = (): void => {
    setNewTaskStartTime(
      agendaTimeToInputValue(nextAgendaStartTime(taskRows)) || "09:00",
    );
    setNewTaskDuration("30");
    setNewTaskTitle("");
    setIsAddingTask(true);
  };

  const saveNewTask = (): void => {
    const title = newTaskTitle.trim();
    const startTime = timeInputValueToAgendaTime(newTaskStartTime);
    const durationMinutes = Number.parseInt(newTaskDuration, 10);
    if (!title || !startTime || !Number.isFinite(durationMinutes)) {
      return;
    }
    const existingIds = new Set(taskRows.map((row) => row.taskId));
    const taskId = manualTaskId(title, existingIds);
    void persistTaskRows([
      ...taskRows,
      {
        id: `scheduled_${taskId}`,
        taskId,
        title,
        startTime,
        durationMinutes: Math.max(1, durationMinutes),
        estimateSource: "manual",
        eisenhowerQuadrant: null,
      },
    ]);
    setIsAddingTask(false);
    setNewTaskTitle("");
  };

  if (isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-text-muted">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="font-serif text-3xl font-normal"
            style={{ color: "var(--text-primary)" }}
          >
            Agenda
          </h1>
          <p
            className="mt-1 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {date}
            {plan && totalCount > 0 && (
              <span className="text-text-muted">
                {" "}
                &middot; {completedCount} of {totalCount} done
              </span>
            )}
          </p>
        </div>
        {plan && !checkIn && (
          <button
            onClick={() => setShowCheckIn(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-warm"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Check In
          </button>
        )}
      </div>

      {/* Completion progress bar */}
      {plan && totalCount > 0 && (
        <DailyProgressBar
          completed={completedCount}
          total={totalCount}
          recentStats={recentStats}
          todayDate={date}
        />
      )}

      {/* Spacer when no progress bar */}
      {(!plan || totalCount === 0) && <div className="mb-6" />}

      {error && (
        <div className="mb-4 rounded-lg border border-semantic-error/30 bg-semantic-error/5 p-3 text-sm text-semantic-error">
          {error}
        </div>
      )}

      {agendaWarnings.length > 0 && (
        <div
          className="mb-4 rounded-lg border border-progress-low/30 bg-progress-low/5 p-3 text-sm text-text-secondary"
          role="status"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-progress-low" />
            <div>
              <p className="font-medium text-text-primary">
                Agenda needs a small vault repair
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-text-muted">
                {agendaWarnings.slice(0, 3).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  void dailyLoop.openAgendaErrorLog();
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-progress-low/30 px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-progress-low/40"
              >
                <FileText className="h-3.5 w-3.5" />
                Open logs/errors.md
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No plan state */}
      {!plan && <PlanGenerateButton dailyLoop={dailyLoop} />}

      {/* Plan content */}
      {plan && (
        <div className="space-y-6">
          {/* Top 3 Outcomes */}
          {outcomes.length > 0 && (
            <section>
              <h2 className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                Top 3 Outcomes
              </h2>
              <div className="grid gap-3 lg:grid-cols-3">
                {outcomes.map((outcome, i) => (
                  <OutcomeCard
                    key={outcome.id}
                    outcome={outcome}
                    index={i}
                    completedTaskIds={completedTasks}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Ordered Tasks */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                Schedule
              </h2>
              <div className="flex items-center gap-1">
                {undoDepth > 0 && (
                  <button
                    type="button"
                    onClick={undoLastAgendaEdit}
                    className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
                    title="Undo last Agenda edit"
                    aria-label="Undo last Agenda edit"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={startAddingTask}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
                  title="Add Agenda item"
                  aria-label="Add Agenda item"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {isAddingTask && (
              <div className="mb-2 flex items-center gap-2 rounded-md border border-border-light bg-surface px-3 py-2">
                <input
                  aria-label="New Agenda item start time"
                  type="time"
                  step={AGENDA_TIME_INPUT_STEP_SECONDS}
                  value={newTaskStartTime}
                  onChange={(event) => setNewTaskStartTime(event.target.value)}
                  className="w-28 rounded border border-border bg-surface px-2 py-1 font-mono text-xs tabular-nums text-text-secondary outline-none focus:border-accent-projects"
                />
                <input
                  aria-label="New Agenda item title"
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                  className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus:border-accent-projects"
                />
                <input
                  aria-label="New Agenda item duration minutes"
                  type="number"
                  min={1}
                  step={5}
                  value={newTaskDuration}
                  onChange={(event) => setNewTaskDuration(event.target.value)}
                  className="w-16 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text-secondary outline-none focus:border-accent-projects"
                />
                <button
                  type="button"
                  onClick={saveNewTask}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
                  title="Save new Agenda item"
                  aria-label="Save new Agenda item"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingTask(false)}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary"
                  title="Cancel new Agenda item"
                  aria-label="Cancel new Agenda item"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {taskRows.length > 0 ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={taskRows.map((task) => task.taskId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="rounded-lg border border-border-light bg-surface">
                    {taskRows.map((task) => (
                      <SortableAgendaTaskRow
                        key={task.taskId}
                        task={task}
                        planId={plan.id}
                        completedTasks={completedTasks}
                        dailyLoop={dailyLoop}
                        onEdit={editTaskRow}
                        onRemove={removeTaskRow}
                        onOpenGoalNotes={onOpenGoalNotes}
                        onKeyboardReorder={keyboardReorderTaskRow}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <p className="text-sm text-text-muted">
                No tasks in the Agenda yet. Use the add button to create your first item.
              </p>
            )}
          </section>
        </div>
      )}

      <CheckInDialog
        dailyLoop={dailyLoop}
        completedTasks={completedTasks}
        open={showCheckIn}
        onClose={() => setShowCheckIn(false)}
      />
    </main>
  );
}
