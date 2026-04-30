import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Goal, Task } from "../../domain";
import { evaluateMissedWork, type MissedWorkDecision } from "../../domain";
import { useVault } from "../../context/VaultContext";
import type { UseDailyLoopReturn } from "../../hooks/useDailyLoop";
import * as dailyLoopIpc from "../../lib/dailyLoopIpc";

interface AssistantMissedWorkProps {
  dailyLoop: UseDailyLoopReturn;
}

interface GoalIpc {
  id: string;
  title?: string;
  status?: string;
  created?: string;
  updated?: string;
  domain?: string;
  type?: string;
  goalType?: string;
  deadline?: string;
  priority?: string;
  eisenhowerQuadrant?: string | null;
  eisenhower_quadrant?: string | null;
}

interface GoalTaskIpc {
  id: string;
  title: string;
  status?: string;
  created?: string | null;
  createdAt?: string | null;
  updated?: string | null;
  updatedAt?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  due_date?: string | null;
  parentId?: string | null;
  parent_id?: string | null;
  generatedFromTaskId?: string | null;
  generated_from_task_id?: string | null;
  completedAt?: string | null;
  completed_at?: string | null;
  firstSeenOnAgenda?: string | null;
  first_seen_on_agenda?: string | null;
  lastSeenOnAgenda?: string | null;
  last_seen_on_agenda?: string | null;
  lastMissedDecisionOn?: string | null;
  last_missed_decision_on?: string | null;
  eisenhowerQuadrant?: string | null;
  eisenhower_quadrant?: string | null;
}

const GOAL_STATUSES = new Set<Goal["status"]>([
  "created",
  "active",
  "paused",
  "completed",
  "abandoned",
  "archived",
]);

const TASK_STATUSES = new Set<Task["status"]>([
  "todo",
  "pending",
  "in_progress",
  "deferred",
  "blocked",
  "completed",
  "done",
  "archived",
]);

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  return "Unable to load missed work.";
}

function firstString(
  ...values: Array<string | null | undefined>
): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function normalizeGoalStatus(status: string | undefined): Goal["status"] {
  return status && GOAL_STATUSES.has(status as Goal["status"])
    ? (status as Goal["status"])
    : "active";
}

function normalizeTaskStatus(status: string | undefined): Task["status"] {
  return status && TASK_STATUSES.has(status as Task["status"])
    ? (status as Task["status"])
    : "todo";
}

function taskParentId(task: GoalTaskIpc): string | undefined {
  return firstString(
    task.parentId,
    task.parent_id,
    task.generatedFromTaskId,
    task.generated_from_task_id,
  );
}

function taskFromIpc(goalId: string, task: GoalTaskIpc): Task | null {
  if (!task.id || !task.title) {
    return null;
  }

  return {
    id: task.id,
    goalId,
    title: task.title,
    status: normalizeTaskStatus(task.status),
    createdAt: firstString(task.createdAt, task.created),
    updatedAt: firstString(task.updatedAt, task.updated),
    priority: firstString(task.priority),
    dueDate: firstString(task.dueDate, task.due_date),
    completedAt: firstString(task.completedAt, task.completed_at),
    firstSeenOnAgenda: firstString(
      task.firstSeenOnAgenda,
      task.first_seen_on_agenda,
    ),
    lastSeenOnAgenda: firstString(
      task.lastSeenOnAgenda,
      task.last_seen_on_agenda,
    ),
    lastMissedDecisionOn: firstString(
      task.lastMissedDecisionOn,
      task.last_missed_decision_on,
    ),
    eisenhowerQuadrant: firstString(
      task.eisenhowerQuadrant,
      task.eisenhower_quadrant,
    ) as Task["eisenhowerQuadrant"],
    parentTaskId: taskParentId(task),
    subtasks: [],
  };
}

function buildTaskTree(goalId: string, tasks: GoalTaskIpc[]): Task[] {
  const byId = new Map<string, Task>();

  for (const rawTask of tasks) {
    const task = taskFromIpc(goalId, rawTask);
    if (task) {
      byId.set(task.id, task);
    }
  }

  const roots: Task[] = [];
  for (const task of byId.values()) {
    if (task.parentTaskId) {
      const parent = byId.get(task.parentTaskId);
      if (parent) {
        parent.subtasks = [...(parent.subtasks ?? []), task];
        continue;
      }
    }
    roots.push(task);
  }

  return roots;
}

function goalFromIpc(goal: GoalIpc, tasks: GoalTaskIpc[]): Goal {
  return {
    id: goal.id,
    title: goal.title ?? goal.id,
    status: normalizeGoalStatus(goal.status),
    createdAt: goal.created ?? "",
    updatedAt: goal.updated,
    domain: goal.domain ?? goal.goalType ?? goal.type,
    deadline: goal.deadline,
    priority: goal.priority,
    eisenhowerQuadrant: firstString(
      goal.eisenhowerQuadrant,
      goal.eisenhower_quadrant,
    ) as Goal["eisenhowerQuadrant"],
    tasks: buildTaskTree(goal.id, tasks),
  };
}

async function loadMissedWorkGoals(vaultId: string): Promise<Goal[]> {
  const goals = await invoke<GoalIpc[]>("list_goals", { vaultId });
  const taskEntries = await Promise.all(
    goals.map(async (goal) => {
      const tasks = await invoke<GoalTaskIpc[]>("list_goal_frontmatter_tasks", {
        vaultId,
        goalId: goal.id,
      });
      return [goal.id, tasks] as const;
    }),
  );
  const tasksByGoalId = new Map(taskEntries);
  return goals.map((goal) =>
    goalFromIpc(goal, tasksByGoalId.get(goal.id) ?? []),
  );
}

function promptForDecision(
  decision: MissedWorkDecision,
  action:
    | "break_down"
    | "continue_subtask"
    | "different_subtask"
    | "reconsider_parent"
    | "different_task"
    | "archive_parent_task"
    | "archive_goal",
): string {
  if (action === "break_down") {
    return `Break down "${decision.title}" into subtasks because it has been on the Agenda for ${decision.daysOnAgenda} days without being completed. Validate the vault schema before writing and log any mutations.`;
  }
  if (action === "continue_subtask") {
    return `Keep the subtask "${decision.title}" on tomorrow's Agenda and preserve the parent Task relationship.`;
  }
  if (action === "different_subtask") {
    return `Generate a different subtask for the parent Task of "${decision.title}" because this Subtask has been on the Agenda for ${decision.daysOnAgenda} days without being completed.`;
  }
  if (action === "different_task") {
    return `Generate a different task for the Goal containing "${decision.title}" because this Subtask has been on the Agenda for ${decision.daysOnAgenda} days without being completed.`;
  }
  if (action === "archive_parent_task") {
    return `Archive the parent Task branch for "${decision.title}" and keep the Goal active.`;
  }
  if (action === "archive_goal") {
    return `Archive the Goal containing "${decision.title}" and stop planning it.`;
  }
  return `Help me decide whether to continue the parent Task for "${decision.title}" or change approach.`;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + 1);
  const nextYear = next.getFullYear();
  const nextMonth = String(next.getMonth() + 1).padStart(2, "0");
  const nextDay = String(next.getDate()).padStart(2, "0");
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

export function AssistantMissedWork({
  dailyLoop,
}: AssistantMissedWorkProps): React.ReactElement | null {
  const { currentVault } = useVault();
  const vaultId = currentVault?.id ?? "";
  const [decisions, setDecisions] = useState<MissedWorkDecision[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  const [confirmingGoalArchiveTaskId, setConfirmingGoalArchiveTaskId] =
    useState<string | null>(null);

  useEffect(() => {
    if (!vaultId) {
      return;
    }

    let cancelled = false;

    async function load(): Promise<void> {
      setIsLoading(true);
      setLoadError(null);
      try {
        const goals = await loadMissedWorkGoals(vaultId);
        const nextDecisions = evaluateMissedWork(goals, {
          today: dailyLoop.date,
        });
        if (!cancelled) {
          setDecisions(nextDecisions);
        }
      } catch (err) {
        if (!cancelled) {
          setDecisions([]);
          setLoadError(extractErrorMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [vaultId, dailyLoop.date, dailyLoop.dataVersion]);

  const sendDecision = useCallback(
    async (
      decision: MissedWorkDecision,
      action:
        | "break_down"
        | "continue_subtask"
        | "different_subtask"
        | "reconsider_parent"
        | "different_task"
        | "archive_parent_task"
        | "archive_goal",
    ) => {
      if (!dailyLoop.plan || pendingTaskId) {
        return;
      }
      setActionError(null);
      setPendingTaskId(decision.taskId);
      try {
        if (action === "continue_subtask") {
          await dailyLoopIpc.scheduleTaskForDate({
            vaultId,
            taskId: decision.taskId,
            title: decision.title,
            date: nextDate(dailyLoop.date),
            estimateSource: "manual",
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
        } else if (action === "different_subtask") {
          await dailyLoopIpc.generateAlternativeSubtask({
            vaultId,
            missedTaskId: decision.taskId,
            parentTaskId: decision.parentTaskId,
            missedTitle: decision.title,
            date: nextDate(dailyLoop.date),
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
        } else if (action === "reconsider_parent") {
          await dailyLoopIpc.scheduleParentTaskForMissedSubtask({
            vaultId,
            missedTaskId: decision.taskId,
            parentTaskId: decision.parentTaskId,
            date: nextDate(dailyLoop.date),
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
        } else if (action === "different_task") {
          await dailyLoopIpc.generateAlternativeTask({
            vaultId,
            missedTaskId: decision.taskId,
            parentTaskId: decision.parentTaskId,
            date: nextDate(dailyLoop.date),
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
          setConfirmingTaskId(null);
          setConfirmingGoalArchiveTaskId(null);
        } else if (action === "archive_parent_task") {
          await dailyLoopIpc.archiveParentTaskForMissedSubtask({
            vaultId,
            missedTaskId: decision.taskId,
            parentTaskId: decision.parentTaskId,
            date: nextDate(dailyLoop.date),
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
          setConfirmingTaskId(null);
          setConfirmingGoalArchiveTaskId(null);
        } else if (action === "archive_goal") {
          await dailyLoopIpc.archiveGoalForMissedSubtask({
            vaultId,
            missedTaskId: decision.taskId,
            parentTaskId: decision.parentTaskId,
            date: nextDate(dailyLoop.date),
          });
          setDecisions((current) =>
            current.filter((item) => item.taskId !== decision.taskId),
          );
          setConfirmingTaskId(null);
          setConfirmingGoalArchiveTaskId(null);
        } else {
          await dailyLoop.sendChat(promptForDecision(decision, action));
        }
        await dailyLoop.refresh();
      } catch (err) {
        setActionError(extractErrorMessage(err));
      } finally {
        setPendingTaskId(null);
      }
    },
    [dailyLoop, pendingTaskId, vaultId],
  );

  const showLoadingState = isLoading && (decisions.length > 0 || !!loadError);

  if (!vaultId || (!showLoadingState && !loadError && decisions.length === 0)) {
    return null;
  }

  const visibleDecisions = decisions.slice(0, 3);

  return (
    <section
      className="rounded-lg border border-border-light bg-surface p-3"
      aria-label="Missed work attention items"
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-progress-mid" />
        <h3 className="font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Needs attention
        </h3>
      </div>

      {showLoadingState && (
        <div
          className="flex items-center gap-2 text-sm text-text-muted"
          role="status"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking missed work...
        </div>
      )}

      {loadError && (
        <p className="text-sm text-semantic-error" role="alert">
          {loadError}
        </p>
      )}

      {actionError && (
        <p className="mb-2 text-sm text-semantic-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="space-y-3">
        {visibleDecisions.map((decision) => (
          <div
            key={`${decision.type}:${decision.taskId}`}
            className="space-y-2"
          >
            <p className="text-sm text-text-secondary">
              {decision.type === "break_down_task"
                ? `Break "${decision.title}" into smaller steps.`
                : `Decide whether to continue "${decision.title}".`}
            </p>
            {decision.type === "break_down_task" ? (
              <button
                type="button"
                onClick={() => void sendDecision(decision, "break_down")}
                disabled={!dailyLoop.plan || pendingTaskId === decision.taskId}
                className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                aria-label={`Ask Assistant to break down "${decision.title}"`}
              >
                Break down
              </button>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    void sendDecision(decision, "continue_subtask")
                  }
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Continue Subtask "${decision.title}"`}
                >
                  Continue
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void sendDecision(decision, "different_subtask")
                  }
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Try a different Subtask for "${decision.title}"`}
                >
                  Different step
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void sendDecision(decision, "reconsider_parent")
                  }
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Reconsider parent Task for "${decision.title}"`}
                >
                  Parent task
                </button>
                <button
                  type="button"
                  onClick={() => void sendDecision(decision, "different_task")}
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Try a different Task for "${decision.title}"`}
                >
                  Different task
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingTaskId(decision.taskId);
                    setConfirmingGoalArchiveTaskId(null);
                  }}
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Continue Goal for "${decision.title}"`}
                >
                  Keep goal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingGoalArchiveTaskId(decision.taskId);
                    setConfirmingTaskId(null);
                  }}
                  disabled={
                    !dailyLoop.plan || pendingTaskId === decision.taskId
                  }
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                  aria-label={`Archive Goal for "${decision.title}"`}
                >
                  Stop goal
                </button>
              </div>
            )}
            {decision.type === "continue_subtask_decision" &&
              confirmingTaskId === decision.taskId && (
                <div
                  className="space-y-1 pt-1"
                  role="group"
                  aria-label={`Confirm Goal continuation for "${decision.title}"`}
                >
                  <p className="text-xs text-text-muted">
                    Archive this Task branch and keep the Goal active?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        void sendDecision(decision, "archive_parent_task")
                      }
                      disabled={
                        !dailyLoop.plan || pendingTaskId === decision.taskId
                      }
                      className="rounded-md border border-progress-mid px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                      aria-label={`Confirm archiving parent Task for "${decision.title}"`}
                    >
                      Archive task
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingTaskId(null);
                        setConfirmingGoalArchiveTaskId(null);
                      }}
                      disabled={pendingTaskId === decision.taskId}
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                      aria-label={`Cancel Goal continuation for "${decision.title}"`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            {decision.type === "continue_subtask_decision" &&
              confirmingGoalArchiveTaskId === decision.taskId && (
                <div
                  className="space-y-1 pt-1"
                  role="group"
                  aria-label={`Confirm Goal archive for "${decision.title}"`}
                >
                  <p className="text-xs text-text-muted">
                    Archive this Goal and stop planning it?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        void sendDecision(decision, "archive_goal")
                      }
                      disabled={
                        !dailyLoop.plan || pendingTaskId === decision.taskId
                      }
                      className="rounded-md border border-semantic-error px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                      aria-label={`Confirm archiving Goal for "${decision.title}"`}
                    >
                      Archive goal
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmingGoalArchiveTaskId(null);
                        setConfirmingTaskId(null);
                      }}
                      disabled={pendingTaskId === decision.taskId}
                      className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-50"
                      aria-label={`Cancel Goal archive for "${decision.title}"`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
          </div>
        ))}
      </div>
    </section>
  );
}
