/**
 * Desktop Focus List capacity-aware packing.
 *
 * Applies the canonical greedy packing strategy:
 * iterate tasks in their current order and include a task only when adding its
 * story points keeps the packed total within the daily capacity.
 */

import type { FocusListTask } from './listFilter';

export interface PackFocusListTasksInput {
  tasks: FocusListTask[];
  capacitySP: number;
}

export interface PackFocusListTasksResult {
  packedTasks: FocusListTask[];
  overflowTasks: FocusListTask[];
  capacitySP: number;
  packedSP: number;
  remainingSP: number;
}

function normalizeCapacitySP(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
}

function isValidStoryPoints(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Greedily pack sorted Focus List tasks without exceeding daily capacity.
 *
 * Tasks that do not fit remain in `overflowTasks`. Tasks with invalid
 * storyPoints are treated as overflow to keep packing conservative.
 */
export function packFocusListTasks({
  tasks,
  capacitySP,
}: PackFocusListTasksInput): PackFocusListTasksResult {
  const normalizedCapacitySP = normalizeCapacitySP(capacitySP);
  const packedTasks: FocusListTask[] = [];
  const overflowTasks: FocusListTask[] = [];
  let packedSP = 0;

  for (const task of tasks) {
    if (!isValidStoryPoints(task.storyPoints)) {
      overflowTasks.push(task);
      continue;
    }

    if (packedSP + task.storyPoints <= normalizedCapacitySP) {
      packedTasks.push(task);
      packedSP += task.storyPoints;
      continue;
    }

    overflowTasks.push(task);
  }

  return {
    packedTasks,
    overflowTasks,
    capacitySP: normalizedCapacitySP,
    packedSP,
    remainingSP: Math.max(0, normalizedCapacitySP - packedSP),
  };
}
