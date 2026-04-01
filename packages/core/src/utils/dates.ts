/**
 * Date Utilities
 * Pure date calculation functions for use across all modules
 */

/**
 * Normalize a date to the start of the day (midnight, local time)
 * @param date - Date to normalize
 * @returns New date set to start of day
 */
export function normalizeToStartOfDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

/**
 * Calculate the number of days between two dates
 * Returns positive if `to` is after `from`, negative if before
 * @param from - Start date
 * @param to - End date
 * @returns Number of days between dates
 */
export function daysBetween(from: Date, to: Date): number {
  const fromNormalized = normalizeToStartOfDay(from);
  const toNormalized = normalizeToStartOfDay(to);
  const diffMs = toNormalized.getTime() - fromNormalized.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Parse a date string safely
 * @param dateStr - ISO date string or null/undefined
 * @returns Date object or null if invalid
 */
export function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) {
    return null;
  }
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

/**
 * Calculate days until a due date from today
 * @param dueDate - Due date string or null
 * @param today - Reference date (defaults to now)
 * @returns Days until due (negative if overdue), or null if no due date
 */
export function calculateDaysUntilDue(
  dueDate: string | null | undefined,
  today: Date = new Date()
): number | null {
  const due = parseDate(dueDate);
  if (!due) {
    return null;
  }
  return daysBetween(today, due);
}

/**
 * Check if a date is overdue (past the given reference date)
 * @param deadline - Deadline date string
 * @param today - Reference date (defaults to now)
 * @returns True if deadline has passed
 */
export function isOverdue(
  deadline: string | null | undefined,
  today: Date = new Date()
): boolean {
  const daysUntil = calculateDaysUntilDue(deadline, today);
  if (daysUntil === null) {
    return false;
  }
  return daysUntil < 0;
}

/**
 * Check if a date is due today
 * @param dueDate - Due date string
 * @param today - Reference date (defaults to now)
 * @returns True if due today
 */
export function isDueToday(
  dueDate: string | null | undefined,
  today: Date = new Date()
): boolean {
  const daysUntil = calculateDaysUntilDue(dueDate, today);
  return daysUntil === 0;
}

/**
 * Check if a date is due within a given number of days
 * @param dueDate - Due date string
 * @param days - Number of days threshold
 * @param today - Reference date (defaults to now)
 * @returns True if due within the threshold (inclusive)
 */
export function isDueWithin(
  dueDate: string | null | undefined,
  days: number,
  today: Date = new Date()
): boolean {
  const daysUntil = calculateDaysUntilDue(dueDate, today);
  if (daysUntil === null) {
    return false;
  }
  return daysUntil >= 0 && daysUntil <= days;
}

/**
 * Get today's date as an ISO date string (YYYY-MM-DD)
 * @param today - Reference date (defaults to now)
 * @returns ISO date string
 */
export function toISODateString(today: Date = new Date()): string {
  return today.toISOString().split('T')[0] ?? '';
}

/**
 * Format days until due as human-readable text
 * @param daysUntilDue - Days until due (negative if overdue)
 * @returns Human-readable string
 */
export function formatDaysUntilDue(daysUntilDue: number | null): string {
  if (daysUntilDue === null) {
    return 'No due date';
  }
  if (daysUntilDue < 0) {
    const daysOverdue = Math.abs(daysUntilDue);
    return daysOverdue === 1 ? '1 day overdue' : `${daysOverdue} days overdue`;
  }
  if (daysUntilDue === 0) {
    return 'Due today';
  }
  if (daysUntilDue === 1) {
    return 'Due tomorrow';
  }
  if (daysUntilDue <= 7) {
    return `Due in ${daysUntilDue} days`;
  }
  const weeks = Math.ceil(daysUntilDue / 7);
  return weeks === 1 ? 'Due in 1 week' : `Due in ${weeks} weeks`;
}
