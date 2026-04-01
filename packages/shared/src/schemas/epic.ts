/**
 * Epic Schemas
 * Epic planning, risk management, and hierarchy schemas
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { z } from 'zod';
import { epicStatusSchema } from './common';

// ============================================================================
// EPIC ENUMS
// ============================================================================

/**
 * Epic priority levels
 */
export const epicPrioritySchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Epic business value assessment
 */
export const epicBusinessValueSchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Epic type for hierarchy support
 */
export const epicTypeSchema = z.enum(['epic', 'initiative', 'theme']);

/**
 * Epic health status
 */
export const epicHealthStatusSchema = z.enum(['on_track', 'at_risk', 'off_track']);

// ============================================================================
// EPIC RISK SCHEMAS
// ============================================================================

/**
 * Risk impact levels
 */
export const riskImpactSchema = z.enum(['low', 'medium', 'high', 'critical']);

/**
 * Risk probability levels
 */
export const riskProbabilitySchema = z.enum(['low', 'medium', 'high']);

/**
 * Risk status
 */
export const riskStatusSchema = z.enum(['identified', 'monitoring', 'mitigated', 'realized']);

/**
 * Epic risk assessment
 */
export const epicRiskSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(1000),
  impact: riskImpactSchema,
  probability: riskProbabilitySchema,
  mitigation: z.string().max(1000).optional(),
  status: riskStatusSchema,
  created_at: z.string(),
});

/**
 * Epic risk creation schema
 */
export const epicRiskCreateSchema = epicRiskSchema.omit({
  id: true,
  created_at: true,
});

// ============================================================================
// EPIC SCHEMAS
// ============================================================================

/**
 * Epic interface
 */
export const epicSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: epicStatusSchema,
  priority: epicPrioritySchema,
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  completion_date: z.string().optional(),
  created_by: z.string(),
  assigned_to: z.string().optional(),
  tags: z.array(z.string()).optional(),
  color: z.string().max(20).optional(),
  progress: z.number().min(0).max(100).optional(),
  budget: z.number().nonnegative().optional(),
  business_value: epicBusinessValueSchema.optional(),
  stakeholders: z.array(z.string()).optional(), // User IDs
  objectives: z.array(z.string()).optional(),
  success_criteria: z.array(z.string()).optional(),
  risks: z.array(epicRiskSchema).optional(),
  project_id: z.string(), // Epics belong to ONE project
  created_at: z.string(),
  updated_at: z.string(),
  is_public: z.boolean().optional(),
  organization_id: z.string().optional(),
  estimated_effort: z.number().nonnegative().optional(), // Story points or hours
  actual_effort: z.number().nonnegative().optional(),

  // Epic owner/lead
  owner_id: z.string().optional(),
  owner_name: z.string().optional(),
  owner_email: z.string().email().optional(),

  // Progress metrics
  progress_percentage: z.number().min(0).max(100).optional(),

  // Health indicator
  health_status: epicHealthStatusSchema.optional(),

  // Epic enhancements
  epic_key: z.string().optional(), // Human-readable key like "PROJ-123"
  epic_type: epicTypeSchema,
  parent_epic_id: z.string().optional(), // For epic hierarchies
  child_epic_ids: z.array(z.string()).optional(), // Sub-epics
  total_story_points: z.number().int().nonnegative().optional(),
  completed_story_points: z.number().int().nonnegative().optional(),
  velocity: z.number().nonnegative().optional(), // Average story points per sprint
  fix_versions: z.array(z.string()).optional(), // Release versions
  components: z.array(z.string()).optional(), // System components affected
  labels: z.array(z.string()).optional(), // Epic labels for organization
});

/**
 * Epic creation schema
 */
export const epicCreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  status: epicStatusSchema.optional(),
  priority: epicPrioritySchema.optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  assigned_to: z.string().optional(),
  tags: z.array(z.string()).optional(),
  color: z.string().max(20).optional(),
  business_value: epicBusinessValueSchema.optional(),
  objectives: z.array(z.string()).optional(),
  success_criteria: z.array(z.string()).optional(),
  estimated_effort: z.number().nonnegative().optional(),
  project_id: z.string().optional(),
  epic_type: epicTypeSchema.optional(),
  parent_epic_id: z.string().optional(),
  fix_versions: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * Epic update schema
 */
export const epicUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  status: epicStatusSchema.optional(),
  priority: epicPrioritySchema.optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  completion_date: z.string().optional(),
  assigned_to: z.string().optional(),
  tags: z.array(z.string()).optional(),
  color: z.string().max(20).optional(),
  business_value: epicBusinessValueSchema.optional(),
  objectives: z.array(z.string()).optional(),
  success_criteria: z.array(z.string()).optional(),
  progress: z.number().min(0).max(100).optional(),
  budget: z.number().nonnegative().optional(),
  estimated_effort: z.number().nonnegative().optional(),
  actual_effort: z.number().nonnegative().optional(),
  epic_type: epicTypeSchema.optional(),
  parent_epic_id: z.string().optional(),
  fix_versions: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

// ============================================================================
// EPIC FILTERS
// ============================================================================

/**
 * Epic sort options
 */
export const epicSortBySchema = z.enum([
  'created_desc',
  'created_asc',
  'updated_desc',
  'updated_asc',
  'priority',
  'target_date',
  'title',
]);

/**
 * Epic filter options
 */
export const epicFiltersSchema = z.object({
  status: epicStatusSchema.or(z.literal('all')).optional(),
  priority: epicPrioritySchema.or(z.literal('all')).optional(),
  assigned_to: z.string().or(z.literal('all')).optional(),
  business_value: epicBusinessValueSchema.or(z.literal('all')).optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  showOnlyMine: z.boolean().optional(),
  sortBy: epicSortBySchema.optional(),
});

// ============================================================================
// EPIC ANALYTICS
// ============================================================================

/**
 * Epic milestone
 */
export const epicMilestoneSchema = z.object({
  epic_id: z.string(),
  epic_title: z.string(),
  milestone: z.string(),
  date: z.string(),
  status: z.enum(['upcoming', 'due_today', 'overdue', 'completed']),
});

/**
 * Epic analytics data
 */
export const epicAnalyticsSchema = z.object({
  total_epics: z.number().int().nonnegative(),
  by_status: z.record(epicStatusSchema, z.number().int().nonnegative()),
  by_priority: z.record(epicPrioritySchema, z.number().int().nonnegative()),
  by_business_value: z.record(epicBusinessValueSchema, z.number().int().nonnegative()),
  average_completion_time: z.number().nonnegative(), // in days
  completion_rate: z.number().min(0).max(100), // percentage
  overdue_count: z.number().int().nonnegative(),
  upcoming_milestones: z.array(epicMilestoneSchema),
});

// ============================================================================
// EPIC ACTIVITY
// ============================================================================

/**
 * Epic activity action types
 */
export const epicActivityActionSchema = z.enum([
  'created',
  'updated',
  'status_changed',
  'assigned',
  'commented',
  'project_added',
  'project_removed',
  'milestone_reached',
]);

/**
 * Epic activity entry
 */
export const epicActivitySchema = z.object({
  id: z.string(),
  epic_id: z.string(),
  user_id: z.string(),
  user_display_name: z.string(),
  action: epicActivityActionSchema,
  details: z.record(z.string(), z.unknown()),
  created_by: z.string(),
  created_at: z.string(),
  timestamp: z.string(),
});

// ============================================================================
// EPIC HIERARCHY
// ============================================================================

/**
 * Epic hierarchy with parent/child relationships
 */
export const epicHierarchySchema = z.object({
  epic: epicSchema,
  parent_epic: epicSchema.optional(),
  child_epics: z.array(epicSchema),
  total_depth: z.number().int().nonnegative(),
  completion_rollup: z.object({
    total_story_points: z.number().int().nonnegative(),
    completed_story_points: z.number().int().nonnegative(),
    progress_percentage: z.number().min(0).max(100),
  }),
});

// ============================================================================
// TYPE INFERENCE
// ============================================================================

export type EpicPriorityInput = z.infer<typeof epicPrioritySchema>;
export type EpicBusinessValueInput = z.infer<typeof epicBusinessValueSchema>;
export type EpicTypeInput = z.infer<typeof epicTypeSchema>;
export type EpicHealthStatusInput = z.infer<typeof epicHealthStatusSchema>;
export type RiskImpactInput = z.infer<typeof riskImpactSchema>;
export type RiskProbabilityInput = z.infer<typeof riskProbabilitySchema>;
export type RiskStatusInput = z.infer<typeof riskStatusSchema>;
export type EpicRiskInput = z.infer<typeof epicRiskSchema>;
export type EpicRiskCreateInput = z.infer<typeof epicRiskCreateSchema>;
export type EpicInput = z.infer<typeof epicSchema>;
export type EpicCreateInput = z.infer<typeof epicCreateSchema>;
export type EpicUpdateInput = z.infer<typeof epicUpdateSchema>;
export type EpicFiltersInput = z.infer<typeof epicFiltersSchema>;
export type EpicMilestoneInput = z.infer<typeof epicMilestoneSchema>;
export type EpicAnalyticsInput = z.infer<typeof epicAnalyticsSchema>;
export type EpicActivityInput = z.infer<typeof epicActivitySchema>;
export type EpicHierarchyInput = z.infer<typeof epicHierarchySchema>;

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function validateEpic(data: unknown) {
  return epicSchema.parse(data);
}

export function safeValidateEpic(data: unknown) {
  return epicSchema.safeParse(data);
}

export function validateEpicCreate(data: unknown) {
  return epicCreateSchema.parse(data);
}

export function safeValidateEpicCreate(data: unknown) {
  return epicCreateSchema.safeParse(data);
}

export function validateEpicUpdate(data: unknown) {
  return epicUpdateSchema.parse(data);
}

export function safeValidateEpicUpdate(data: unknown) {
  return epicUpdateSchema.safeParse(data);
}

export function validateEpicRisk(data: unknown) {
  return epicRiskSchema.parse(data);
}

export function safeValidateEpicRisk(data: unknown) {
  return epicRiskSchema.safeParse(data);
}
