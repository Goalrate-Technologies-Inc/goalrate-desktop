/**
 * Sprint Schemas
 * Sprint management, retrospective, and analytics schemas
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import { sprintStatusSchema } from './common';

// ============================================================================
// SPRINT SCHEMAS
// ============================================================================

/**
 * Sprint interface
 */
export const sprintSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  goal: z.string().max(500).optional(),
  status: sprintStatusSchema,
  start_date: z.string(),
  end_date: z.string(),
  project_id: z.string(), // Sprints belong to Projects
  velocity: z.number().nonnegative(), // Team velocity (historical)
  completed_points: z.number().int().nonnegative(), // Story points completed this sprint
  total_points: z.number().int().nonnegative(), // Total story points planned
  created_at: z.string(),
  updated_at: z.string(),
}).refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  { message: 'End date must be after start date', path: ['end_date'] }
);

/**
 * Sprint creation schema
 */
export const sprintCreateSchema = z.object({
  name: z.string().min(1).max(100),
  start_date: z.string(), // ISO date string
  end_date: z.string(), // ISO date string
  goal: z.string().max(500).optional(),
  total_points: z.number().int().nonnegative().optional(),
  project_id: z.string(),
}).refine(
  (data) => new Date(data.end_date) > new Date(data.start_date),
  { message: 'End date must be after start date', path: ['end_date'] }
);

/**
 * Sprint update schema
 */
export const sprintUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: sprintStatusSchema.optional(),
  goal: z.string().max(500).optional(),
  velocity: z.number().nonnegative().optional(),
  completed_points: z.number().int().nonnegative().optional(),
  total_points: z.number().int().nonnegative().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
}).refine(
  (data) => {
    if (data.start_date && data.end_date) {
      return new Date(data.end_date) > new Date(data.start_date);
    }
    return true;
  },
  { message: 'End date must be after start date', path: ['end_date'] }
);

// ============================================================================
// SPRINT METRICS SCHEMAS
// ============================================================================

/**
 * Sprint burndown entry (from PRD)
 */
export const burndownEntrySchema = z.object({
  date: z.string(),
  remaining_points: z.number().int().nonnegative(),
  ideal_remaining: z.number().nonnegative(),
  actual_remaining: z.number().int().nonnegative().optional(),
});

// ============================================================================
// RETROSPECTIVE SCHEMAS
// ============================================================================

/**
 * Retrospective action item
 */
export const retrospectiveActionSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(500),
  assignee_id: z.string().optional(),
  completed: z.boolean(),
  due_date: z.string().optional(),
});

/**
 * Sprint retrospective
 */
export const retrospectiveSchema = z.object({
  id: z.string(),
  sprint_id: z.string(),
  went_well: z.array(z.string().min(1).max(500)),
  to_improve: z.array(z.string().min(1).max(500)),
  action_items: z.array(retrospectiveActionSchema),
  created_at: z.string(),
  updated_at: z.string().optional(),
});

/**
 * Retrospective creation schema
 */
export const retrospectiveCreateSchema = retrospectiveSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});

// ============================================================================
// SPRINT ANALYTICS SCHEMAS
// ============================================================================

/**
 * Sprint velocity data
 */
export const sprintVelocitySchema = z.object({
  sprint_id: z.string(),
  sprint_name: z.string(),
  planned_points: z.number().int().nonnegative(),
  completed_points: z.number().int().nonnegative(),
  velocity: z.number().nonnegative(),
  completion_rate: z.number().min(0).max(100),
});

/**
 * Sprint summary for dashboard
 */
export const sprintSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: sprintStatusSchema,
  start_date: z.string(),
  end_date: z.string(),
  total_points: z.number().int().nonnegative(),
  completed_points: z.number().int().nonnegative(),
  completion_rate: z.number().min(0).max(100),
  days_remaining: z.number().int(),
  velocity: z.number().nonnegative().optional(),
});

// ============================================================================
// SPRINT CAPACITY SCHEMAS
// ============================================================================

/**
 * Team member sprint capacity
 */
export const sprintTeamMemberSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().url().optional(),
  available_hours: z.number().nonnegative(),
  allocated_hours: z.number().nonnegative(),
});

/**
 * Sprint capacity planning
 */
export const sprintCapacitySchema = z.object({
  sprint_id: z.string(),
  team_capacity: z.number().nonnegative(), // Total available hours
  allocated_points: z.number().int().nonnegative(),
  remaining_capacity: z.number().nonnegative(),
  team_members: z.array(sprintTeamMemberSchema),
});

// ============================================================================
// SPRINT PLANNING SCHEMAS
// ============================================================================

/**
 * Sprint planning session
 */
export const sprintPlanningSessionSchema = z.object({
  id: z.string(),
  sprint_id: z.string(),
  date: z.string(),
  participants: z.array(z.string()),
  total_points_committed: z.number().int().nonnegative(),
  notes: z.string().max(2000).optional(),
  created_at: z.string(),
});

/**
 * Sprint key result
 */
export const sprintKeyResultSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(500),
  target_value: z.number(),
  current_value: z.number(),
  completed: z.boolean(),
});

/**
 * Sprint goal tracking
 */
export const sprintGoalTrackingSchema = z.object({
  sprint_id: z.string(),
  goal: z.string(),
  progress: z.number().min(0).max(100),
  key_results: z.array(sprintKeyResultSchema),
});

// ============================================================================
// ENHANCED SPRINT SCHEMA (PRD-specified)
// ============================================================================

/**
 * Enhanced sprint from PRD with full metadata
 */
export const enhancedSprintSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1).max(100),
  start: z.string(),
  end: z.string(),
  goal: z.string().max(500),
  committedPoints: z.number().int().nonnegative(),
  completedPoints: z.number().int().nonnegative(),
  burndown: z.array(burndownEntrySchema),
  velocity: z.number().nonnegative().optional(),
  retro: retrospectiveSchema.optional(),
}).refine(
  (data) => new Date(data.end) > new Date(data.start),
  { message: 'End date must be after start date', path: ['end'] }
);

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type SprintInput = z.infer<typeof sprintSchema>;
export type SprintCreateInput = z.infer<typeof sprintCreateSchema>;
export type SprintUpdateInput = z.infer<typeof sprintUpdateSchema>;
export type BurndownEntryInput = z.infer<typeof burndownEntrySchema>;
export type RetrospectiveActionInput = z.infer<typeof retrospectiveActionSchema>;
export type RetrospectiveInput = z.infer<typeof retrospectiveSchema>;
export type RetrospectiveCreateInput = z.infer<typeof retrospectiveCreateSchema>;
export type SprintVelocityInput = z.infer<typeof sprintVelocitySchema>;
export type SprintSummaryInput = z.infer<typeof sprintSummarySchema>;
export type SprintTeamMemberInput = z.infer<typeof sprintTeamMemberSchema>;
export type SprintCapacityInput = z.infer<typeof sprintCapacitySchema>;
export type SprintPlanningSessionInput = z.infer<typeof sprintPlanningSessionSchema>;
export type SprintKeyResultInput = z.infer<typeof sprintKeyResultSchema>;
export type SprintGoalTrackingInput = z.infer<typeof sprintGoalTrackingSchema>;
export type EnhancedSprintInput = z.infer<typeof enhancedSprintSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateSprint(data: unknown) {
  return sprintSchema.parse(data);
}

export function safeValidateSprint(data: unknown) {
  return sprintSchema.safeParse(data);
}

export function validateSprintCreate(data: unknown) {
  return sprintCreateSchema.parse(data);
}

export function safeValidateSprintCreate(data: unknown) {
  return sprintCreateSchema.safeParse(data);
}

export function validateSprintUpdate(data: unknown) {
  return sprintUpdateSchema.parse(data);
}

export function safeValidateSprintUpdate(data: unknown) {
  return sprintUpdateSchema.safeParse(data);
}

export function validateRetrospective(data: unknown) {
  return retrospectiveSchema.parse(data);
}

export function safeValidateRetrospective(data: unknown) {
  return retrospectiveSchema.safeParse(data);
}

export function validateBurndownEntry(data: unknown) {
  return burndownEntrySchema.parse(data);
}

export function safeValidateBurndownEntry(data: unknown) {
  return burndownEntrySchema.safeParse(data);
}

export function validateEnhancedSprint(data: unknown) {
  return enhancedSprintSchema.parse(data);
}

export function safeValidateEnhancedSprint(data: unknown) {
  return enhancedSprintSchema.safeParse(data);
}
