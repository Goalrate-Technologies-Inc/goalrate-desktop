/**
 * Common Schemas
 * Foundation schemas for primitives, enums, and shared types
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import {
  PROJECT_STATUS_VALUES,
  TASK_STATUS_VALUES,
  BOARD_STATUS_VALUES,
  SPRINT_STATUS_VALUES,
  EPIC_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
} from '../constants/statuses';
import { CAPACITY_DEFAULTS } from '../constants/scoring';

// ============================================================================
// PRIMITIVE SCHEMAS
// ============================================================================

/**
 * UUID schema
 */
export const uuidSchema = z.string().uuid();

/**
 * Non-empty string schema
 */
export const nonEmptyStringSchema = z.string().min(1);

/**
 * Email schema
 */
export const emailSchema = z.string().email();

/**
 * URL schema
 */
export const urlSchema = z.string().url();

/**
 * ISO date string schema (supports both datetime and date-only formats)
 */
export const isoDateSchema = z.string().refine(
  (val) => {
    // Accept ISO datetime strings or YYYY-MM-DD format
    const dateTimeRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/;
    return dateTimeRegex.test(val);
  },
  { message: 'Invalid date format. Expected ISO 8601 date string' }
);

/**
 * Optional ISO date schema
 */
export const optionalDateSchema = isoDateSchema.optional();

// ============================================================================
// PRIORITY SCHEMAS
// ============================================================================

/**
 * Standard priority levels
 */
export const prioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Extended priority with lowest/highest
 */
export const extendedPrioritySchema = z.enum(['lowest', 'low', 'medium', 'high', 'highest']);

// ============================================================================
// STATUS SCHEMAS (derived from constants)
// ============================================================================

/**
 * Entity status (goals)
 */
export const entityStatusSchema = z.enum(ENTITY_STATUS_VALUES as [string, ...string[]]);

/**
 * Project status
 */
export const projectStatusSchema = z.enum(PROJECT_STATUS_VALUES as [string, ...string[]]);

/**
 * Task status
 */
export const taskStatusSchema = z.enum(TASK_STATUS_VALUES as [string, ...string[]]);

/**
 * Board column status
 */
export const boardStatusSchema = z.enum(BOARD_STATUS_VALUES as [string, ...string[]]);

/**
 * Sprint status
 */
export const sprintStatusSchema = z.enum(SPRINT_STATUS_VALUES as [string, ...string[]]);

/**
 * Epic status
 */
export const epicStatusSchema = z.enum(EPIC_STATUS_VALUES as [string, ...string[]]);

// ============================================================================
// VISIBILITY SCHEMAS
// ============================================================================

/**
 * Content visibility
 */
export const visibilitySchema = z.enum(['public', 'private', 'followers']);

/**
 * Project visibility
 */
export const projectVisibilitySchema = z.enum(['private', 'internal', 'public']);

/**
 * Workspace privacy level
 */
export const workspacePrivacyLevelSchema = z.enum(['public', 'private', 'invite_only']);

// ============================================================================
// TIMESTAMP SCHEMAS
// ============================================================================

/**
 * Standard timestamps
 */
export const timestampsSchema = z.object({
  created_at: z.string(),
  updated_at: z.string().optional(),
});

/**
 * Extended timestamps with deletion tracking
 */
export const extendedTimestampsSchema = timestampsSchema.extend({
  deleted_at: z.string().optional(),
});

// ============================================================================
// PAGINATION SCHEMAS
// ============================================================================

/**
 * Create a paginated response schema for any item type
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  });
}

/**
 * Alternative paginated list schema (snake_case format)
 */
export function paginatedListSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total_count: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    per_page: z.number().int().positive(),
    has_more: z.boolean(),
  });
}

// ============================================================================
// STORY POINTS SCHEMA
// ============================================================================

/**
 * Fibonacci story points validation
 */
export const storyPointsSchema = z.number().int().refine(
  (val) => CAPACITY_DEFAULTS.STORY_POINTS.includes(val as 1 | 2 | 3 | 5 | 8 | 13 | 21),
  { message: 'Story points must be a Fibonacci number: 1, 2, 3, 5, 8, 13, or 21' }
);

/**
 * Optional story points (allows any positive number or Fibonacci)
 */
export const optionalStoryPointsSchema = z.number().int().positive().optional();

// ============================================================================
// SERVICE RESPONSE SCHEMAS
// ============================================================================

/**
 * User-friendly error schema
 */
export const userFriendlyErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Service response status
 */
export const serviceResponseStatusSchema = z.enum(['success', 'error', 'unavailable']);

/**
 * Service response source
 */
export const serviceResponseSourceSchema = z.enum(['cache', 'api', 'fallback']);

/**
 * Create a service response schema for any data type
 */
export function serviceResponseSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema.optional(),
    error: userFriendlyErrorSchema.optional(),
    status: serviceResponseStatusSchema,
    source: serviceResponseSourceSchema,
    timestamp: z.date(),
  });
}

// ============================================================================
// STATUS DISPLAY SCHEMA
// ============================================================================

/**
 * Status display configuration
 */
export const statusDisplayConfigSchema = z.object({
  label: z.string(),
  color: z.string(),
  bgColor: z.string(),
  borderColor: z.string().optional(),
});

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type PriorityInput = z.infer<typeof prioritySchema>;
export type ExtendedPriorityInput = z.infer<typeof extendedPrioritySchema>;
export type EntityStatusInput = z.infer<typeof entityStatusSchema>;
export type ProjectStatusInput = z.infer<typeof projectStatusSchema>;
export type TaskStatusInput = z.infer<typeof taskStatusSchema>;
export type BoardStatusInput = z.infer<typeof boardStatusSchema>;
export type SprintStatusInput = z.infer<typeof sprintStatusSchema>;
export type EpicStatusInput = z.infer<typeof epicStatusSchema>;
export type VisibilityInput = z.infer<typeof visibilitySchema>;
export type ProjectVisibilityInput = z.infer<typeof projectVisibilitySchema>;
export type TimestampsInput = z.infer<typeof timestampsSchema>;
