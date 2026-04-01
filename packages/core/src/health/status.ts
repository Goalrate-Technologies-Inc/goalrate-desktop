/**
 * Health Status Determination
 * Functions for determining and displaying health status of goals and projects
 */

import type {
  HealthStatus,
  HealthStatusColorKey,
  ProgressDisplayInfo,
  HealthStatusInfo,
  GoalHealthStatusInfo,
  ProjectHealthStatusInfo,
  HealthStatusConfig,
  Goal,
  Board,
} from '@goalrate-app/shared';
import { DEFAULT_HEALTH_CONFIG } from '@goalrate-app/shared';
import {
  calculateExpectedProgress,
  getDaysFromDeadline,
  isDeadlinePast,
  calculateProgressFromItems,
} from './progress';

// ============================================================================
// HEALTH STATUS DETERMINATION
// ============================================================================

/**
 * Determine health status based on progress variance and deadline
 *
 * @param actualProgress - Actual progress (0-100)
 * @param expectedProgress - Expected progress (0-100)
 * @param deadline - Deadline date string
 * @param today - Reference date
 * @param config - Health status configuration
 * @returns HealthStatus
 */
export function determineHealthStatus(
  actualProgress: number,
  expectedProgress: number,
  deadline: string | null | undefined,
  today: Date = new Date(),
  config: HealthStatusConfig = DEFAULT_HEALTH_CONFIG
): HealthStatus {
  const variance = actualProgress - expectedProgress;

  // Completed
  if (actualProgress >= 100) {
    return 'completed';
  }

  // Check overdue status
  if (isDeadlinePast(deadline, today)) {
    const daysOverdue = Math.abs(getDaysFromDeadline(deadline, today));
    if (daysOverdue <= config.overdueLightDays) {
      return 'overdueLight';
    }
    return 'overdue';
  }

  // Not started
  if (actualProgress === 0 && expectedProgress < 10) {
    return 'notStarted';
  }

  // Ahead of schedule
  if (variance > config.aheadStrongThreshold) {
    return 'aheadStrong';
  }
  if (variance > config.aheadThreshold) {
    return 'ahead';
  }

  // On track
  if (variance >= config.onTrackThreshold) {
    return 'onTrack';
  }

  // Slipping
  if (variance >= config.slippingThreshold) {
    return 'onTrackSlipping';
  }

  // At risk
  if (variance >= config.atRiskLightThreshold) {
    return 'atRiskLight';
  }

  return 'atRisk';
}

/**
 * Get label text for a health status
 *
 * @param status - Health status
 * @param progress - Actual progress percentage
 * @returns Human-readable label
 */
export function getHealthStatusLabel(
  status: HealthStatus,
  progress: number
): string {
  const progressText = `${Math.round(progress)}%`;

  switch (status) {
    case 'completed':
      return '100% Complete';
    case 'aheadStrong':
      return `${progressText} - Way ahead!`;
    case 'ahead':
      return `${progressText} - Ahead`;
    case 'onTrack':
      return `${progressText} - On track`;
    case 'onTrackSlipping':
      return `${progressText} - Slipping`;
    case 'atRiskLight':
      return `${progressText} - At risk`;
    case 'atRisk':
      return `${progressText} - High risk`;
    case 'overdueLight':
      return `${progressText} - Just past due`;
    case 'overdue':
      return `${progressText} - Overdue`;
    case 'notStarted':
      return 'Not started';
    default:
      return progressText;
  }
}

/**
 * Get description for a health status
 *
 * @param status - Health status
 * @returns Human-readable description
 */
export function getHealthStatusDescription(status: HealthStatus): string {
  switch (status) {
    case 'completed':
      return 'All tasks completed successfully';
    case 'aheadStrong':
      return 'Significantly ahead of schedule';
    case 'ahead':
      return 'Ahead of schedule';
    case 'onTrack':
      return 'Progressing as expected';
    case 'onTrackSlipping':
      return 'Starting to fall behind';
    case 'atRiskLight':
      return 'Needs attention to stay on track';
    case 'atRisk':
      return 'Requires immediate attention';
    case 'overdueLight':
      return 'Just past the deadline';
    case 'overdue':
      return 'Significantly past deadline';
    case 'notStarted':
      return 'Ready to begin';
    default:
      return 'Status unknown';
  }
}

// ============================================================================
// COLOR MAPPING
// ============================================================================

/**
 * Get semantic color key for a health status
 *
 * Returns a semantic key that each platform can map to their styling system.
 * This avoids coupling to any specific CSS framework.
 *
 * @param status - Health status
 * @returns Semantic color key
 */
export function getHealthStatusColor(status: HealthStatus): HealthStatusColorKey {
  switch (status) {
    case 'completed':
      return 'success';
    case 'aheadStrong':
      return 'info';
    case 'ahead':
      return 'infoLight';
    case 'onTrack':
      return 'success';
    case 'onTrackSlipping':
      return 'warningLight';
    case 'atRiskLight':
      return 'warning';
    case 'atRisk':
      return 'dangerLight';
    case 'overdueLight':
      return 'dangerLight';
    case 'overdue':
      return 'danger';
    case 'notStarted':
      return 'neutral';
    default:
      return 'neutral';
  }
}

// ============================================================================
// PROGRESS DISPLAY INFO
// ============================================================================

/**
 * Get comprehensive progress display information
 *
 * @param progress - Actual progress (0-100)
 * @param deadline - Deadline date string
 * @param startDate - Start date string
 * @param today - Reference date
 * @returns ProgressDisplayInfo
 */
export function getProgressDisplayInfo(
  progress: number,
  deadline: string | null | undefined,
  startDate: string | null | undefined,
  today: Date = new Date()
): ProgressDisplayInfo {
  const actualProgress = Math.min(100, Math.max(0, progress));
  const expectedProgress = calculateExpectedProgress(deadline, startDate, today);
  const variance = actualProgress - expectedProgress;
  const healthStatus = determineHealthStatus(
    actualProgress,
    expectedProgress,
    deadline,
    today
  );
  const label = getHealthStatusLabel(healthStatus, actualProgress);

  return {
    healthStatus,
    label,
    expectedProgress,
    actualProgress,
    variance,
  };
}

// ============================================================================
// ENTITY-SPECIFIC HEALTH STATUS
// ============================================================================

/**
 * Get health status for a goal
 *
 * @param goal - Goal entity
 * @param today - Reference date
 * @returns GoalHealthStatusInfo
 */
export function getGoalHealthStatus(
  goal: Goal,
  today: Date = new Date()
): GoalHealthStatusInfo {
  const progress = goal.progress ?? 0;
  const deadline = goal.deadline;
  // Goal uses camelCase (createdAt)
  const startDate = goal.createdAt;

  const displayInfo = getProgressDisplayInfo(progress, deadline, startDate, today);
  const description = getHealthStatusDescription(displayInfo.healthStatus);
  const color = getHealthStatusColor(displayInfo.healthStatus);

  return {
    status: displayInfo.healthStatus,
    color,
    label: displayInfo.label,
    description,
    progress,
    deadline: deadline ?? undefined,
  };
}

/**
 * Get health status for a project/board
 *
 * Note: Board type uses 'progress' directly rather than item counts.
 * Item counts can be passed in via options if available from context.
 *
 * @param project - Project/Board entity
 * @param today - Reference date
 * @param options - Optional item counts
 * @returns ProjectHealthStatusInfo
 */
export function getProjectHealthStatus(
  project: Board,
  today: Date = new Date(),
  options?: { completedItems?: number; totalItems?: number }
): ProjectHealthStatusInfo {
  // Use Board's progress directly, or calculate from item counts if provided
  const totalItems = options?.totalItems ?? 0;
  const completedItems = options?.completedItems ?? 0;

  // Board has direct progress field, or calculate from item counts
  const progressPercentage = project.progress ?? (
    totalItems > 0 ? calculateProgressFromItems(completedItems, totalItems) : 0
  );

  // Board uses target_date, not end_date
  const deadline = project.target_date;
  // Board uses snake_case (start_date, created_at)
  const startDate = project.start_date ?? project.created_at;

  const displayInfo = getProgressDisplayInfo(
    progressPercentage,
    deadline,
    startDate,
    today
  );
  const description = getHealthStatusDescription(displayInfo.healthStatus);
  const color = getHealthStatusColor(displayInfo.healthStatus);

  return {
    status: displayInfo.healthStatus,
    color,
    label: displayInfo.label,
    description,
    completedItems,
    totalItems,
    progressPercentage,
  };
}

/**
 * Get health status info from a status value
 *
 * @param status - Health status
 * @param progress - Actual progress (optional, for label)
 * @returns HealthStatusInfo
 */
export function getHealthStatusInfo(
  status: HealthStatus,
  progress: number = 0
): HealthStatusInfo {
  return {
    status,
    color: getHealthStatusColor(status),
    label: getHealthStatusLabel(status, progress),
    description: getHealthStatusDescription(status),
  };
}
