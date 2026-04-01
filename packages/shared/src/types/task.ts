/**
 * Task Types
 * Task and sub-task types for project management
 */

import type { TaskStatus, ExtendedPriority } from './common';

// ============================================================================
// TASK TYPE CATEGORIES
// ============================================================================

/**
 * Task type categories
 */
export type TaskType = 'task' | 'sub_task' | 'bug' | 'improvement' | 'test';

/**
 * Task severity levels (for bugs)
 */
export type TaskSeverity = 'trivial' | 'minor' | 'major' | 'critical' | 'blocker';

// ============================================================================
// TASK CONSTANTS
// ============================================================================

/**
 * Task workflow status constants
 */
export const TASK_STATUSES = {
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
  CANCELLED: 'cancelled',
} as const;

/**
 * Task priority constants
 */
export const TASK_PRIORITIES = {
  LOWEST: 'lowest',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  HIGHEST: 'highest',
} as const;

/**
 * Task type constants
 */
export const TASK_TYPES = {
  TASK: 'task',
  SUB_TASK: 'sub_task',
  BUG: 'bug',
  IMPROVEMENT: 'improvement',
  TEST: 'test',
} as const;

// ============================================================================
// TASK ATTACHMENT AND COMMENTS
// ============================================================================

/**
 * Task attachment
 */
export interface TaskAttachment {
  id: string;
  filename: string;
  url: string;
  file_type: string;
  file_size: number;
  uploaded_by: string;
  uploaded_at: string;
}

/**
 * Task comment
 */
export interface TaskComment {
  id: string;
  content: string;
  author_id: string;
  created_at: string;
  updated_at?: string;
  is_internal?: boolean; // Internal team comments vs client-visible
}

// ============================================================================
// TASK TYPES
// ============================================================================

/**
 * Task interface
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: ExtendedPriority;
  epic_id?: string;
  project_id: string;
  assignee_id?: string;
  reporter_id: string;
  task_type: TaskType;
  created_at: string;
  updated_at: string;
  resolution_date?: string;
  estimated_hours?: number;
  time_spent?: number;
  remaining_time?: number;
  due_date?: string;

  // Task hierarchy support
  parent_task_id?: string; // For sub-tasks
  sub_task_ids?: string[]; // For parent tasks with sub-tasks

  // Task relationships
  blockers?: string[]; // Task IDs that block this task
  blocked_by?: string[]; // Task IDs blocked by this task
  relates_to?: string[]; // Related task IDs

  // Task metadata
  labels?: string[];
  components?: string[];
  attachments?: TaskAttachment[];
  comments?: TaskComment[];
  watchers?: string[]; // User IDs watching this task
  acceptance_criteria?: string[];

  // Workflow fields
  resolution?: string; // How task was resolved
  environment?: string; // Environment where task applies
  severity?: TaskSeverity;
  affects_versions?: string[];
  fix_versions?: string[];
}

/**
 * Sub-task interface (extends Task with restrictions)
 */
export interface SubTask extends Omit<Task, 'task_type' | 'sub_task_ids'> {
  task_type: 'sub_task';
  parent_task_id: string; // Required for sub-tasks
  sub_task_ids?: never; // Sub-tasks cannot have sub-tasks
}

// ============================================================================
// TASK CREATE/UPDATE
// ============================================================================

/**
 * Task creation data
 */
export interface TaskCreate {
  title: string;
  description?: string;
  assignee_id?: string;
  task_type?: TaskType;
  priority?: ExtendedPriority;
  estimated_hours?: number;
  due_date?: string;
  parent_task_id?: string; // For creating sub-tasks
  labels?: string[];
  components?: string[];
  acceptance_criteria?: string[];
}

/**
 * Task update data
 */
export interface TaskUpdate extends Partial<TaskCreate> {
  status?: TaskStatus;
  time_spent?: number;
  remaining_time?: number;
  resolution?: string;
  resolution_date?: string;
}

// ============================================================================
// TASK HIERARCHY
// ============================================================================

/**
 * Task hierarchy with related tasks
 */
export interface TaskHierarchy {
  task: Task;
  subTasks: SubTask[];
  parentTask?: Task;
  blockedTasks: Task[];
  blockingTasks: Task[];
}

// ============================================================================
// TASK PROGRESS
// ============================================================================

/**
 * Task progress summary
 */
export interface TaskProgress {
  total: number;
  todo: number;
  inProgress: number;
  inReview: number;
  done: number;
  cancelled: number;
  percentComplete: number;
  estimatedHours: number;
  timeSpent: number;
  remainingHours: number;
}

// ============================================================================
// LEGACY TASK TYPES (from index.ts)
// ============================================================================

/**
 * Legacy task interface (backward compatibility)
 */
export interface LegacyTask {
  id: string;
  title: string;
  description?: string;
  list_id?: string;
  board_id?: string;
  created_by: string;
  assignee_id?: string;
  completed: boolean;
  priority?: 'low' | 'medium' | 'high';
  task_type?: 'development' | 'testing' | 'documentation' | 'research' | 'review';
  estimated_hours?: number;
  actual_hours?: number;
  status?: 'not_started' | 'in_progress' | 'review' | 'blocked' | 'completed';
  ai_generated?: boolean;
  due_date?: string;
  created_at: string;
  updated_at: string;
  dependencies?: string[];
  blocks?: string[];
}
