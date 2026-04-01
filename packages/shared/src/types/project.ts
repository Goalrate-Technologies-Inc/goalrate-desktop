/**
 * Project Types
 * Project and board related types for Scrumban workflow
 */

import type { ProjectStatus, ProjectVisibility } from './common';

// ============================================================================
// BOARD CONFIGURATION TYPES
// ============================================================================

/**
 * Board methodology options
 */
export type BoardMethodology = 'scrum' | 'kanban' | 'scrumban';

/**
 * Board column configuration
 */
export interface BoardColumn {
  id: string; // Unique identifier (e.g., "backlog", "todo", "in_progress")
  title: string; // Display title (e.g., "Backlog", "To Do", "In Progress")
  position: number; // Order position (0-based)
  wip_limit: number; // Work-in-progress limit (0 = no limit)
}

/**
 * Default board columns (empty - users create their own)
 */
export const DEFAULT_BOARD_COLUMNS: BoardColumn[] = [];

// ============================================================================
// BOARD TYPES
// ============================================================================

/**
 * Board interface for project boards
 */
export interface Board {
  id: string;
  title: string;
  description?: string;
  is_public?: boolean;
  is_archived?: boolean;
  owner_id?: string;
  members?: string[];
  members_count?: number;
  created_at: string;
  updated_at?: string;
  lists?: List[];
  status?: ProjectStatus;
  progress?: number;
  velocity?: number; // Items completed per week
  tags?: string[];
  board_methodology?: BoardMethodology;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  start_date?: string | null;
  target_date?: string | null;
  board_columns?: BoardColumn[];
  enable_sprints?: boolean;
  enable_wip_limits?: boolean;
  enable_story_points?: boolean;
}

/**
 * Board list (column)
 */
export interface List {
  id: string;
  title: string;
  position: number;
  board_id: string;
  cards: Card[];
}

/**
 * Board card (item in a list)
 */
export interface Card {
  id: string;
  title: string;
  description?: string;
  position: number;
  list_id: string;
  board_id: string;
  created_by: string;
  assigned_to?: string;
  assigned_user?: { id: string; display_name: string; avatar_url?: string };
  completed: boolean;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  status?: 'not_started' | 'in_progress' | 'review' | 'blocked' | 'completed';
  created_at: string;
  updated_at: string;
  comments?: CardComment[];
  reactions?: CardReaction[];
}

/**
 * Card comment
 */
export interface CardComment {
  id: string;
  content: string;
  card_id: string;
  user_id: string;
  user_display_name: string;
  created_at: string;
}

/**
 * Card reaction
 */
export interface CardReaction {
  id: string;
  emoji: string;
  card_id: string;
  user_id: string;
  user_display_name: string;
}

/**
 * Board creation data
 */
export type BoardCreate = Omit<Board, 'id' | 'created_at' | 'updated_at'> & {
  project_id: string;
};

// ============================================================================
// PROJECT TYPES
// ============================================================================

/**
 * Project type categories
 */
export type ProjectType = 'software' | 'business' | 'marketing' | 'research' | 'other';

/**
 * Project interface
 */
export interface Project {
  id: string;
  name: string;
  key: string; // Project key for epic naming (e.g., "GOAL" for GOAL-123)
  description?: string;
  project_type: ProjectType;
  status: ProjectStatus;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  visibility: ProjectVisibility;

  // Project metadata
  lead_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  start_date?: string;
  target_completion_date?: string;
  actual_completion_date?: string;

  // Project organization
  organization_id?: string;
  team_ids: string[];
  member_ids: string[];

  // Project settings
  default_assignee_id?: string;
  avatar_url?: string;
  category?: string;
  tags?: string[];
  board_methodology?: BoardMethodology;

  // Unified Board Settings
  board_columns?: BoardColumn[];
  enable_sprints?: boolean;
  enable_wip_limits?: boolean;
  enable_story_points?: boolean;

  // Project metrics
  epic_count: number;
  total_story_points: number;
  completed_story_points: number;
}

/**
 * Project creation data
 */
export interface ProjectCreate {
  name: string;
  key: string;
  description?: string;
  project_type: ProjectType;
  priority?: Project['priority'];
  visibility?: ProjectVisibility;
  lead_id?: string;
  start_date?: string;
  target_completion_date?: string;
  team_ids?: string[];
  category?: string;
  tags?: string[];
  board_methodology?: BoardMethodology;
  board_columns?: BoardColumn[];
  enable_sprints?: boolean;
  enable_wip_limits?: boolean;
  enable_story_points?: boolean;
}

/**
 * Project update data
 */
export interface ProjectUpdate {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  priority?: Project['priority'];
  visibility?: ProjectVisibility;
  lead_id?: string;
  target_completion_date?: string;
  category?: string;
  tags?: string[];
  board_methodology?: BoardMethodology;
  board_columns?: BoardColumn[];
  enable_sprints?: boolean;
  enable_wip_limits?: boolean;
  enable_story_points?: boolean;
}

// ============================================================================
// PROJECT HIERARCHY TYPES
// ============================================================================

/**
 * Project hierarchy with epics and metrics
 */
export interface ProjectHierarchy {
  project: Project;
  epics: Epic[];
  total_story_points: number;
  completed_story_points: number;
  progress_percentage: number;
  active_sprints: number;
  team_velocity: number;
}

// Forward declaration for Epic (defined in epic.ts)
interface Epic {
  id: string;
  title: string;
  [key: string]: unknown;
}

// ============================================================================
// PROJECT PERMISSIONS
// ============================================================================

/**
 * Project permission roles
 */
export type ProjectRole = 'admin' | 'lead' | 'developer' | 'viewer';

/**
 * Project permission assignment
 */
export interface ProjectPermission {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  granted_by: string;
  granted_at: string;
}

/**
 * Project role definition
 */
export interface ProjectRoleDefinition {
  id: string;
  name: string;
  description?: string;
  permissions: string[];
  is_default: boolean;
}

// ============================================================================
// PROJECT ANALYTICS
// ============================================================================

/**
 * Velocity trend data point
 */
export interface VelocityTrend {
  period: string; // sprint name or date range
  planned_points: number;
  completed_points: number;
  team_capacity: number;
}

/**
 * Burndown chart data point
 */
export interface BurndownPoint {
  date: string;
  remaining_points: number;
  ideal_remaining: number;
  actual_remaining: number;
}

/**
 * Project analytics data
 */
export interface ProjectAnalytics {
  project_id: string;
  date_range: {
    start_date: string;
    end_date: string;
  };
  metrics: {
    epic_completion_rate: number;
    team_velocity: number;
    scope_creep_percentage: number;
    defect_density: number;
  };
  trends: {
    velocity_trend: VelocityTrend[];
    burndown_data: BurndownPoint[];
    completion_forecast: string;
  };
}

// ============================================================================
// PROJECT TEMPLATES
// ============================================================================

/**
 * Workflow transition rule
 */
export interface WorkflowTransition {
  from_status: string;
  to_status: string;
  conditions?: string[];
  validators?: string[];
  post_functions?: string[];
}

/**
 * Project template for standardization
 */
export interface ProjectTemplate {
  id: string;
  name: string;
  description?: string;
  project_type: ProjectType;
  default_board_config: Omit<BoardCreate, 'project_id'>;
  default_epic_structure: {
    epic_types: string[];
    default_components: string[];
    default_labels: string[];
  };
  workflow_config: {
    transitions: WorkflowTransition[];
  };
}

// ============================================================================
// PROJECT FILTERS
// ============================================================================

/**
 * Project filter options
 */
export interface ProjectFilters {
  status?: ProjectStatus[];
  project_type?: ProjectType[];
  lead_id?: string;
  team_id?: string;
  organization_id?: string;
  created_after?: string;
  created_before?: string;
  has_active_epics?: boolean;
  search?: string;
  tags?: string[];
}

// ============================================================================
// PROJECT SETTINGS
// ============================================================================

/**
 * Project custom field
 */
export interface ProjectCustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect';
  required: boolean;
  default_value?: string | number | string[];
  options?: string[];
  applies_to: ('epic' | 'subtask')[];
}

/**
 * Project settings
 */
export interface ProjectSettings {
  project_id: string;
  settings: {
    notify_on_epic_completion: boolean;
    notify_on_sprint_start: boolean;
    external_integration?: {
      enabled: boolean;
      instance_url: string;
      project_key: string;
    };
    custom_fields: ProjectCustomField[];
  };
}
