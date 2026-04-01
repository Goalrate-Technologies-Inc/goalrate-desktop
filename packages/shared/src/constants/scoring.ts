/**
 * Focus Scoring Constants
 * Weights and thresholds for the Today's Focus scoring algorithm
 * Based on PRD specification
 */

// ============================================================================
// FOCUS SCORING WEIGHTS
// ============================================================================

/**
 * Focus scoring weights (from PRD)
 * Total maximum score: 100
 */
export const FOCUS_SCORING = {
  /**
   * Deadline scoring (max 30 points)
   * Higher urgency = higher score
   */
  DEADLINE: {
    MAX: 30,
    OVERDUE: 30, // Task is past due
    TODAY: 28, // Due today
    WEEK: 20, // Due within 7 days
    MONTH: 10, // Due within 30 days
    LATER: 5, // Due later or no deadline
  },

  /**
   * Blocking scoring (max 25 points)
   * Tasks that unblock others get priority
   */
  BLOCKING: {
    MAX: 25,
    PEOPLE: 25, // Blocks teammates
    MULTIPLE: 20, // Blocks multiple items
    SINGLE: 15, // Blocks one item
    NONE: 0, // Blocks nothing
  },

  /**
   * Priority scoring (max 20 points)
   * Based on task priority level
   */
  PRIORITY: {
    MAX: 20,
    CRITICAL: 20,
    HIGH: 15,
    MEDIUM: 10,
    LOW: 5,
  },

  /**
   * Streak scoring (max 15 points)
   * Protect and build streaks
   */
  STREAK: {
    MAX: 15,
    AT_RISK: 15, // Streak at risk of breaking
    ACTIVE: 10, // Active streak
    NONE: 0, // No streak
  },

  /**
   * Sprint scoring (max 10 points)
   * Prioritize current sprint items
   */
  SPRINT: {
    MAX: 10,
    IN_SPRINT: 10, // In current sprint
    NOT_IN_SPRINT: 0, // Not in sprint
  },
} as const;

// ============================================================================
// DEADLINE THRESHOLDS
// ============================================================================

/**
 * Deadline threshold days
 */
export const DEADLINE_THRESHOLDS = {
  /** Considered overdue (days in past) */
  OVERDUE: 0,
  /** Due today threshold */
  TODAY: 0,
  /** Due this week threshold (days) */
  WEEK: 7,
  /** Due this month threshold (days) */
  MONTH: 30,
} as const;

// ============================================================================
// CAPACITY DEFAULTS
// ============================================================================

/**
 * Default capacity settings
 */
export const CAPACITY_DEFAULTS = {
  /** Default available hours per day */
  DEFAULT_HOURS: 6,
  /** Default points per hour */
  POINTS_PER_HOUR: 1.5,
  /** Minimum points to plan */
  MIN_POINTS: 1,
  /** Maximum points per day */
  MAX_POINTS: 15,
  /** Story point values (Fibonacci) */
  STORY_POINTS: [1, 2, 3, 5, 8, 13, 21] as const,
} as const;

// ============================================================================
// SCORING HELPERS
// ============================================================================

/**
 * Calculate deadline score based on days until due
 */
export function calculateDeadlineScore(daysUntilDue: number | null): number {
  if (daysUntilDue === null) {
    return FOCUS_SCORING.DEADLINE.LATER;
  }

  if (daysUntilDue < DEADLINE_THRESHOLDS.OVERDUE) {
    return FOCUS_SCORING.DEADLINE.OVERDUE;
  }

  if (daysUntilDue === DEADLINE_THRESHOLDS.TODAY) {
    return FOCUS_SCORING.DEADLINE.TODAY;
  }

  if (daysUntilDue <= DEADLINE_THRESHOLDS.WEEK) {
    return FOCUS_SCORING.DEADLINE.WEEK;
  }

  if (daysUntilDue <= DEADLINE_THRESHOLDS.MONTH) {
    return FOCUS_SCORING.DEADLINE.MONTH;
  }

  return FOCUS_SCORING.DEADLINE.LATER;
}

/**
 * Calculate blocking score based on blocked items
 */
export function calculateBlockingScore(
  blockedItems: number,
  blocksPeople: boolean
): number {
  if (blocksPeople) {
    return FOCUS_SCORING.BLOCKING.PEOPLE;
  }

  if (blockedItems > 1) {
    return FOCUS_SCORING.BLOCKING.MULTIPLE;
  }

  if (blockedItems === 1) {
    return FOCUS_SCORING.BLOCKING.SINGLE;
  }

  return FOCUS_SCORING.BLOCKING.NONE;
}

/**
 * Calculate priority score
 */
export function calculatePriorityScore(
  priority: 'low' | 'medium' | 'high' | 'critical'
): number {
  switch (priority) {
    case 'critical':
      return FOCUS_SCORING.PRIORITY.CRITICAL;
    case 'high':
      return FOCUS_SCORING.PRIORITY.HIGH;
    case 'medium':
      return FOCUS_SCORING.PRIORITY.MEDIUM;
    case 'low':
    default:
      return FOCUS_SCORING.PRIORITY.LOW;
  }
}

/**
 * Calculate streak score
 */
export function calculateStreakScore(
  currentStreak: number,
  streakAtRisk: boolean
): number {
  if (streakAtRisk && currentStreak > 0) {
    return FOCUS_SCORING.STREAK.AT_RISK;
  }

  if (currentStreak > 0) {
    return FOCUS_SCORING.STREAK.ACTIVE;
  }

  return FOCUS_SCORING.STREAK.NONE;
}

/**
 * Calculate sprint score
 */
export function calculateSprintScore(inCurrentSprint: boolean): number {
  return inCurrentSprint
    ? FOCUS_SCORING.SPRINT.IN_SPRINT
    : FOCUS_SCORING.SPRINT.NOT_IN_SPRINT;
}

/**
 * Calculate total focus score
 */
export function calculateTotalFocusScore(params: {
  daysUntilDue: number | null;
  blockedItems: number;
  blocksPeople: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
  currentStreak: number;
  streakAtRisk: boolean;
  inCurrentSprint: boolean;
}): number {
  return (
    calculateDeadlineScore(params.daysUntilDue) +
    calculateBlockingScore(params.blockedItems, params.blocksPeople) +
    calculatePriorityScore(params.priority) +
    calculateStreakScore(params.currentStreak, params.streakAtRisk) +
    calculateSprintScore(params.inCurrentSprint)
  );
}

/**
 * Calculate point capacity based on available hours
 */
export function calculatePointCapacity(availableHours: number): number {
  const calculated = Math.round(availableHours * CAPACITY_DEFAULTS.POINTS_PER_HOUR);
  return Math.max(
    CAPACITY_DEFAULTS.MIN_POINTS,
    Math.min(CAPACITY_DEFAULTS.MAX_POINTS, calculated)
  );
}
