import { describe, it, expect } from 'vitest';
import {
  normalizeToStartOfDay,
  daysBetween,
  parseDate,
  calculateDaysUntilDue,
  isOverdue,
  isDueToday,
  isDueWithin,
  toISODateString,
  formatDaysUntilDue,
} from '../../src/utils/dates';

describe('normalizeToStartOfDay', () => {
  it('should set time to midnight', () => {
    const date = new Date('2024-01-15T14:30:00');
    const normalized = normalizeToStartOfDay(date);
    expect(normalized.getHours()).toBe(0);
    expect(normalized.getMinutes()).toBe(0);
    expect(normalized.getSeconds()).toBe(0);
    expect(normalized.getMilliseconds()).toBe(0);
  });

  it('should preserve the date', () => {
    const date = new Date('2024-01-15T14:30:00');
    const normalized = normalizeToStartOfDay(date);
    expect(normalized.getFullYear()).toBe(2024);
    expect(normalized.getMonth()).toBe(0); // January
    expect(normalized.getDate()).toBe(15);
  });

  it('should not modify the original date', () => {
    const date = new Date('2024-01-15T14:30:00');
    normalizeToStartOfDay(date);
    expect(date.getHours()).toBe(14);
  });
});

describe('daysBetween', () => {
  it('should return 0 for same day', () => {
    const date1 = new Date('2024-01-15T10:00:00');
    const date2 = new Date('2024-01-15T20:00:00');
    expect(daysBetween(date1, date2)).toBe(0);
  });

  it('should return positive for future date', () => {
    const from = new Date('2024-01-15');
    const to = new Date('2024-01-20');
    expect(daysBetween(from, to)).toBe(5);
  });

  it('should return negative for past date', () => {
    const from = new Date('2024-01-20');
    const to = new Date('2024-01-15');
    expect(daysBetween(from, to)).toBe(-5);
  });
});

describe('parseDate', () => {
  it('should return null for null input', () => {
    expect(parseDate(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(parseDate(undefined)).toBeNull();
  });

  it('should return null for invalid date string', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });

  it('should parse valid ISO date string', () => {
    const result = parseDate('2024-01-15');
    expect(result).not.toBeNull();
    expect(result?.getFullYear()).toBe(2024);
  });
});

describe('calculateDaysUntilDue', () => {
  const today = new Date('2024-01-15');

  it('should return null for no due date', () => {
    expect(calculateDaysUntilDue(null, today)).toBeNull();
    expect(calculateDaysUntilDue(undefined, today)).toBeNull();
  });

  it('should return 0 for due today', () => {
    expect(calculateDaysUntilDue('2024-01-15', today)).toBe(0);
  });

  it('should return positive for future due date', () => {
    expect(calculateDaysUntilDue('2024-01-20', today)).toBe(5);
  });

  it('should return negative for past due date', () => {
    expect(calculateDaysUntilDue('2024-01-10', today)).toBe(-5);
  });
});

describe('isOverdue', () => {
  const today = new Date('2024-01-15');

  it('should return false for no deadline', () => {
    expect(isOverdue(null, today)).toBe(false);
  });

  it('should return false for future deadline', () => {
    expect(isOverdue('2024-01-20', today)).toBe(false);
  });

  it('should return false for today deadline', () => {
    expect(isOverdue('2024-01-15', today)).toBe(false);
  });

  it('should return true for past deadline', () => {
    expect(isOverdue('2024-01-10', today)).toBe(true);
  });
});

describe('isDueToday', () => {
  const today = new Date('2024-01-15');

  it('should return false for no due date', () => {
    expect(isDueToday(null, today)).toBe(false);
  });

  it('should return true for today', () => {
    expect(isDueToday('2024-01-15', today)).toBe(true);
  });

  it('should return false for other days', () => {
    expect(isDueToday('2024-01-16', today)).toBe(false);
    expect(isDueToday('2024-01-14', today)).toBe(false);
  });
});

describe('isDueWithin', () => {
  const today = new Date('2024-01-15');

  it('should return false for no due date', () => {
    expect(isDueWithin(null, 7, today)).toBe(false);
  });

  it('should return true for due date within threshold', () => {
    expect(isDueWithin('2024-01-15', 7, today)).toBe(true); // Today
    expect(isDueWithin('2024-01-20', 7, today)).toBe(true); // 5 days
    expect(isDueWithin('2024-01-22', 7, today)).toBe(true); // 7 days
  });

  it('should return false for due date outside threshold', () => {
    expect(isDueWithin('2024-01-23', 7, today)).toBe(false); // 8 days
    expect(isDueWithin('2024-01-10', 7, today)).toBe(false); // overdue
  });
});

describe('toISODateString', () => {
  it('should return YYYY-MM-DD format', () => {
    const date = new Date('2024-01-15T14:30:00Z');
    const result = toISODateString(date);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('formatDaysUntilDue', () => {
  it('should handle null', () => {
    expect(formatDaysUntilDue(null)).toBe('No due date');
  });

  it('should handle overdue', () => {
    expect(formatDaysUntilDue(-1)).toBe('1 day overdue');
    expect(formatDaysUntilDue(-5)).toBe('5 days overdue');
  });

  it('should handle due today', () => {
    expect(formatDaysUntilDue(0)).toBe('Due today');
  });

  it('should handle due tomorrow', () => {
    expect(formatDaysUntilDue(1)).toBe('Due tomorrow');
  });

  it('should handle due in days', () => {
    expect(formatDaysUntilDue(5)).toBe('Due in 5 days');
  });

  it('should handle due in weeks', () => {
    expect(formatDaysUntilDue(14)).toBe('Due in 2 weeks');
  });
});
