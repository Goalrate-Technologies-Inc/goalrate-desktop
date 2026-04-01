/**
 * Task Schemas
 * Task, sub-task, and task hierarchy schemas
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import { taskStatusSchema, extendedPrioritySchema } from './common';

// ============================================================================
// TASK ENUMS
// ============================================================================

/**
 * Task type categories
 */
export const taskTypeSchema = z.enum(['task', 'sub_task', 'bug', 'improvement', 'test']);

/**
 * Task severity levels (for bugs)
 */
export const taskSeveritySchema = z.enum(['trivial', 'minor', 'major', 'critical', 'blocker']);

// ============================================================================
// TASK ATTACHMENT AND COMMENT SCHEMAS
// ============================================================================

/**
 * Task attachment
 */
export const taskAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string().min(1).max(255),
  url: z.string().url(),
  file_type: z.string(),
  file_size: z.number().int().positive(),
  uploaded_by: z.string(),
  uploaded_at: z.string(),
});

/**
 * Task comment
 */
export const taskCommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(5000),
  author_id: z.string(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  is_internal: z.boolean().optional(), // Internal team comments vs client-visible
});

// ============================================================================
// TASK SCHEMAS
// ============================================================================

/**
 * Task interface
 */
export const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: taskStatusSchema,
  priority: extendedPrioritySchema,
  epic_id: z.string().optional(),
  project_id: z.string(),
  assignee_id: z.string().optional(),
  reporter_id: z.string(),
  task_type: taskTypeSchema,
  created_at: z.string(),
  updated_at: z.string(),
  resolution_date: z.string().optional(),
  estimated_hours: z.number().nonnegative().optional(),
  time_spent: z.number().nonnegative().optional(),
  remaining_time: z.number().nonnegative().optional(),
  due_date: z.string().optional(),

  // Task hierarchy support
  parent_task_id: z.string().optional(), // For sub-tasks
  sub_task_ids: z.array(z.string()).optional(), // For parent tasks with sub-tasks

  // Task relationships
  blockers: z.array(z.string()).optional(), // Task IDs that block this task
  blocked_by: z.array(z.string()).optional(), // Task IDs blocked by this task
  relates_to: z.array(z.string()).optional(), // Related task IDs

  // Task metadata
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  attachments: z.array(taskAttachmentSchema).optional(),
  comments: z.array(taskCommentSchema).optional(),
  watchers: z.array(z.string()).optional(), // User IDs watching this task
  acceptance_criteria: z.array(z.string()).optional(),

  // Workflow fields
  resolution: z.string().optional(), // How task was resolved
  environment: z.string().optional(), // Environment where task applies
  severity: taskSeveritySchema.optional(),
  affects_versions: z.array(z.string()).optional(),
  fix_versions: z.array(z.string()).optional(),
});

/**
 * Sub-task schema (extends Task with restrictions)
 */
export const subTaskSchema = taskSchema.extend({
  task_type: z.literal('sub_task'),
  parent_task_id: z.string(), // Required for sub-tasks
  sub_task_ids: z.never().optional(), // Sub-tasks cannot have sub-tasks
});

// ============================================================================
// TASK CREATE/UPDATE SCHEMAS
// ============================================================================

/**
 * Task creation schema
 */
export const taskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  assignee_id: z.string().optional(),
  task_type: taskTypeSchema.optional(),
  priority: extendedPrioritySchema.optional(),
  estimated_hours: z.number().nonnegative().optional(),
  due_date: z.string().optional(),
  parent_task_id: z.string().optional(), // For creating sub-tasks
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  acceptance_criteria: z.array(z.string()).optional(),
});

/**
 * Task update schema
 */
export const taskUpdateSchema = taskCreateSchema.partial().extend({
  status: taskStatusSchema.optional(),
  time_spent: z.number().nonnegative().optional(),
  remaining_time: z.number().nonnegative().optional(),
  resolution: z.string().optional(),
  resolution_date: z.string().optional(),
});

// ============================================================================
// TASK HIERARCHY SCHEMAS
// ============================================================================

/**
 * Task hierarchy with related tasks
 */
export const taskHierarchySchema = z.object({
  task: taskSchema,
  subTasks: z.array(subTaskSchema),
  parentTask: taskSchema.optional(),
  blockedTasks: z.array(taskSchema),
  blockingTasks: z.array(taskSchema),
});

// ============================================================================
// TASK PROGRESS SCHEMAS
// ============================================================================

/**
 * Task progress summary
 */
export const taskProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  inReview: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  percentComplete: z.number().min(0).max(100),
  estimatedHours: z.number().nonnegative(),
  timeSpent: z.number().nonnegative(),
  remainingHours: z.number().nonnegative(),
});

// ============================================================================
// LEGACY TASK SCHEMA
// ============================================================================

/**
 * Legacy task priority
 */
export const legacyTaskPrioritySchema = z.enum(['low', 'medium', 'high']);

/**
 * Legacy task type
 */
export const legacyTaskTypeSchema = z.enum(['development', 'testing', 'documentation', 'research', 'review']);

/**
 * Legacy task status
 */
export const legacyTaskStatusSchema = z.enum(['not_started', 'in_progress', 'review', 'blocked', 'completed']);

/**
 * Legacy task interface (backward compatibility)
 */
export const legacyTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  list_id: z.string().optional(),
  board_id: z.string().optional(),
  created_by: z.string(),
  assignee_id: z.string().optional(),
  completed: z.boolean(),
  priority: legacyTaskPrioritySchema.optional(),
  task_type: legacyTaskTypeSchema.optional(),
  estimated_hours: z.number().nonnegative().optional(),
  actual_hours: z.number().nonnegative().optional(),
  status: legacyTaskStatusSchema.optional(),
  ai_generated: z.boolean().optional(),
  due_date: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  dependencies: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
});

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type TaskTypeInput = z.infer<typeof taskTypeSchema>;
export type TaskSeverityInput = z.infer<typeof taskSeveritySchema>;
export type TaskAttachmentInput = z.infer<typeof taskAttachmentSchema>;
export type TaskCommentInput = z.infer<typeof taskCommentSchema>;
export type TaskInput = z.infer<typeof taskSchema>;
export type SubTaskInput = z.infer<typeof subTaskSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type TaskHierarchyInput = z.infer<typeof taskHierarchySchema>;
export type TaskProgressInput = z.infer<typeof taskProgressSchema>;
export type LegacyTaskInput = z.infer<typeof legacyTaskSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateTask(data: unknown) {
  return taskSchema.parse(data);
}

export function safeValidateTask(data: unknown) {
  return taskSchema.safeParse(data);
}

export function validateTaskCreate(data: unknown) {
  return taskCreateSchema.parse(data);
}

export function safeValidateTaskCreate(data: unknown) {
  return taskCreateSchema.safeParse(data);
}

export function validateTaskUpdate(data: unknown) {
  return taskUpdateSchema.parse(data);
}

export function safeValidateTaskUpdate(data: unknown) {
  return taskUpdateSchema.safeParse(data);
}

export function validateSubTask(data: unknown) {
  return subTaskSchema.parse(data);
}

export function safeValidateSubTask(data: unknown) {
  return subTaskSchema.safeParse(data);
}

export function validateLegacyTask(data: unknown) {
  return legacyTaskSchema.parse(data);
}

export function safeValidateLegacyTask(data: unknown) {
  return legacyTaskSchema.safeParse(data);
}
