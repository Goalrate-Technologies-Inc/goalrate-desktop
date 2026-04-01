/**
 * Project Schemas
 * Project, board, and card schemas for Scrumban workflow
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import {
  prioritySchema,
  projectStatusSchema,
  projectVisibilitySchema,
} from './common';

// ============================================================================
// BOARD CONFIGURATION SCHEMAS
// ============================================================================

/**
 * Board methodology options
 */
export const boardMethodologySchema = z.enum(['scrum', 'kanban', 'scrumban']);

/**
 * Board column configuration
 */
export const boardColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  position: z.number().int().min(0),
  wip_limit: z.number().int().min(0).default(0), // 0 = no limit
});

// ============================================================================
// CARD SCHEMAS
// ============================================================================

/**
 * Card priority (slightly different from standard priority)
 */
export const cardPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);

/**
 * Card status
 */
export const cardStatusSchema = z.enum(['not_started', 'in_progress', 'review', 'blocked', 'completed']);

/**
 * Assigned user on a card
 */
export const assignedUserSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().url().optional(),
});

/**
 * Card comment
 */
export const cardCommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1).max(2000),
  card_id: z.string(),
  user_id: z.string(),
  user_display_name: z.string(),
  created_at: z.string(),
});

/**
 * Card reaction
 */
export const cardReactionSchema = z.object({
  id: z.string(),
  emoji: z.string().min(1).max(10),
  card_id: z.string(),
  user_id: z.string(),
  user_display_name: z.string(),
});

/**
 * Board card (item in a list)
 */
export const cardSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  position: z.number().int().min(0),
  list_id: z.string(),
  board_id: z.string(),
  created_by: z.string(),
  assigned_to: z.string().optional(),
  assigned_user: assignedUserSchema.optional(),
  completed: z.boolean(),
  due_date: z.string().optional(),
  priority: cardPrioritySchema.optional(),
  status: cardStatusSchema.optional(),
  created_at: z.string(),
  updated_at: z.string(),
  comments: z.array(cardCommentSchema).optional(),
  reactions: z.array(cardReactionSchema).optional(),
});

/**
 * Card creation schema
 */
export const cardCreateSchema = cardSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  comments: true,
  reactions: true,
  assigned_user: true,
}).extend({
  completed: z.boolean().optional().default(false),
});

/**
 * Card update schema
 */
export const cardUpdateSchema = cardCreateSchema.partial();

// ============================================================================
// LIST SCHEMAS
// ============================================================================

/**
 * Board list (column)
 */
export const listSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(100),
  position: z.number().int().min(0),
  board_id: z.string(),
  cards: z.array(cardSchema),
});

/**
 * List creation schema
 */
export const listCreateSchema = listSchema.omit({
  id: true,
  cards: true,
});

// ============================================================================
// BOARD SCHEMAS
// ============================================================================

/**
 * Board interface
 */
export const boardSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  is_public: z.boolean().optional(),
  is_archived: z.boolean().optional(),
  owner_id: z.string().optional(),
  members: z.array(z.string()).optional(),
  members_count: z.number().int().nonnegative().optional(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  lists: z.array(listSchema).optional(),
  status: projectStatusSchema.optional(),
  progress: z.number().min(0).max(100).optional(),
  velocity: z.number().nonnegative().optional(), // Stories completed per week
  tags: z.array(z.string()).optional(),
  board_methodology: boardMethodologySchema.optional(),
  priority: prioritySchema.optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  board_columns: z.array(boardColumnSchema).optional(),
  enable_sprints: z.boolean().optional(),
  enable_wip_limits: z.boolean().optional(),
  enable_story_points: z.boolean().optional(),
});

/**
 * Board creation schema
 */
export const boardCreateSchema = boardSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  lists: true,
  members_count: true,
}).extend({
  project_id: z.string(),
});

/**
 * Board update schema
 */
export const boardUpdateSchema = boardCreateSchema.omit({
  project_id: true,
}).partial();

// ============================================================================
// PROJECT SCHEMAS
// ============================================================================

/**
 * Project type categories
 */
export const projectTypeSchema = z.enum(['software', 'business', 'marketing', 'research', 'other']);

/**
 * Project interface
 */
export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  key: z.string().min(2).max(10).regex(/^[A-Z][A-Z0-9]*$/,
    'Project key must start with a letter and contain only uppercase letters and numbers'),
  description: z.string().max(2000).optional(),
  project_type: projectTypeSchema,
  status: projectStatusSchema,
  priority: prioritySchema.optional(),
  visibility: projectVisibilitySchema,

  // Project metadata
  lead_id: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  start_date: z.string().optional(),
  target_completion_date: z.string().optional(),
  actual_completion_date: z.string().optional(),

  // Project organization
  organization_id: z.string().optional(),
  team_ids: z.array(z.string()),
  member_ids: z.array(z.string()),

  // Project settings
  default_assignee_id: z.string().optional(),
  avatar_url: z.string().url().optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  board_methodology: boardMethodologySchema.optional(),

  // Unified Board Settings
  board_columns: z.array(boardColumnSchema).optional(),
  enable_sprints: z.boolean().optional(),
  enable_wip_limits: z.boolean().optional(),
  enable_story_points: z.boolean().optional(),

  // Project metrics
  epic_count: z.number().int().nonnegative(),
  total_story_points: z.number().int().nonnegative(),
  completed_story_points: z.number().int().nonnegative(),
});

/**
 * Project creation schema
 */
export const projectCreateSchema = z.object({
  name: z.string().min(1).max(200),
  key: z.string().min(2).max(10).regex(/^[A-Z][A-Z0-9]*$/,
    'Project key must start with a letter and contain only uppercase letters and numbers'),
  description: z.string().max(2000).optional(),
  project_type: projectTypeSchema,
  priority: prioritySchema.optional(),
  visibility: projectVisibilitySchema.optional(),
  lead_id: z.string().optional(),
  start_date: z.string().optional(),
  target_completion_date: z.string().optional(),
  team_ids: z.array(z.string()).optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  board_methodology: boardMethodologySchema.optional(),
  board_columns: z.array(boardColumnSchema).optional(),
  enable_sprints: z.boolean().optional(),
  enable_wip_limits: z.boolean().optional(),
  enable_story_points: z.boolean().optional(),
});

/**
 * Project update schema
 */
export const projectUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: projectStatusSchema.optional(),
  priority: prioritySchema.optional(),
  visibility: projectVisibilitySchema.optional(),
  lead_id: z.string().optional(),
  target_completion_date: z.string().optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  board_methodology: boardMethodologySchema.optional(),
  board_columns: z.array(boardColumnSchema).optional(),
  enable_sprints: z.boolean().optional(),
  enable_wip_limits: z.boolean().optional(),
  enable_story_points: z.boolean().optional(),
});

// ============================================================================
// PROJECT PERMISSIONS
// ============================================================================

/**
 * Project permission roles
 */
export const projectRoleSchema = z.enum(['admin', 'lead', 'developer', 'viewer']);

/**
 * Project permission assignment
 */
export const projectPermissionSchema = z.object({
  project_id: z.string(),
  user_id: z.string(),
  role: projectRoleSchema,
  granted_by: z.string(),
  granted_at: z.string(),
});

/**
 * Project role definition
 */
export const projectRoleDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  permissions: z.array(z.string()),
  is_default: z.boolean(),
});

// ============================================================================
// PROJECT ANALYTICS
// ============================================================================

/**
 * Velocity trend data point
 */
export const velocityTrendSchema = z.object({
  period: z.string(), // sprint name or date range
  planned_points: z.number().int().nonnegative(),
  completed_points: z.number().int().nonnegative(),
  team_capacity: z.number().int().nonnegative(),
});

/**
 * Burndown chart data point
 */
export const burndownPointSchema = z.object({
  date: z.string(),
  remaining_points: z.number().int().nonnegative(),
  ideal_remaining: z.number().nonnegative(),
  actual_remaining: z.number().int().nonnegative(),
});

/**
 * Project analytics data
 */
export const projectAnalyticsSchema = z.object({
  project_id: z.string(),
  date_range: z.object({
    start_date: z.string(),
    end_date: z.string(),
  }),
  metrics: z.object({
    epic_completion_rate: z.number().min(0).max(100),
    team_velocity: z.number().nonnegative(),
    scope_creep_percentage: z.number().min(0).max(100),
    defect_density: z.number().nonnegative(),
  }),
  trends: z.object({
    velocity_trend: z.array(velocityTrendSchema),
    burndown_data: z.array(burndownPointSchema),
    completion_forecast: z.string(),
  }),
});

// ============================================================================
// PROJECT FILTERS
// ============================================================================

/**
 * Project filter options
 */
export const projectFiltersSchema = z.object({
  status: z.array(projectStatusSchema).optional(),
  project_type: z.array(projectTypeSchema).optional(),
  lead_id: z.string().optional(),
  team_id: z.string().optional(),
  organization_id: z.string().optional(),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  has_active_epics: z.boolean().optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

// ============================================================================
// PROJECT CUSTOM FIELDS
// ============================================================================

/**
 * Custom field type
 */
export const customFieldTypeSchema = z.enum(['text', 'number', 'date', 'select', 'multiselect']);

/**
 * Project custom field
 */
export const projectCustomFieldSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  type: customFieldTypeSchema,
  required: z.boolean(),
  default_value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  options: z.array(z.string()).optional(),
  applies_to: z.array(z.enum(['epic', 'subtask'])),
});

/**
 * Project settings
 */
export const projectSettingsSchema = z.object({
  project_id: z.string(),
  settings: z.object({
    notify_on_epic_completion: z.boolean(),
    notify_on_sprint_start: z.boolean(),
    external_integration: z.object({
      enabled: z.boolean(),
      instance_url: z.string().url(),
      project_key: z.string(),
    }).optional(),
    custom_fields: z.array(projectCustomFieldSchema),
  }),
});

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type BoardMethodologyInput = z.infer<typeof boardMethodologySchema>;
export type BoardColumnInput = z.infer<typeof boardColumnSchema>;
export type CardInput = z.infer<typeof cardSchema>;
export type CardCreateInput = z.infer<typeof cardCreateSchema>;
export type CardUpdateInput = z.infer<typeof cardUpdateSchema>;
export type ListInput = z.infer<typeof listSchema>;
export type BoardInput = z.infer<typeof boardSchema>;
export type BoardCreateInput = z.infer<typeof boardCreateSchema>;
export type BoardUpdateInput = z.infer<typeof boardUpdateSchema>;
export type ProjectTypeInput = z.infer<typeof projectTypeSchema>;
export type ProjectInput = z.infer<typeof projectSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type ProjectRoleInput = z.infer<typeof projectRoleSchema>;
export type ProjectPermissionInput = z.infer<typeof projectPermissionSchema>;
export type ProjectAnalyticsInput = z.infer<typeof projectAnalyticsSchema>;
export type ProjectFiltersInput = z.infer<typeof projectFiltersSchema>;
export type ProjectSettingsInput = z.infer<typeof projectSettingsSchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateProject(data: unknown) {
  return projectSchema.parse(data);
}

export function safeValidateProject(data: unknown) {
  return projectSchema.safeParse(data);
}

export function validateProjectCreate(data: unknown) {
  return projectCreateSchema.parse(data);
}

export function safeValidateProjectCreate(data: unknown) {
  return projectCreateSchema.safeParse(data);
}

export function validateProjectUpdate(data: unknown) {
  return projectUpdateSchema.parse(data);
}

export function safeValidateProjectUpdate(data: unknown) {
  return projectUpdateSchema.safeParse(data);
}

export function validateBoard(data: unknown) {
  return boardSchema.parse(data);
}

export function safeValidateBoard(data: unknown) {
  return boardSchema.safeParse(data);
}

export function validateCard(data: unknown) {
  return cardSchema.parse(data);
}

export function safeValidateCard(data: unknown) {
  return cardSchema.safeParse(data);
}
