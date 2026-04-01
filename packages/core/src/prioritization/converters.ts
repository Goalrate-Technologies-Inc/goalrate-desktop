/**
 * Entity Converters
 * Convert domain entities to PrioritizableItem format for classification
 */

import type { Goal, Task, DailyTask, PrioritizableItem } from '@goalrate-app/shared';

/**
 * Convert Goals to prioritizable format
 *
 * @param goals - Goals to convert
 * @returns PrioritizableItems
 */
export function goalsToPrioritizable(goals: Goal[]): PrioritizableItem[] {
  return goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    priority: goal.priority ?? 'medium',
    deadline: goal.deadline,
    due_date: goal.deadline,
    completed: goal.progress === 100,
  }));
}

/**
 * Convert Tasks to prioritizable format
 *
 * @param tasks - Tasks to convert
 * @returns PrioritizableItems
 */
export function tasksToPrioritizable(tasks: Task[]): PrioritizableItem[] {
  return tasks.map((task) => {
    const status = task.status;
    return {
      id: task.id,
      title: task.title,
      priority: task.priority,
      due_date: task.due_date,
      completed: status === 'done' || status === 'cancelled',
      status: task.status,
      estimated_hours: task.estimated_hours,
    };
  });
}

/**
 * Convert DailyTasks to prioritizable format
 *
 * @param tasks - DailyTasks to convert
 * @returns PrioritizableItems
 */
export function dailyTasksToPrioritizable(tasks: DailyTask[]): PrioritizableItem[] {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    completed: task.completed,
    estimated_time: task.estimated_time,
  }));
}

/**
 * Combine multiple entity types into a single prioritizable array
 *
 * @param options - Object containing arrays of each entity type
 * @returns Combined PrioritizableItems array
 */
export function combineEntities(options: {
  goals?: Goal[];
  tasks?: Task[];
  dailyTasks?: DailyTask[];
}): PrioritizableItem[] {
  const result: PrioritizableItem[] = [];

  if (options.goals) {
    result.push(...goalsToPrioritizable(options.goals));
  }
  if (options.tasks) {
    result.push(...tasksToPrioritizable(options.tasks));
  }
  if (options.dailyTasks) {
    result.push(...dailyTasksToPrioritizable(options.dailyTasks));
  }

  return result;
}
