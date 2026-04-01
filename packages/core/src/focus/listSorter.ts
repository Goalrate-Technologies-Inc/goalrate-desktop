/**
 * Desktop Focus List deterministic sorting.
 *
 * Sort order:
 * 1) deadlineAt when present, otherwise dueAt ascending
 * 2) Priority descending (higher numeric priority first)
 * 3) createdAt ascending
 * 4) id ascending
 * 5) original input order (stability fallback)
 */

import type { FocusListTask } from './listFilter';

function toSortTimestamp(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getEffectiveDueTimestamp(task: FocusListTask): number {
  const deadlineAt = toSortTimestamp(task.deadlineAt);
  const dueAt = toSortTimestamp(task.dueAt);

  if (deadlineAt !== null) {
    return deadlineAt;
  }
  if (dueAt !== null) {
    return dueAt;
  }

  return Number.POSITIVE_INFINITY;
}

function compareAscendingNumbers(a: number, b: number): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

function compareAscendingStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  const commonLength = Math.min(a.length, b.length);
  for (let index = 0; index < commonLength; index += 1) {
    const codePointA = a.charCodeAt(index);
    const codePointB = b.charCodeAt(index);
    if (codePointA !== codePointB) {
      return compareAscendingNumbers(codePointA, codePointB);
    }
  }

  return compareAscendingNumbers(a.length, b.length);
}

/**
 * Compare two tasks using the canonical deterministic Focus List sort key:
 * - deadlineAt when present, otherwise dueAt ascending
 * - priority descending
 * - createdAt ascending
 * - id ascending
 */
export function compareFocusListTasks(
  a: FocusListTask,
  b: FocusListTask
): number {
  const dueAtComparison = compareAscendingNumbers(
    getEffectiveDueTimestamp(a),
    getEffectiveDueTimestamp(b)
  );
  if (dueAtComparison !== 0) {
    return dueAtComparison;
  }

  const priorityComparison = b.priority - a.priority;
  if (priorityComparison !== 0) {
    return priorityComparison;
  }

  const createdAtA = toSortTimestamp(a.createdAt) ?? Number.POSITIVE_INFINITY;
  const createdAtB = toSortTimestamp(b.createdAt) ?? Number.POSITIVE_INFINITY;
  const createdAtComparison = compareAscendingNumbers(createdAtA, createdAtB);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return compareAscendingStrings(a.id, b.id);
}

/**
 * Sort Focus List tasks by due/deadline and priority with deterministic ties.
 * Returns a new array and does not mutate the input.
 */
export function sortFocusListTasks(tasks: FocusListTask[]): FocusListTask[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const comparison = compareFocusListTasks(a.task, b.task);
      if (comparison !== 0) {
        return comparison;
      }

      return a.index - b.index;
    })
    .map(({ task }) => task);
}
