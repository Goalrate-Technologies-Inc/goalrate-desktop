/**
 * Desktop Focus List eligibility filtering.
 *
 * Filters tasks down to items that can be considered for Focus List packing.
 */

/**
 * Focus task status values used for Desktop Focus List filtering.
 */
export type FocusListTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

/**
 * Minimal task shape required for Focus List eligibility filtering.
 */
export interface FocusListTask {
  id: string;
  vaultId: string;
  title: string;
  dueAt: string | null;
  deadlineAt: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  storyPoints: number;
  status: FocusListTaskStatus;
  assignedToUserId: string;
  createdAt: string;
}

/**
 * Default statuses eligible for Focus List filtering.
 */
export const DEFAULT_FOCUS_LIST_ELIGIBLE_STATUSES = [
  'todo',
  'in_progress',
] as const;

/**
 * Input for Focus List candidate filtering.
 */
export interface FilterFocusListTasksInput {
  tasks: FocusListTask[];
  userId: string;
  openVaultIds?: string[];
  eligibleStatuses?: FocusListTaskStatus[];
}

/**
 * Returns only tasks eligible for Focus List generation.
 *
 * Eligibility rules:
 * - Assigned to the current user
 * - Task status is in the eligible status list (defaults to todo + in_progress)
 * - Completed and blocked tasks are always excluded
 * - Story points are a valid positive number
 * - Open-vault filter: task must belong to an open vault.
 *   Missing or empty openVaultIds fails closed and yields no eligible tasks.
 */
export function filterFocusListTasks({
  tasks,
  userId,
  openVaultIds,
  eligibleStatuses,
}: FilterFocusListTasksInput): FocusListTask[] {
  if (!openVaultIds || openVaultIds.length === 0) {
    return [];
  }

  const allowedStatuses = new Set<FocusListTaskStatus>(
    eligibleStatuses ?? [...DEFAULT_FOCUS_LIST_ELIGIBLE_STATUSES]
  );
  const allowedVaultIds = new Set(openVaultIds);

  return tasks.filter((task) => {
    if (task.assignedToUserId !== userId) {
      return false;
    }

    // Completed and blocked tasks are never eligible for Focus List planning.
    if (task.status === 'blocked' || task.status === 'done') {
      return false;
    }

    if (!allowedStatuses.has(task.status)) {
      return false;
    }

    if (!Number.isFinite(task.storyPoints) || task.storyPoints <= 0) {
      return false;
    }

    if (!allowedVaultIds.has(task.vaultId)) {
      return false;
    }

    return true;
  });
}
