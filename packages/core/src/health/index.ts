/**
 * Health Module
 * Progress tracking and health status determination
 */

// Re-export types from shared
export type {
  HealthStatus,
  HealthStatusColorKey,
  ProgressDisplayInfo,
  HealthStatusInfo,
  GoalHealthStatusInfo,
  ProjectHealthStatusInfo,
  HealthStatusConfig,
} from '@goalrate-app/shared';

export { DEFAULT_HEALTH_CONFIG } from '@goalrate-app/shared';

// Export progress functions
export {
  calculateExpectedProgress,
  getDaysFromDeadline,
  isDeadlinePast,
  calculateProgressVariance,
  calculateProgressFromItems,
  calculateProgressFromPoints,
} from './progress';

// Export status functions
export {
  determineHealthStatus,
  getHealthStatusLabel,
  getHealthStatusDescription,
  getHealthStatusColor,
  getProgressDisplayInfo,
  getGoalHealthStatus,
  getProjectHealthStatus,
  getHealthStatusInfo,
} from './status';
