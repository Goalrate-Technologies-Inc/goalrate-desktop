/**
 * Goal Types
 * SMART goal types for the Goalrate application
 * Includes both the existing web app types and PRD-specified types
 */

import type { Priority, EntityStatus, Visibility } from './common';

// ============================================================================
// COLUMN AND SUBTASK TYPES (PRD-specified)
// ============================================================================

/**
 * Kanban column configuration
 */
export interface Column {
  id: string;
  name: string;
  wip?: number; // Work-in-progress limit
}

/**
 * Subtask for goal tasks
 */
export interface Subtask {
  title: string;
  done: boolean;
}

// ============================================================================
// GOAL TYPES (PRD-specified SMART structure)
// ============================================================================

/**
 * Goal structure (vault frontmatter schema)
 *
 * New schema fields: type, start_date, target, current
 * Legacy SMART fields kept for backward compat: specific, measurable, achievable, relevant
 */
export interface SmartGoal {
  id: string;
  title: string;
  /** Shortened version of the title for compact UI contexts */
  shortTitle?: string;
  /** Goal category (e.g. Work, Health, Financial, Personal) */
  type: string;
  status: EntityStatus;
  deadline: string;
  priority: Priority;
  startDate?: string;
  /** Numerical target for progress tracking */
  target?: number;
  /** Current progress toward target */
  current?: number;
  tags: string[];
  /** Confidence score (0-100) */
  confidence?: number;
  why?: string[];
  columns: Column[];
  created: string;
  updated: string;
  /** @deprecated Use `type` instead */
  specific?: string;
  /** @deprecated Use flat `target`/`current` instead */
  measurable?: { unit: string };
  /** @deprecated Use `confidence` instead */
  achievable?: number;
  /** @deprecated Use `why` instead */
  relevant?: string[];
}

/**
 * Goal task for SMART goals (PRD-specified)
 */
export interface GoalTask {
  id: string;
  title: string;
  column: string;
  points: number;
  priority: Priority;
  dueDate?: string;
  completedBy?: string;
  completedAt?: string;
  subtasks: Subtask[];
  publishOnComplete?: boolean;
}

// ============================================================================
// EXISTING WEB APP GOAL TYPES
// ============================================================================

/**
 * Goal interface (existing web app structure)
 */
export interface Goal {
  id: string;
  title: string;
  description: string;
  measurable_target: string;
  deadline: string;
  category: string;
  priority?: string;
  progress?: number; // 0-100
  createdAt: string;
  /** @deprecated Removed from frontmatter schema */
  publishMilestonesOnComplete?: boolean;
}

/**
 * Extended goal from service layer
 */
export interface GoalExtended {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  category?: string;
  deadline?: string;
  start_date?: string;
  progress: number;
  status: EntityStatus;
  visibility: Visibility;
  created_at: string;
  updated_at?: string;
  /** @deprecated Removed from frontmatter schema */
  publishMilestonesOnComplete?: boolean;
}

/**
 * Goal creation data
 */
export interface GoalCreate {
  title: string;
  /** Shortened version of the title */
  shortTitle?: string;
  /** Goal category (Work, Health, Financial, Personal) */
  goalType?: string;
  deadline?: string;
  start_date?: string;
  priority?: string;
  target?: number;
  current?: number;
  /** @deprecated Use `goalType` instead */
  description?: string;
  /** @deprecated Use flat `target` instead */
  measurable_target?: string;
  /** @deprecated Use `goalType` instead */
  category?: string;
  workspace_id?: string;
  visibility?: Visibility;
  activity_note?: {
    text: string;
    media_urls?: string[];
  } | null;
  /** @deprecated Removed from frontmatter schema */
  publishMilestonesOnComplete?: boolean;
}

/**
 * Goal update data
 */
export interface GoalUpdate {
  title?: string;
  description?: string;
  category?: string;
  deadline?: string;
  start_date?: string;
  progress?: number;
  status?: EntityStatus;
  visibility?: Visibility;
  /** @deprecated Removed from frontmatter schema */
  publishMilestonesOnComplete?: boolean;
}

// ============================================================================
// DAILY TASK TYPES
// ============================================================================

/**
 * Daily task for today's focus
 */
export interface DailyTask {
  id: string;
  title: string;
  description?: string;
  estimated_time: number; // in minutes
  priority: Priority;
  category: string;
  completed: boolean;
  ai_generated: boolean;
  created_at: string;
  // Source references for navigation
  source_goal_id?: string;
  source_goal_title?: string;
  source_project_id?: string;
  source_project_title?: string;
  // Task source for navigation
  source?: {
    type: string;
    id?: string;
    title?: string;
  };
}
