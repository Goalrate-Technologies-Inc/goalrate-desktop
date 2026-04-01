/**
 * Sprint Types
 * Sprint management types for Scrum/Scrumban workflows
 */

import type { SprintStatus } from './common';

// ============================================================================
// SPRINT TYPES
// ============================================================================

/**
 * Sprint interface
 */
export interface Sprint {
  id: string;
  name: string;
  goal?: string;
  status: SprintStatus;
  start_date: string;
  end_date: string;
  project_id: string; // Sprints belong to Projects
  velocity: number; // Team velocity (historical)
  completed_points: number; // Story points completed this sprint
  total_points: number; // Total story points planned
  created_at: string;
  updated_at: string;
}

/**
 * Sprint creation data
 */
export interface SprintCreate {
  name: string;
  start_date: string; // ISO date string
  end_date: string; // ISO date string
  goal?: string;
  total_points?: number;
  project_id: string;
}

/**
 * Sprint update data
 */
export interface SprintUpdate {
  name?: string;
  status?: SprintStatus;
  goal?: string;
  velocity?: number;
  completed_points?: number;
  total_points?: number;
  start_date?: string;
  end_date?: string;
}

// ============================================================================
// SPRINT METRICS
// ============================================================================

/**
 * Sprint burndown entry (from PRD)
 */
export interface BurndownEntry {
  date: string;
  remaining_points: number;
  ideal_remaining: number;
  actual_remaining?: number;
}

/**
 * Sprint retrospective
 */
export interface Retrospective {
  id: string;
  sprint_id: string;
  went_well: string[];
  to_improve: string[];
  action_items: RetrospectiveAction[];
  created_at: string;
  updated_at?: string;
}

/**
 * Retrospective action item
 */
export interface RetrospectiveAction {
  id: string;
  description: string;
  assignee_id?: string;
  completed: boolean;
  due_date?: string;
}

// ============================================================================
// SPRINT ANALYTICS
// ============================================================================

/**
 * Sprint velocity data
 */
export interface SprintVelocity {
  sprint_id: string;
  sprint_name: string;
  planned_points: number;
  completed_points: number;
  velocity: number;
  completion_rate: number;
}

/**
 * Sprint summary for dashboard
 */
export interface SprintSummary {
  id: string;
  name: string;
  status: SprintStatus;
  start_date: string;
  end_date: string;
  total_points: number;
  completed_points: number;
  completion_rate: number;
  days_remaining: number;
  velocity?: number;
}

/**
 * Sprint capacity planning
 */
export interface SprintCapacity {
  sprint_id: string;
  team_capacity: number; // Total available hours
  allocated_points: number;
  remaining_capacity: number;
  team_members: SprintTeamMember[];
}

/**
 * Team member sprint capacity
 */
export interface SprintTeamMember {
  user_id: string;
  display_name: string;
  avatar_url?: string;
  available_hours: number;
  allocated_hours: number;
}

// ============================================================================
// SPRINT PLANNING
// ============================================================================

/**
 * Sprint planning session
 */
export interface SprintPlanningSession {
  id: string;
  sprint_id: string;
  date: string;
  participants: string[];
  total_points_committed: number;
  notes?: string;
  created_at: string;
}

/**
 * Sprint goal tracking
 */
export interface SprintGoalTracking {
  sprint_id: string;
  goal: string;
  progress: number; // 0-100
  key_results: SprintKeyResult[];
}

/**
 * Sprint key result
 */
export interface SprintKeyResult {
  id: string;
  description: string;
  target_value: number;
  current_value: number;
  completed: boolean;
}

// ============================================================================
// ENHANCED SPRINT (PRD-specified)
// ============================================================================

/**
 * Enhanced sprint from PRD with full metadata
 */
export interface EnhancedSprint {
  id: string;
  projectId: string;
  name: string;
  start: string;
  end: string;
  goal: string;
  committedPoints: number;
  completedPoints: number;
  burndown: BurndownEntry[];
  velocity?: number;
  retro?: Retrospective;
}
