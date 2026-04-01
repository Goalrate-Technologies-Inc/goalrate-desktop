/**
 * Health Status Types
 * Types for progress tracking and health status determination
 * Used by @goalrate-app/core health module
 */

// ============================================================================
// HEALTH STATUS TYPES
// ============================================================================

/**
 * 10-level health status system
 * Provides granular progress tracking from excellent to critical
 */
export type HealthStatus =
  | 'completed'       // 100% done
  | 'aheadStrong'     // Significantly ahead of schedule (>20% ahead)
  | 'ahead'           // Ahead of schedule (5-20% ahead)
  | 'onTrack'         // On schedule (within 5%)
  | 'onTrackSlipping' // Starting to fall behind (5-15% behind)
  | 'atRiskLight'     // Moderately at risk (15-30% behind)
  | 'atRisk'          // Significantly at risk (>30% behind, not overdue)
  | 'overdueLight'    // Just past deadline (<7 days)
  | 'overdue'         // Significantly overdue (>7 days)
  | 'notStarted';     // 0% progress, no deadline pressure

/**
 * Semantic color keys for health status
 * Each platform maps these to their styling system
 */
export type HealthStatusColorKey =
  | 'success'
  | 'successLight'
  | 'info'
  | 'infoLight'
  | 'warning'
  | 'warningLight'
  | 'danger'
  | 'dangerLight'
  | 'neutral';

// ============================================================================
// PROGRESS DISPLAY TYPES
// ============================================================================

/**
 * Comprehensive progress display information
 */
export interface ProgressDisplayInfo {
  healthStatus: HealthStatus;
  label: string;
  expectedProgress: number;
  actualProgress: number;
  variance: number;
}

/**
 * Health status information for display
 */
export interface HealthStatusInfo {
  status: HealthStatus;
  color: HealthStatusColorKey;
  label: string;
  description: string;
}

/**
 * Extended health status for goals
 */
export interface GoalHealthStatusInfo extends HealthStatusInfo {
  progress: number;
  deadline?: string;
}

/**
 * Extended health status for projects/boards
 */
export interface ProjectHealthStatusInfo extends HealthStatusInfo {
  completedItems: number;
  totalItems: number;
  progressPercentage: number;
}

// ============================================================================
// HEALTH STATUS CONFIGURATION
// ============================================================================

/**
 * Configuration for health status thresholds
 */
export interface HealthStatusConfig {
  /** Threshold for "ahead strong" (default: 20) */
  aheadStrongThreshold: number;
  /** Threshold for "ahead" (default: 5) */
  aheadThreshold: number;
  /** Threshold for "on track" (default: -5) */
  onTrackThreshold: number;
  /** Threshold for "slipping" (default: -15) */
  slippingThreshold: number;
  /** Threshold for "at risk light" (default: -30) */
  atRiskLightThreshold: number;
  /** Days overdue for "overdue light" (default: 7) */
  overdueLightDays: number;
}

/**
 * Default health status configuration
 */
export const DEFAULT_HEALTH_CONFIG: HealthStatusConfig = {
  aheadStrongThreshold: 20,
  aheadThreshold: 5,
  onTrackThreshold: -5,
  slippingThreshold: -15,
  atRiskLightThreshold: -30,
  overdueLightDays: 7,
};
