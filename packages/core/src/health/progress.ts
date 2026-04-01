/**
 * Progress Calculation
 * Functions for calculating expected and actual progress
 */

import { parseDate, daysBetween } from '../utils/dates';

/**
 * Calculate expected progress based on timeline (start date to deadline)
 *
 * If no start date is provided, defaults to 30 days before deadline.
 * Returns 0 if no deadline is set.
 *
 * @param deadline - Deadline date string
 * @param startDate - Start date string (optional)
 * @param today - Reference date for calculations
 * @returns Expected progress percentage (0-100)
 */
export function calculateExpectedProgress(
  deadline: string | null | undefined,
  startDate: string | null | undefined,
  today: Date = new Date()
): number {
  if (!deadline) {
    return 0;
  }

  const deadlineDate = parseDate(deadline);
  if (!deadlineDate) {
    return 0;
  }

  // Default start date: 30 days before deadline
  const start = startDate
    ? parseDate(startDate)
    : new Date(deadlineDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (!start) {
    return 0;
  }

  const totalDuration = daysBetween(start, deadlineDate);
  const elapsed = daysBetween(start, today);

  // Edge cases
  if (totalDuration <= 0) {
    return 100; // Deadline is at or before start
  }
  if (elapsed <= 0) {
    return 0; // Haven't started yet
  }

  const progress = (elapsed / totalDuration) * 100;
  return Math.min(100, Math.max(0, progress));
}

/**
 * Get days from/until a deadline
 *
 * @param deadline - Deadline date string
 * @param today - Reference date
 * @returns Days from deadline (negative if past, positive if future)
 */
export function getDaysFromDeadline(
  deadline: string | null | undefined,
  today: Date = new Date()
): number {
  if (!deadline) {
    return 0;
  }

  const deadlineDate = parseDate(deadline);
  if (!deadlineDate) {
    return 0;
  }

  return daysBetween(today, deadlineDate);
}

/**
 * Check if a deadline has passed
 *
 * @param deadline - Deadline date string
 * @param today - Reference date
 * @returns True if deadline is in the past
 */
export function isDeadlinePast(
  deadline: string | null | undefined,
  today: Date = new Date()
): boolean {
  if (!deadline) {
    return false;
  }

  const deadlineDate = parseDate(deadline);
  if (!deadlineDate) {
    return false;
  }

  return today > deadlineDate;
}

/**
 * Calculate variance between actual and expected progress
 *
 * Positive variance means ahead of schedule
 * Negative variance means behind schedule
 *
 * @param actualProgress - Actual progress percentage (0-100)
 * @param expectedProgress - Expected progress percentage (0-100)
 * @returns Variance (actual - expected)
 */
export function calculateProgressVariance(
  actualProgress: number,
  expectedProgress: number
): number {
  return actualProgress - expectedProgress;
}

/**
 * Calculate progress from completed vs total items
 *
 * @param completed - Number of completed items
 * @param total - Total number of items
 * @returns Progress percentage (0-100)
 */
export function calculateProgressFromItems(
  completed: number,
  total: number
): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((completed / total) * 100);
}

/**
 * Calculate progress from completed vs total points
 *
 * @param completedPoints - Points of completed items
 * @param totalPoints - Total points
 * @returns Progress percentage (0-100)
 */
export function calculateProgressFromPoints(
  completedPoints: number,
  totalPoints: number
): number {
  if (totalPoints <= 0) {
    return 0;
  }
  return Math.round((completedPoints / totalPoints) * 100);
}
