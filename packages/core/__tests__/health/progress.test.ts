import { describe, it, expect } from 'vitest';
import {
  calculateExpectedProgress,
  getDaysFromDeadline,
  isDeadlinePast,
  calculateProgressVariance,
  calculateProgressFromItems,
  calculateProgressFromPoints,
} from '../../src/health/progress';

describe('calculateExpectedProgress', () => {
  const today = new Date('2024-01-15');

  it('should return 0 for no deadline', () => {
    expect(calculateExpectedProgress(null, null, today)).toBe(0);
    expect(calculateExpectedProgress(undefined, undefined, today)).toBe(0);
  });

  it('should return 100 if deadline is in the past', () => {
    expect(calculateExpectedProgress('2024-01-14', '2024-01-01', today)).toBe(100);
  });

  it('should return 0 if start date is in the future', () => {
    expect(calculateExpectedProgress('2024-02-15', '2024-01-20', today)).toBe(0);
  });

  it('should calculate progress based on elapsed time', () => {
    // Jan 1 to Feb 1 is 31 days, 15 days elapsed = ~48%
    const deadline = '2024-02-01';
    const startDate = '2024-01-01';
    const progress = calculateExpectedProgress(deadline, startDate, new Date('2024-01-16'));
    expect(progress).toBeGreaterThan(40);
    expect(progress).toBeLessThan(55);
  });

  it('should default start date to 30 days before deadline', () => {
    // Today is 15 days before deadline (Jan 30)
    // Default start is Dec 31, so 16 days elapsed out of 30
    const deadline = '2024-01-30';
    const progress = calculateExpectedProgress(deadline, null, today);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(100);
  });
});

describe('getDaysFromDeadline', () => {
  const today = new Date('2024-01-15');

  it('should return 0 for no deadline', () => {
    expect(getDaysFromDeadline(null, today)).toBe(0);
  });

  it('should return positive for future deadline', () => {
    expect(getDaysFromDeadline('2024-01-20', today)).toBe(5);
  });

  it('should return negative for past deadline', () => {
    expect(getDaysFromDeadline('2024-01-10', today)).toBe(-5);
  });

  it('should return 0 for today', () => {
    expect(getDaysFromDeadline('2024-01-15', today)).toBe(0);
  });
});

describe('isDeadlinePast', () => {
  const today = new Date('2024-01-15');

  it('should return false for no deadline', () => {
    expect(isDeadlinePast(null, today)).toBe(false);
  });

  it('should return false for future deadline', () => {
    expect(isDeadlinePast('2024-01-20', today)).toBe(false);
  });

  it('should return true for past deadline', () => {
    expect(isDeadlinePast('2024-01-10', today)).toBe(true);
  });

  it('should return false for today (deadline not yet passed)', () => {
    expect(isDeadlinePast('2024-01-15', today)).toBe(false);
  });
});

describe('calculateProgressVariance', () => {
  it('should return positive when ahead', () => {
    expect(calculateProgressVariance(75, 50)).toBe(25);
  });

  it('should return negative when behind', () => {
    expect(calculateProgressVariance(25, 50)).toBe(-25);
  });

  it('should return 0 when on track', () => {
    expect(calculateProgressVariance(50, 50)).toBe(0);
  });
});

describe('calculateProgressFromItems', () => {
  it('should return 0 for no items', () => {
    expect(calculateProgressFromItems(0, 0)).toBe(0);
  });

  it('should return 0 for no completed items', () => {
    expect(calculateProgressFromItems(0, 10)).toBe(0);
  });

  it('should return 100 for all completed', () => {
    expect(calculateProgressFromItems(10, 10)).toBe(100);
  });

  it('should calculate percentage correctly', () => {
    expect(calculateProgressFromItems(3, 10)).toBe(30);
    expect(calculateProgressFromItems(5, 8)).toBe(63); // 62.5 rounded
  });
});

describe('calculateProgressFromPoints', () => {
  it('should return 0 for no points', () => {
    expect(calculateProgressFromPoints(0, 0)).toBe(0);
  });

  it('should return 0 for no completed points', () => {
    expect(calculateProgressFromPoints(0, 100)).toBe(0);
  });

  it('should return 100 for all completed', () => {
    expect(calculateProgressFromPoints(100, 100)).toBe(100);
  });

  it('should calculate percentage correctly', () => {
    expect(calculateProgressFromPoints(30, 100)).toBe(30);
    expect(calculateProgressFromPoints(21, 50)).toBe(42);
  });
});
