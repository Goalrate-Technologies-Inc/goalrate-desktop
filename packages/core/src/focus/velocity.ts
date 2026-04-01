/**
 * Velocity Calculation Functions
 * Core functions for calculating focus velocity metrics
 */

import type { FocusDay, FocusVelocity } from '@goalrate-app/shared';

// ============================================================================
// DATE UTILITY HELPERS (local to this module to avoid timezone issues)
// Uses UTC consistently to avoid local timezone conversion issues
// ============================================================================

/**
 * Convert a Date to YYYY-MM-DD string using UTC
 * This avoids local timezone conversion issues
 */
function toDateString(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Add days to a date string and return new date string
 * Works entirely with YYYY-MM-DD strings to avoid timezone issues
 */
function addDaysToDateString(dateStr: string, days: number): string {
  // Parse as UTC to avoid timezone shifts
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Velocity trend direction
 */
export type VelocityTrendDirection = 'up' | 'down' | 'stable';

/**
 * Options for velocity calculation
 */
export interface VelocityCalculationOptions {
  /** Reference date for calculations (defaults to today) */
  today?: Date;
  /** Minimum change percentage to count as a trend (default: 10) */
  trendThreshold?: number;
}

// ============================================================================
// AVERAGE CALCULATIONS
// ============================================================================

/**
 * Calculate the average points completed per day
 * @param focusDays - Array of FocusDay records
 * @returns Average points per day (0 if no data)
 */
export function calculateAveragePointsPerDay(focusDays: FocusDay[]): number {
  if (focusDays.length === 0) {
    return 0;
  }

  const totalPoints = focusDays.reduce(
    (sum, day) => sum + day.completedPoints,
    0
  );

  return totalPoints / focusDays.length;
}

/**
 * Calculate the average completion rate across all days
 * @param focusDays - Array of FocusDay records
 * @returns Average completion rate (0-100)
 */
export function calculateAverageCompletionRate(focusDays: FocusDay[]): number {
  if (focusDays.length === 0) {
    return 0;
  }

  // Only count days that had planned points
  const daysWithPlannedWork = focusDays.filter(day => day.plannedPoints > 0);

  if (daysWithPlannedWork.length === 0) {
    return 0;
  }

  const totalRate = daysWithPlannedWork.reduce((sum, day) => {
    const rate = (day.completedPoints / day.plannedPoints) * 100;
    return sum + Math.min(rate, 100); // Cap at 100%
  }, 0);

  return totalRate / daysWithPlannedWork.length;
}

// ============================================================================
// STREAK CALCULATIONS
// ============================================================================

/**
 * Check if a focus day counts as "active" for streak purposes
 * A day is active if it has at least one completed item
 */
function isDayActive(day: FocusDay): boolean {
  return day.completedItems > 0;
}

/**
 * Calculate the current consecutive day streak
 * A streak is broken if there's a gap of more than 1 day without activity
 * @param focusDays - Array of FocusDay records
 * @param today - Reference date (defaults to today)
 * @returns Current streak count
 */
export function calculateCurrentStreak(
  focusDays: FocusDay[],
  today: Date = new Date()
): number {
  if (focusDays.length === 0) {
    return 0;
  }

  // Build a set of dates with activity for O(1) lookup
  const activeDates = new Set<string>();
  for (const day of focusDays) {
    if (isDayActive(day)) {
      activeDates.add(day.date);
    }
  }

  if (activeDates.size === 0) {
    return 0;
  }

  // Use local date string to avoid timezone issues
  const todayStr = toDateString(today);
  const yesterdayStr = addDaysToDateString(todayStr, -1);

  // Check if there's activity today or yesterday to start the streak
  let streak = 0;
  let currentDateStr: string;

  if (activeDates.has(todayStr)) {
    streak = 1;
    currentDateStr = todayStr;
  } else if (activeDates.has(yesterdayStr)) {
    streak = 1;
    currentDateStr = yesterdayStr;
  } else {
    // No activity today or yesterday = no current streak
    return 0;
  }

  // Count backwards from the starting point
  for (;;) {
    const prevStr = addDaysToDateString(currentDateStr, -1);

    if (activeDates.has(prevStr)) {
      streak++;
      currentDateStr = prevStr;
    } else {
      // Gap found, stop counting
      break;
    }
  }

  return streak;
}

/**
 * Calculate the longest streak ever achieved
 * @param focusDays - Array of FocusDay records
 * @returns Longest streak count
 */
export function calculateLongestStreak(focusDays: FocusDay[]): number {
  if (focusDays.length === 0) {
    return 0;
  }

  // Sort by date ascending for streak calculation (string comparison works for YYYY-MM-DD)
  const sorted = [...focusDays].sort((a, b) => a.date.localeCompare(b.date));

  let longestStreak = 0;
  let currentStreak = 0;
  let previousDateStr: string | null = null;

  for (const day of sorted) {
    if (!isDayActive(day)) {
      // Reset streak if day has no activity
      currentStreak = 0;
      previousDateStr = null;
      continue;
    }

    if (previousDateStr === null) {
      // First active day
      currentStreak = 1;
    } else {
      // Check if this day is exactly one day after the previous
      const expectedDateStr = addDaysToDateString(previousDateStr, 1);

      if (day.date === expectedDateStr) {
        // Consecutive day - extend streak
        currentStreak++;
      } else if (day.date === previousDateStr) {
        // Same day (duplicate entry) - ignore
        continue;
      } else {
        // Gap found - reset streak
        currentStreak = 1;
      }
    }

    previousDateStr = day.date;
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  return longestStreak;
}

// ============================================================================
// TREND CALCULATIONS
// ============================================================================

/**
 * Get focus days for the last N days, filling in zeros for missing days
 * @param focusDays - Array of FocusDay records
 * @param days - Number of days to include
 * @param today - Reference date
 * @returns Array of completed points for each day (oldest to newest)
 */
function getPointsForLastNDays(
  focusDays: FocusDay[],
  days: number,
  today: Date
): number[] {
  const result: number[] = [];
  const dayMap = new Map<string, number>();

  // Build a map of date -> points
  for (const day of focusDays) {
    dayMap.set(day.date, day.completedPoints);
  }

  // Use local date string to avoid timezone issues
  const todayStr = toDateString(today);

  // Generate array for last N days (oldest first)
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = addDaysToDateString(todayStr, -i);
    result.push(dayMap.get(dateStr) ?? 0);
  }

  return result;
}

/**
 * Calculate the weekly trend (last 7 days of points)
 * @param focusDays - Array of FocusDay records
 * @param today - Reference date
 * @returns Array of 7 numbers representing points per day (oldest to newest)
 */
export function calculateWeeklyTrend(
  focusDays: FocusDay[],
  today: Date = new Date()
): number[] {
  return getPointsForLastNDays(focusDays, 7, today);
}

/**
 * Calculate the monthly trend (last 30 days of points)
 * @param focusDays - Array of FocusDay records
 * @param today - Reference date
 * @returns Array of 30 numbers representing points per day (oldest to newest)
 */
export function calculateMonthlyTrend(
  focusDays: FocusDay[],
  today: Date = new Date()
): number[] {
  return getPointsForLastNDays(focusDays, 30, today);
}

/**
 * Determine the trend direction from a series of values
 * Compares first half average to second half average
 * @param values - Array of numeric values (oldest to newest)
 * @param threshold - Percentage change threshold to count as up/down (default: 10)
 * @returns Trend direction
 */
export function determineTrendDirection(
  values: number[],
  threshold: number = 10
): VelocityTrendDirection {
  if (values.length < 2) {
    return 'stable';
  }

  const midpoint = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, midpoint);
  const secondHalf = values.slice(midpoint);

  const firstAvg =
    firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length || 0;
  const secondAvg =
    secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length || 0;

  if (firstAvg === 0 && secondAvg === 0) {
    return 'stable';
  }

  if (firstAvg === 0) {
    return secondAvg > 0 ? 'up' : 'stable';
  }

  const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;

  if (percentChange >= threshold) {
    return 'up';
  }
  if (percentChange <= -threshold) {
    return 'down';
  }
  return 'stable';
}

// ============================================================================
// MAIN VELOCITY FUNCTION
// ============================================================================

/**
 * Calculate complete velocity metrics from focus day history
 * @param focusDays - Array of FocusDay records
 * @param options - Calculation options
 * @returns Complete FocusVelocity object
 */
export function calculateVelocity(
  focusDays: FocusDay[],
  options: VelocityCalculationOptions = {}
): FocusVelocity {
  const { today = new Date() } = options;

  const averagePointsPerDay = calculateAveragePointsPerDay(focusDays);
  const averageCompletionRate = calculateAverageCompletionRate(focusDays);
  const currentStreak = calculateCurrentStreak(focusDays, today);
  const longestStreak = calculateLongestStreak(focusDays);
  const weeklyTrend = calculateWeeklyTrend(focusDays, today);

  return {
    averagePointsPerDay: Math.round(averagePointsPerDay * 10) / 10, // 1 decimal place
    averageCompletionRate: Math.round(averageCompletionRate), // Whole number
    totalDaysTracked: focusDays.length,
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak), // Ensure longest >= current
    weeklyTrend,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create an empty velocity object (all zeros)
 * @returns Empty FocusVelocity object
 */
export function createEmptyVelocity(): FocusVelocity {
  return {
    averagePointsPerDay: 0,
    averageCompletionRate: 0,
    totalDaysTracked: 0,
    currentStreak: 0,
    longestStreak: 0,
    weeklyTrend: [0, 0, 0, 0, 0, 0, 0],
  };
}

/**
 * Check if velocity data indicates good progress
 * @param velocity - FocusVelocity to check
 * @returns True if completion rate is above 70% and has a streak
 */
export function isHealthyVelocity(velocity: FocusVelocity): boolean {
  return velocity.averageCompletionRate >= 70 && velocity.currentStreak >= 1;
}

/**
 * Get a human-readable trend description
 * @param trend - Trend direction
 * @param weeklyTrend - Weekly trend values
 * @returns Description string
 */
export function getTrendDescription(
  trend: VelocityTrendDirection,
  weeklyTrend: number[]
): string {
  const recentAvg =
    weeklyTrend.slice(-3).reduce((sum, v) => sum + v, 0) / 3 || 0;

  switch (trend) {
    case 'up':
      return `Improving! Averaging ${Math.round(recentAvg)} pts/day recently`;
    case 'down':
      return `Slowing down. Recent average: ${Math.round(recentAvg)} pts/day`;
    case 'stable':
      return `Steady pace at ${Math.round(recentAvg)} pts/day`;
  }
}
