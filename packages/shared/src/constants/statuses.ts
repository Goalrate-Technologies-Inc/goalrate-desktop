/**
 * Status Constants
 * Status value constants and display configurations
 */

import type {
  ProjectStatus,
  TaskStatus,
  BoardStatus,
  SprintStatus,
  EpicStatus,
  EntityStatus,
} from '../types/common';

// ============================================================================
// PROJECT STATUS
// ============================================================================

/**
 * All valid project statuses
 */
export const PROJECT_STATUS_VALUES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'archived',
];

/**
 * Project status display configuration
 */
export const PROJECT_STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; color: string; bgColor: string; borderColor: string }
> = {
  planning: {
    label: 'Planning',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
    borderColor: 'border-purple-300',
  },
  active: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-300',
  },
  on_hold: {
    label: 'On Hold',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-300',
  },
  completed: {
    label: 'Completed',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-300',
  },
  archived: {
    label: 'Archived',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-300',
  },
};

// ============================================================================
// TASK STATUS
// ============================================================================

/**
 * All valid task statuses
 */
export const TASK_STATUS_VALUES: TaskStatus[] = [
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

/**
 * Task status display configuration
 */
export const TASK_STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; bgColor: string }
> = {
  todo: {
    label: 'To Do',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  in_review: {
    label: 'In Review',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
  done: {
    label: 'Done',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
};

// ============================================================================
// BOARD STATUS
// ============================================================================

/**
 * All valid board column statuses
 */
export const BOARD_STATUS_VALUES: BoardStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
];

/**
 * Board status display configuration
 */
export const BOARD_STATUS_CONFIG: Record<
  BoardStatus,
  { label: string; color: string; bgColor: string }
> = {
  backlog: {
    label: 'Backlog',
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
  },
  todo: {
    label: 'To Do',
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  review: {
    label: 'Review',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
  done: {
    label: 'Done',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
};

// ============================================================================
// SPRINT STATUS
// ============================================================================

/**
 * All valid sprint statuses
 */
export const SPRINT_STATUS_VALUES: SprintStatus[] = ['future', 'active', 'completed'];

/**
 * Sprint status display configuration
 */
export const SPRINT_STATUS_CONFIG: Record<
  SprintStatus,
  { label: string; color: string; bgColor: string }
> = {
  future: {
    label: 'Future',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
  },
  active: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  completed: {
    label: 'Completed',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
};

// ============================================================================
// EPIC STATUS
// ============================================================================

/**
 * All valid epic statuses
 */
export const EPIC_STATUS_VALUES: EpicStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
];

/**
 * Epic status display configuration
 */
export const EPIC_STATUS_CONFIG: Record<
  EpicStatus,
  { label: string; color: string; bgColor: string }
> = {
  planning: {
    label: 'Planning',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100',
  },
  active: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  on_hold: {
    label: 'On Hold',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
  },
  completed: {
    label: 'Completed',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
  },
};

// ============================================================================
// ENTITY STATUS (Goals)
// ============================================================================

/**
 * All valid entity statuses
 */
export const ENTITY_STATUS_VALUES: EntityStatus[] = ['active', 'completed', 'archived'];

/**
 * Entity status display configuration
 */
export const ENTITY_STATUS_CONFIG: Record<
  EntityStatus,
  { label: string; color: string; bgColor: string }
> = {
  active: {
    label: 'Active',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
  },
  completed: {
    label: 'Completed',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
  },
  archived: {
    label: 'Archived',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
};

// ============================================================================
// STATUS FLOW HELPERS
// ============================================================================

/**
 * Project status workflow transitions
 */
export const PROJECT_STATUS_FLOW: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ['active'],
  active: ['on_hold', 'completed'],
  on_hold: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
};

/**
 * Task status workflow transitions
 */
export const TASK_STATUS_FLOW: Record<TaskStatus, TaskStatus[]> = {
  todo: ['in_progress'],
  in_progress: ['in_review', 'done', 'cancelled'],
  in_review: ['in_progress', 'done'],
  done: [],
  cancelled: [],
};

/**
 * Sprint status workflow transitions
 */
export const SPRINT_STATUS_FLOW: Record<SprintStatus, SprintStatus[]> = {
  future: ['active'],
  active: ['completed'],
  completed: [],
};

/**
 * Check if a status transition is valid
 */
export function isValidTransition<T extends string>(
  current: T,
  next: T,
  flow: Record<T, T[]>
): boolean {
  const validTransitions = flow[current];
  return validTransitions?.includes(next) ?? false;
}

/**
 * Get available transitions from current status
 */
export function getAvailableTransitions<T extends string>(
  current: T,
  flow: Record<T, T[]>
): T[] {
  return flow[current] ?? [];
}
