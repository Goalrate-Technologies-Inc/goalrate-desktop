/**
 * Common Types
 * Shared primitives and base types used across all domain entities
 */

// ============================================================================
// PRIORITY TYPES
// ============================================================================

/**
 * Standard priority levels used across goals and tasks.
 */
export type Priority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Extended priority with lowest/highest for finer granularity.
 */
export type ExtendedPriority = 'lowest' | 'low' | 'medium' | 'high' | 'highest';

// ============================================================================
// STATUS TYPES
// ============================================================================

/**
 * Generic entity status for goals, projects
 */
export type EntityStatus = 'active' | 'completed' | 'archived';

/**
 * Project-specific status values
 */
export type ProjectStatus = 'active' | 'completed' | 'archived' | 'on_hold' | 'planning';

/**
 * All valid project statuses array
 */
export const PROJECT_STATUSES: ProjectStatus[] = [
  'active',
  'completed',
  'archived',
  'on_hold',
  'planning',
];

/**
 * Task workflow status values
 */
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

/**
 * Board column status for kanban boards
 */
export type BoardStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';

/**
 * Sprint status values
 */
export type SprintStatus = 'future' | 'active' | 'completed';

/**
 * Epic status values
 */
export type EpicStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';

// ============================================================================
// VISIBILITY TYPES
// ============================================================================

/**
 * Content visibility levels
 */
export type Visibility = 'public' | 'private' | 'followers';

/**
 * Project visibility levels
 */
export type ProjectVisibility = 'private' | 'internal' | 'public';

/**
 * Workspace privacy levels
 */
export type WorkspacePrivacyLevel = 'public' | 'private' | 'invite_only';

// ============================================================================
// TIMESTAMP TYPES
// ============================================================================

/**
 * Standard timestamp fields
 */
export interface Timestamps {
  created_at: string;
  updated_at?: string;
}

/**
 * Extended timestamps with deletion tracking
 */
export interface ExtendedTimestamps extends Timestamps {
  deleted_at?: string;
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Alternative pagination format (for activity feeds)
 */
export interface PaginatedList<T> {
  items: T[];
  total_count: number;
  page: number;
  per_page: number;
  has_more: boolean;
}

// ============================================================================
// SERVICE RESPONSE TYPES
// ============================================================================

/**
 * User-friendly error structure
 */
export interface UserFriendlyError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Standard service response wrapper
 */
export interface ServiceResponse<T> {
  data?: T;
  error?: UserFriendlyError;
  status: 'success' | 'error' | 'unavailable';
  source: 'cache' | 'api' | 'fallback';
  timestamp: Date;
}

/**
 * Service error with original error context
 */
export interface ServiceError extends UserFriendlyError {
  originalError?: unknown;
}

// ============================================================================
// PROJECT STATUS DISPLAY
// ============================================================================

/**
 * Status display configuration for UI
 */
export interface StatusDisplayConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

/**
 * Get display configuration for a project status
 */
export function getProjectStatusConfig(status: ProjectStatus): StatusDisplayConfig {
  switch (status) {
    case 'active':
      return {
        label: 'Active',
        color: 'text-green-700',
        bgColor: 'bg-green-100',
        borderColor: 'border-green-300',
      };
    case 'completed':
      return {
        label: 'Completed',
        color: 'text-blue-700',
        bgColor: 'bg-blue-100',
        borderColor: 'border-blue-300',
      };
    case 'archived':
      return {
        label: 'Archived',
        color: 'text-gray-700',
        bgColor: 'bg-gray-100',
        borderColor: 'border-gray-300',
      };
    case 'on_hold':
      return {
        label: 'On Hold',
        color: 'text-yellow-700',
        bgColor: 'bg-yellow-100',
        borderColor: 'border-yellow-300',
      };
    case 'planning':
      return {
        label: 'Planning',
        color: 'text-purple-700',
        bgColor: 'bg-purple-100',
        borderColor: 'border-purple-300',
      };
    default:
      return {
        label: status,
        color: 'text-gray-700',
        bgColor: 'bg-gray-100',
        borderColor: 'border-gray-300',
      };
  }
}

/**
 * Check if a status is a valid ProjectStatus
 */
export function isValidProjectStatus(status: string): status is ProjectStatus {
  return PROJECT_STATUSES.includes(status as ProjectStatus);
}

/**
 * Get the next logical status in the workflow
 */
export function getNextStatus(current: ProjectStatus): ProjectStatus | null {
  const workflow: Record<ProjectStatus, ProjectStatus | null> = {
    planning: 'active',
    active: 'completed',
    completed: 'archived',
    on_hold: 'active',
    archived: null,
  };
  return workflow[current];
}
