import type { Goal, Task } from "./models";

export type MissedWorkDecisionType =
  | "break_down_task"
  | "continue_subtask_decision";

export interface MissedWorkDecision {
  type: MissedWorkDecisionType;
  goalId: string;
  taskId: string;
  title: string;
  firstSeenOnAgenda: string;
  daysOnAgenda: number;
  parentTaskId?: string;
}

export interface MissedWorkOptions {
  today: string;
  thresholdDays?: number;
}

function dateToDay(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00`);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 86_400_000);
}

function daysSince(firstSeenOnAgenda: string | undefined, today: string): number | null {
  if (!firstSeenOnAgenda) {
    return null;
  }
  const firstSeenDay = dateToDay(firstSeenOnAgenda);
  const todayDay = dateToDay(today);
  if (firstSeenDay === null || todayDay === null) {
    return null;
  }
  return todayDay - firstSeenDay;
}

function agendaRecencyDate(task: Task): string | undefined {
  return [
    task.firstSeenOnAgenda,
    task.lastSeenOnAgenda,
    task.lastMissedDecisionOn,
  ].reduce<string | undefined>((latest, value) => {
    if (!value) {
      return latest;
    }
    if (!latest) {
      return value;
    }
    const latestDay = dateToDay(latest);
    const valueDay = dateToDay(value);
    if (latestDay === null || valueDay === null) {
      return latest;
    }
    return valueDay > latestDay ? value : latest;
  }, undefined);
}

function isUnfinished(task: Task): boolean {
  return !["completed", "done", "archived"].includes(task.status);
}

function hasSubtasks(task: Task): boolean {
  return (task.subtasks ?? []).some((subtask) => subtask.status !== "archived");
}

function walkTasks(tasks: Task[], visit: (task: Task) => void): void {
  for (const task of tasks) {
    visit(task);
    walkTasks(task.subtasks ?? [], visit);
  }
}

export function evaluateMissedWork(
  goals: Goal[],
  options: MissedWorkOptions,
): MissedWorkDecision[] {
  const thresholdDays = options.thresholdDays ?? 2;
  const decisions: MissedWorkDecision[] = [];

  for (const goal of goals) {
    if (goal.status !== "active") {
      continue;
    }

    walkTasks(goal.tasks, (task) => {
      if (!isUnfinished(task)) {
        return;
      }
      const daysOnAgenda = daysSince(agendaRecencyDate(task), options.today);
      if (daysOnAgenda === null || daysOnAgenda < thresholdDays) {
        return;
      }

      if (task.parentTaskId) {
        decisions.push({
          type: "continue_subtask_decision",
          goalId: goal.id,
          taskId: task.id,
          parentTaskId: task.parentTaskId,
          title: task.title,
          firstSeenOnAgenda: task.firstSeenOnAgenda ?? task.lastSeenOnAgenda ?? options.today,
          daysOnAgenda,
        });
        return;
      }

      if (!hasSubtasks(task)) {
        decisions.push({
          type: "break_down_task",
          goalId: goal.id,
          taskId: task.id,
          title: task.title,
          firstSeenOnAgenda: task.firstSeenOnAgenda ?? task.lastSeenOnAgenda ?? options.today,
          daysOnAgenda,
        });
      }
    });
  }

  return decisions;
}
