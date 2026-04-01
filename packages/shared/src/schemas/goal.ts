/**
 * Goal Schemas
 * SMART goal, goal task, and daily task schemas
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import {
  prioritySchema,
  entityStatusSchema,
  visibilitySchema,
} from './common';

// ============================================================================
// COLUMN AND SUBTASK SCHEMAS
// ============================================================================

/**
 * Kanban column configuration
 */
export const columnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  wip: z.number().int().min(0).max(100).optional(), // Work-in-progress limit
});

/**
 * Subtask for goal tasks
 */
export const subtaskSchema = z.object({
  title: z.string().min(1).max(200),
  done: z.boolean(),
});

// ============================================================================
// SMART GOAL SCHEMA
// ============================================================================

/**
 * SMART Goal structure from PRD
 * - Specific: What exactly do you want to achieve?
 * - Measurable: How will you measure progress?
 * - Achievable: Confidence score (1-100)
 * - Relevant: How does this connect to your values?
 * - Time-bound: When is the deadline?
 */
export const smartGoalSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  status: entityStatusSchema,
  specific: z.string().min(10).max(1000),
  measurable: z.object({
    unit: z.string().min(1),
  }),
  achievable: z.number().int().min(1).max(100), // Confidence score
  relevant: z.array(z.string()),
  deadline: z.string(),
  columns: z.array(columnSchema),
  priority: prioritySchema,
  tags: z.array(z.string()),
  created: z.string(),
  updated: z.string(),
});

/**
 * SMART goal creation schema
 */
export const smartGoalCreateSchema = smartGoalSchema.omit({
  id: true,
  created: true,
  updated: true,
}).extend({
  status: entityStatusSchema.optional().default('active'),
  columns: z.array(columnSchema).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
});

/**
 * SMART goal update schema
 */
export const smartGoalUpdateSchema = smartGoalCreateSchema.partial();

// ============================================================================
// GOAL TASK SCHEMA (PRD-specified)
// ============================================================================

/**
 * Goal task for SMART goals
 */
export const goalTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  column: z.string(),
  points: z.number().int().min(0).max(100),
  priority: prioritySchema,
  dueDate: z.string().optional(),
  completedBy: z.string().optional(),
  completedAt: z.string().optional(),
  subtasks: z.array(subtaskSchema),
});

/**
 * Goal task creation schema
 */
export const goalTaskCreateSchema = goalTaskSchema.omit({
  id: true,
  completedBy: true,
  completedAt: true,
}).extend({
  subtasks: z.array(subtaskSchema).optional().default([]),
});

/**
 * Goal task update schema
 */
export const goalTaskUpdateSchema = goalTaskCreateSchema.partial();

// ============================================================================
// WEB APP GOAL SCHEMAS
// ============================================================================

/**
 * Goal interface (existing web app structure)
 */
export const goalSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  measurable_target: z.string().max(500),
  deadline: z.string(),
  category: z.string().max(50),
  priority: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  createdAt: z.string(),
});

/**
 * Extended goal from service layer
 */
export const goalExtendedSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  deadline: z.string().optional(),
  start_date: z.string().optional(),
  progress: z.number().min(0).max(100),
  status: entityStatusSchema,
  visibility: visibilitySchema,
  created_at: z.string(),
  updated_at: z.string().optional(),
});

/**
 * Activity note for goal creation
 */
export const activityNoteSchema = z.object({
  text: z.string().min(1).max(1000),
  media_urls: z.array(z.string().url()).optional(),
}).nullable();

/**
 * Goal creation data
 */
export const goalCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  measurable_target: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  deadline: z.string().optional(),
  start_date: z.string().optional(),
  priority: z.string().optional(),
  workspace_id: z.string().uuid().optional(),
  visibility: visibilitySchema.optional(),
  activity_note: activityNoteSchema.optional(),
});

/**
 * Goal update data
 */
export const goalUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(50).optional(),
  deadline: z.string().optional(),
  start_date: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  status: entityStatusSchema.optional(),
  visibility: visibilitySchema.optional(),
});

// ============================================================================
// DAILY TASK SCHEMAS
// ============================================================================

/**
 * Task source reference
 */
export const taskSourceSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  title: z.string().optional(),
});

/**
 * Daily task for today's focus
 */
export const dailyTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  estimated_time: z.number().int().min(0).max(480), // in minutes (max 8 hours)
  priority: prioritySchema,
  category: z.string().max(50),
  completed: z.boolean(),
  ai_generated: z.boolean(),
  created_at: z.string(),
  source_goal_id: z.string().optional(),
  source_goal_title: z.string().optional(),
  source_project_id: z.string().optional(),
  source_project_title: z.string().optional(),
  source: taskSourceSchema.optional(),
});

/**
 * Daily task creation schema
 */
export const dailyTaskCreateSchema = dailyTaskSchema.omit({
  id: true,
  created_at: true,
}).extend({
  completed: z.boolean().optional().default(false),
  ai_generated: z.boolean().optional().default(false),
});

/**
 * Daily task update schema
 */
export const dailyTaskUpdateSchema = dailyTaskCreateSchema.partial();

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type ColumnInput = z.infer<typeof columnSchema>;
export type SubtaskInput = z.infer<typeof subtaskSchema>;
export type SmartGoalInput = z.infer<typeof smartGoalSchema>;
export type SmartGoalCreateInput = z.infer<typeof smartGoalCreateSchema>;
export type SmartGoalUpdateInput = z.infer<typeof smartGoalUpdateSchema>;
export type GoalTaskInput = z.infer<typeof goalTaskSchema>;
export type GoalTaskCreateInput = z.infer<typeof goalTaskCreateSchema>;
export type GoalInput = z.infer<typeof goalSchema>;
export type GoalExtendedInput = z.infer<typeof goalExtendedSchema>;
export type GoalCreateInput = z.infer<typeof goalCreateSchema>;
export type GoalUpdateInput = z.infer<typeof goalUpdateSchema>;
export type DailyTaskInput = z.infer<typeof dailyTaskSchema>;
export type DailyTaskCreateInput = z.infer<typeof dailyTaskCreateSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateGoal(data: unknown) {
  return goalSchema.parse(data);
}

export function safeValidateGoal(data: unknown) {
  return goalSchema.safeParse(data);
}

export function validateGoalCreate(data: unknown) {
  return goalCreateSchema.parse(data);
}

export function safeValidateGoalCreate(data: unknown) {
  return goalCreateSchema.safeParse(data);
}

export function validateGoalUpdate(data: unknown) {
  return goalUpdateSchema.parse(data);
}

export function safeValidateGoalUpdate(data: unknown) {
  return goalUpdateSchema.safeParse(data);
}

export function validateSmartGoal(data: unknown) {
  return smartGoalSchema.parse(data);
}

export function safeValidateSmartGoal(data: unknown) {
  return smartGoalSchema.safeParse(data);
}

export function validateDailyTask(data: unknown) {
  return dailyTaskSchema.parse(data);
}

export function safeValidateDailyTask(data: unknown) {
  return dailyTaskSchema.safeParse(data);
}
