import type {
  DailyAgenda,
  EisenhowerQuadrant,
  Goal,
  ScheduledAgendaTask,
  Task,
} from "./models";

export interface TaskScore {
  taskId: string;
  score: number;
  urgency: number;
  importance: number;
  deadline: number;
  recency: number;
}

export interface AgendaEngineOptions {
  date: string;
  startMinutes?: number;
  maxTasks?: number;
  defaultDurationMinutes?: number;
}

const PRIORITY_IMPORTANCE: Record<string, number> = {
  critical: 1,
  high: 0.9,
  medium: 0.65,
  low: 0.35,
};

const URGENT_DUE_WITHIN_DAYS = 7;

function dateToDay(value: string): number | null {
  const parsed = Date.parse(`${value}T00:00:00`);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.floor(parsed / 86_400_000);
}

function daysUntil(date: string | undefined, today: string): number | null {
  if (!date) {
    return null;
  }
  const targetDay = dateToDay(date);
  const todayDay = dateToDay(today);
  if (targetDay === null || todayDay === null) {
    return null;
  }
  return targetDay - todayDay;
}

function taskUrgencyDate(task: Task): string | undefined {
  return task.dueDate ?? task.scheduledFor;
}

function deadlineScore(task: Task, today: string): number {
  const remainingDays = daysUntil(taskUrgencyDate(task), today);
  if (remainingDays === null) {
    return 0.25;
  }
  if (remainingDays <= 0) {
    return 1;
  }
  if (remainingDays <= 2) {
    return 0.9;
  }
  if (remainingDays <= 7) {
    return 0.7;
  }
  if (remainingDays <= 30) {
    return 0.4;
  }
  return 0.2;
}

function urgencyScore(task: Task, today: string): number {
  const scheduledDelta = daysUntil(task.scheduledFor, today);
  const scheduledScore = scheduledDelta === 0 ? 1 : 0;
  return Math.max(deadlineScore(task, today), scheduledScore);
}

function importanceScore(goal: Goal): number {
  const priority = (goal.priority ?? "medium").toLowerCase();
  return PRIORITY_IMPORTANCE[priority] ?? PRIORITY_IMPORTANCE.medium;
}

function isTaskUrgent(task: Task, today: string): boolean {
  const remainingDays = daysUntil(taskUrgencyDate(task), today);
  return remainingDays !== null && remainingDays <= URGENT_DUE_WITHIN_DAYS;
}

function isGoalImportant(goal: Goal): boolean {
  return importanceScore(goal) >= PRIORITY_IMPORTANCE.medium;
}

function derivedQuadrant(
  task: Task,
  goal: Goal,
  today: string,
): EisenhowerQuadrant {
  const urgent = isTaskUrgent(task, today);
  const important = isGoalImportant(goal);
  if (urgent && important) {
    return "do";
  }
  if (!urgent && important) {
    return "schedule";
  }
  if (urgent && !important) {
    return "delegate";
  }
  return "delete";
}

function recencyScore(task: Task, today: string): number {
  const lastSeenDelta = daysUntil(task.lastSeenOnAgenda, today);
  const base =
    lastSeenDelta === null
      ? 0.5
      : lastSeenDelta >= 14
        ? 0.9
        : lastSeenDelta >= 7
          ? 0.7
          : lastSeenDelta >= 2
            ? 0.45
            : 0.2;
  const deferralBoost = Math.min((task.deferralCount ?? 0) * 0.1, 0.3);
  return Math.min(base + deferralBoost, 1);
}

function isPendingForAgenda(task: Task): boolean {
  return !["completed", "done", "archived", "blocked"].includes(task.status);
}

function isScheduledForAgendaDate(task: Task, today: string): boolean {
  return !task.scheduledFor || task.scheduledFor === today;
}

function inheritParentPlanningFields(task: Task, parent?: Task): Task {
  if (!parent) {
    return task;
  }
  return {
    ...task,
    dueDate: task.dueDate ?? parent.dueDate,
    scheduledFor: task.scheduledFor ?? parent.scheduledFor,
    priority: task.priority ?? parent.priority,
    eisenhowerQuadrant: task.eisenhowerQuadrant ?? parent.eisenhowerQuadrant,
  };
}

function agendaCandidatesFromTask(task: Task, parent?: Task): Task[] {
  if (!isPendingForAgenda(task)) {
    return [];
  }

  const activeSubtasks = (task.subtasks ?? []).flatMap((subtask) =>
    agendaCandidatesFromTask(subtask, task),
  );

  if (activeSubtasks.length > 0) {
    return activeSubtasks;
  }

  return [inheritParentPlanningFields(task, parent)];
}

export function scoreTaskForAgenda(
  task: Task,
  goal: Goal,
  today: string,
): TaskScore {
  const urgency = urgencyScore(task, today);
  const importance = importanceScore(goal);
  const deadline = deadlineScore(task, today);
  const recency = recencyScore(task, today);
  const score = urgency * 40 + importance * 35 + deadline * 15 + recency * 10;

  return {
    taskId: task.id,
    score: Number(score.toFixed(4)),
    urgency,
    importance,
    deadline,
    recency,
  };
}

export function loadActiveGoals(goals: Goal[]): Goal[] {
  return goals.filter((goal) => goal.status === "active");
}

export function loadPendingTasks(
  goals: Goal[],
  today: string,
): Array<{ goal: Goal; task: Task }> {
  return loadActiveGoals(goals).flatMap((goal) =>
    goal.tasks
      .flatMap((task) => agendaCandidatesFromTask(task))
      .filter((task) => isScheduledForAgendaDate(task, today))
      .map((task) => ({ goal, task })),
  );
}

function sortRank(quadrant?: EisenhowerQuadrant): number {
  if (quadrant === "do") {
    return 0;
  }
  if (quadrant === "schedule") {
    return 1;
  }
  if (quadrant === "delegate") {
    return 2;
  }
  if (quadrant === "delete") {
    return 3;
  }
  return 1;
}

function formatMinutes(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function formatIsoTime(minutes: number): string {
  const hour24 = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export function generateDailyAgenda(
  goals: Goal[],
  options: AgendaEngineOptions,
): DailyAgenda {
  const maxTasks = options.maxTasks ?? 7;
  const defaultDurationMinutes = options.defaultDurationMinutes ?? 45;
  const startMinutes = options.startMinutes ?? 9 * 60;
  const rankedCandidates = loadPendingTasks(goals, options.date)
    .map(({ goal, task }) => ({
      goal,
      task,
      score: scoreTaskForAgenda(task, goal, options.date),
    }))
    .sort((a, b) => {
      const byScore = b.score.score - a.score.score;
      if (byScore !== 0) {
        return byScore;
      }
      const byQuadrant =
        sortRank(derivedQuadrant(a.task, a.goal, options.date)) -
        sortRank(derivedQuadrant(b.task, b.goal, options.date));
      if (byQuadrant !== 0) {
        return byQuadrant;
      }
      const aDue = a.task.dueDate ?? a.goal.deadline ?? "9999-12-31";
      const bDue = b.task.dueDate ?? b.goal.deadline ?? "9999-12-31";
      return (
        aDue.localeCompare(bDue) ||
        a.goal.title.localeCompare(b.goal.title) ||
        a.task.title.localeCompare(b.task.title) ||
        a.task.id.localeCompare(b.task.id)
      );
    });
  const exactDayCandidates = rankedCandidates.filter(
    ({ task }) => task.scheduledFor === options.date,
  );
  const flexibleCandidates = rankedCandidates.filter(
    ({ task }) => task.scheduledFor !== options.date,
  );
  const candidates = [
    ...exactDayCandidates,
    ...flexibleCandidates.slice(
      0,
      Math.max(0, maxTasks - exactDayCandidates.length),
    ),
  ];

  const scheduledTasks: ScheduledAgendaTask[] = candidates.map(
    ({ goal, task, score }, index) => ({
      id: `scheduled_${task.id}`,
      taskId: task.id,
      title: task.title,
      startTime: formatMinutes(startMinutes + index * defaultDurationMinutes),
      durationMinutes: defaultDurationMinutes,
      estimateSource: "inferred",
      eisenhowerQuadrant: derivedQuadrant(task, goal, options.date),
      score: score.score,
    }),
  );

  const generatedAt = `${options.date}T${formatIsoTime(startMinutes)}`;
  return {
    id: `agenda_${options.date.replaceAll("-", "_")}`,
    date: options.date,
    status: "active",
    generatedAt,
    generatedBy: "heuristic",
    scheduledTasks,
    topOutcomeIds: [],
    completedTaskIds: [],
  };
}
