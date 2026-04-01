/**
 * Epic Types
 * Epic planning and hierarchy types for project management
 */

import type { EpicStatus } from './common';

// ============================================================================
// EPIC PRIORITY AND BUSINESS VALUE
// ============================================================================

/**
 * Epic priority levels
 */
export type EpicPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Epic business value assessment
 */
export type EpicBusinessValue = 'low' | 'medium' | 'high' | 'critical';

/**
 * Epic type for hierarchy support
 */
export type EpicType = 'epic' | 'initiative' | 'theme';

/**
 * Epic health status
 */
export type EpicHealthStatus = 'on_track' | 'at_risk' | 'off_track';

// ============================================================================
// EPIC RISK TYPES
// ============================================================================

/**
 * Risk impact levels
 */
export type RiskImpact = 'low' | 'medium' | 'high' | 'critical';

/**
 * Risk probability levels
 */
export type RiskProbability = 'low' | 'medium' | 'high';

/**
 * Risk status
 */
export type RiskStatus = 'identified' | 'monitoring' | 'mitigated' | 'realized';

/**
 * Epic risk assessment
 */
export interface EpicRisk {
  id: string;
  description: string;
  impact: RiskImpact;
  probability: RiskProbability;
  mitigation?: string;
  status: RiskStatus;
  created_at: string;
}

// ============================================================================
// EPIC TYPES
// ============================================================================

/**
 * Epic interface
 */
export interface Epic {
  id: string;
  title: string;
  description?: string;
  status: EpicStatus;
  priority: EpicPriority;
  start_date?: string;
  target_date?: string;
  completion_date?: string;
  created_by: string;
  assigned_to?: string;
  tags?: string[];
  color?: string;
  progress?: number; // 0-100 percentage
  budget?: number;
  business_value?: EpicBusinessValue;
  stakeholders?: string[]; // User IDs
  objectives?: string[]; // Key objectives/goals
  success_criteria?: string[]; // Measurable success criteria
  risks?: EpicRisk[];
  project_id: string; // Single project ID - Epics belong to ONE project
  created_at: string;
  updated_at: string;
  is_public?: boolean;
  organization_id?: string;
  estimated_effort?: number; // Story points or hours
  actual_effort?: number;

  // Epic owner/lead
  owner_id?: string;
  owner_name?: string;
  owner_email?: string;

  // Progress metrics
  progress_percentage?: number; // Auto-calculated progress (0-100)

  // Health indicator
  health_status?: EpicHealthStatus;

  // Epic enhancements
  epic_key?: string; // Human-readable key like "PROJ-123"
  epic_type: EpicType;
  parent_epic_id?: string; // For epic hierarchies
  child_epic_ids?: string[]; // Sub-epics
  total_story_points?: number;
  completed_story_points?: number;
  velocity?: number; // Average story points per sprint
  fix_versions?: string[]; // Release versions
  components?: string[]; // System components affected
  labels?: string[]; // Epic labels for organization
}

/**
 * Epic creation data
 */
export interface EpicCreate {
  title: string;
  description?: string;
  status?: EpicStatus;
  priority?: EpicPriority;
  start_date?: string;
  target_date?: string;
  assigned_to?: string;
  tags?: string[];
  color?: string;
  business_value?: EpicBusinessValue;
  objectives?: string[];
  success_criteria?: string[];
  estimated_effort?: number;
  project_id?: string;
  epic_type?: EpicType;
  parent_epic_id?: string;
  fix_versions?: string[];
  components?: string[];
  labels?: string[];
}

/**
 * Epic update data
 */
export interface EpicUpdate {
  title?: string;
  description?: string;
  status?: EpicStatus;
  priority?: EpicPriority;
  start_date?: string;
  target_date?: string;
  completion_date?: string;
  assigned_to?: string;
  tags?: string[];
  color?: string;
  business_value?: EpicBusinessValue;
  objectives?: string[];
  success_criteria?: string[];
  progress?: number;
  budget?: number;
  estimated_effort?: number;
  actual_effort?: number;
  epic_type?: EpicType;
  parent_epic_id?: string;
  fix_versions?: string[];
  components?: string[];
  labels?: string[];
}

// ============================================================================
// EPIC FILTERS
// ============================================================================

/**
 * Epic sort options
 */
export type EpicSortBy =
  | 'created_desc'
  | 'created_asc'
  | 'updated_desc'
  | 'updated_asc'
  | 'priority'
  | 'target_date'
  | 'title';

/**
 * Epic filter options
 */
export interface EpicFilters {
  status?: EpicStatus | 'all';
  priority?: EpicPriority | 'all';
  assigned_to?: string | 'all';
  business_value?: EpicBusinessValue | 'all';
  search?: string;
  tags?: string[];
  showOnlyMine?: boolean;
  sortBy?: EpicSortBy;
}

// ============================================================================
// EPIC ANALYTICS
// ============================================================================

/**
 * Epic milestone
 */
export interface EpicMilestone {
  epic_id: string;
  epic_title: string;
  milestone: string;
  date: string;
  status: 'upcoming' | 'due_today' | 'overdue' | 'completed';
}

/**
 * Epic analytics data
 */
export interface EpicAnalytics {
  total_epics: number;
  by_status: Record<EpicStatus, number>;
  by_priority: Record<EpicPriority, number>;
  by_business_value: Record<EpicBusinessValue, number>;
  average_completion_time: number; // in days
  completion_rate: number; // percentage
  overdue_count: number;
  upcoming_milestones: EpicMilestone[];
}

// ============================================================================
// EPIC ACTIVITY
// ============================================================================

/**
 * Epic activity action types
 */
export type EpicActivityAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'assigned'
  | 'commented'
  | 'project_added'
  | 'project_removed'
  | 'milestone_reached';

/**
 * Epic activity entry
 */
export interface EpicActivity {
  id: string;
  epic_id: string;
  user_id: string;
  user_display_name: string;
  action: EpicActivityAction;
  details: Record<string, unknown>;
  created_by: string;
  created_at: string;
  timestamp: string;
}

// ============================================================================
// EPIC HIERARCHY
// ============================================================================

/**
 * Epic hierarchy with parent/child relationships
 */
export interface EpicHierarchy {
  epic: Epic;
  parent_epic?: Epic;
  child_epics: Epic[];
  total_depth: number;
  completion_rollup: {
    total_story_points: number;
    completed_story_points: number;
    progress_percentage: number;
  };
}
