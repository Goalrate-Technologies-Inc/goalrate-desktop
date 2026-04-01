/**
 * Velocity Calculation Functions Tests
 */

import { describe, it, expect } from 'vitest';
import type { FocusDay } from '@goalrate-app/shared';
import {
  calculateVelocity,
  calculateAveragePointsPerDay,
  calculateAverageCompletionRate,
  calculateCurrentStreak,
  calculateLongestStreak,
  calculateWeeklyTrend,
  calculateMonthlyTrend,
  determineTrendDirection,
  createEmptyVelocity,
  isHealthyVelocity,
  getTrendDescription,
} from '../../src/focus/velocity';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createFocusDay(overrides: Partial<FocusDay> & { date: string }): FocusDay {
  return {
    id: `focus_${overrides.date}`,
    date: overrides.date,
    availableHours: overrides.availableHours ?? 8,
    pointCapacity: overrides.pointCapacity ?? 16,
    items: overrides.items ?? [],
    plannedPoints: overrides.plannedPoints ?? 10,
    completedPoints: overrides.completedPoints ?? 5,
    completedItems: overrides.completedItems ?? 2,
    ...overrides,
  };
}

function createConsecutiveDays(
  startDate: Date,
  count: number,
  getOverrides: (index: number, dateStr: string) => Partial<FocusDay>
): FocusDay[] {
  const days: FocusDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0]!;
    days.push(createFocusDay({ date: dateStr, ...getOverrides(i, dateStr) }));
  }
  return days;
}

// ============================================================================
// AVERAGE CALCULATIONS TESTS
// ============================================================================

describe('calculateAveragePointsPerDay', () => {
  it('should return 0 for empty array', () => {
    expect(calculateAveragePointsPerDay([])).toBe(0);
  });

  it('should calculate average correctly for single day', () => {
    const days = [createFocusDay({ date: '2026-01-15', completedPoints: 8 })];
    expect(calculateAveragePointsPerDay(days)).toBe(8);
  });

  it('should calculate average correctly for multiple days', () => {
    const days = [
      createFocusDay({ date: '2026-01-15', completedPoints: 6 }),
      createFocusDay({ date: '2026-01-14', completedPoints: 10 }),
      createFocusDay({ date: '2026-01-13', completedPoints: 8 }),
    ];
    expect(calculateAveragePointsPerDay(days)).toBe(8); // (6 + 10 + 8) / 3
  });

  it('should handle days with zero points', () => {
    const days = [
      createFocusDay({ date: '2026-01-15', completedPoints: 10 }),
      createFocusDay({ date: '2026-01-14', completedPoints: 0 }),
    ];
    expect(calculateAveragePointsPerDay(days)).toBe(5);
  });
});

describe('calculateAverageCompletionRate', () => {
  it('should return 0 for empty array', () => {
    expect(calculateAverageCompletionRate([])).toBe(0);
  });

  it('should return 0 when no planned points', () => {
    const days = [createFocusDay({ date: '2026-01-15', plannedPoints: 0, completedPoints: 0 })];
    expect(calculateAverageCompletionRate(days)).toBe(0);
  });

  it('should calculate 100% when all completed', () => {
    const days = [createFocusDay({ date: '2026-01-15', plannedPoints: 10, completedPoints: 10 })];
    expect(calculateAverageCompletionRate(days)).toBe(100);
  });

  it('should cap at 100% when over-completed', () => {
    const days = [createFocusDay({ date: '2026-01-15', plannedPoints: 10, completedPoints: 15 })];
    expect(calculateAverageCompletionRate(days)).toBe(100);
  });

  it('should calculate average correctly for multiple days', () => {
    const days = [
      createFocusDay({ date: '2026-01-15', plannedPoints: 10, completedPoints: 10 }), // 100%
      createFocusDay({ date: '2026-01-14', plannedPoints: 10, completedPoints: 5 }), // 50%
    ];
    expect(calculateAverageCompletionRate(days)).toBe(75); // (100 + 50) / 2
  });

  it('should exclude days with zero planned points from calculation', () => {
    const days = [
      createFocusDay({ date: '2026-01-15', plannedPoints: 10, completedPoints: 8 }), // 80%
      createFocusDay({ date: '2026-01-14', plannedPoints: 0, completedPoints: 0 }), // Excluded
    ];
    expect(calculateAverageCompletionRate(days)).toBe(80);
  });
});

// ============================================================================
// STREAK CALCULATIONS TESTS
// ============================================================================

describe('calculateCurrentStreak', () => {
  const today = new Date('2026-01-18');

  it('should return 0 for empty array', () => {
    expect(calculateCurrentStreak([], today)).toBe(0);
  });

  it('should return 1 for activity today only', () => {
    const days = [createFocusDay({ date: '2026-01-18', completedItems: 3 })];
    expect(calculateCurrentStreak(days, today)).toBe(1);
  });

  it('should return 1 for activity yesterday only', () => {
    const days = [createFocusDay({ date: '2026-01-17', completedItems: 3 })];
    expect(calculateCurrentStreak(days, today)).toBe(1);
  });

  it('should return 0 if no activity for more than 1 day', () => {
    const days = [createFocusDay({ date: '2026-01-15', completedItems: 3 })];
    expect(calculateCurrentStreak(days, today)).toBe(0);
  });

  it('should count consecutive days correctly', () => {
    const days = [
      createFocusDay({ date: '2026-01-18', completedItems: 2 }),
      createFocusDay({ date: '2026-01-17', completedItems: 3 }),
      createFocusDay({ date: '2026-01-16', completedItems: 1 }),
    ];
    expect(calculateCurrentStreak(days, today)).toBe(3);
  });

  it('should break streak on gap', () => {
    const days = [
      createFocusDay({ date: '2026-01-18', completedItems: 2 }),
      createFocusDay({ date: '2026-01-17', completedItems: 3 }),
      // Gap: 2026-01-16 missing
      createFocusDay({ date: '2026-01-15', completedItems: 1 }),
    ];
    expect(calculateCurrentStreak(days, today)).toBe(2);
  });

  it('should not count days with zero completed items', () => {
    const days = [
      createFocusDay({ date: '2026-01-18', completedItems: 2 }),
      createFocusDay({ date: '2026-01-17', completedItems: 0 }), // No activity
      createFocusDay({ date: '2026-01-16', completedItems: 3 }),
    ];
    expect(calculateCurrentStreak(days, today)).toBe(1);
  });

  it('should handle unsorted input', () => {
    const days = [
      createFocusDay({ date: '2026-01-16', completedItems: 1 }),
      createFocusDay({ date: '2026-01-18', completedItems: 2 }),
      createFocusDay({ date: '2026-01-17', completedItems: 3 }),
    ];
    expect(calculateCurrentStreak(days, today)).toBe(3);
  });
});

describe('calculateLongestStreak', () => {
  it('should return 0 for empty array', () => {
    expect(calculateLongestStreak([])).toBe(0);
  });

  it('should return 1 for single active day', () => {
    const days = [createFocusDay({ date: '2026-01-15', completedItems: 3 })];
    expect(calculateLongestStreak(days)).toBe(1);
  });

  it('should return 0 if no days have activity', () => {
    const days = [
      createFocusDay({ date: '2026-01-15', completedItems: 0 }),
      createFocusDay({ date: '2026-01-14', completedItems: 0 }),
    ];
    expect(calculateLongestStreak(days)).toBe(0);
  });

  it('should find longest streak across gaps', () => {
    const days = [
      // First streak: 3 days
      createFocusDay({ date: '2026-01-10', completedItems: 1 }),
      createFocusDay({ date: '2026-01-11', completedItems: 2 }),
      createFocusDay({ date: '2026-01-12', completedItems: 1 }),
      // Gap
      // Second streak: 2 days
      createFocusDay({ date: '2026-01-15', completedItems: 3 }),
      createFocusDay({ date: '2026-01-16', completedItems: 2 }),
    ];
    expect(calculateLongestStreak(days)).toBe(3);
  });

  it('should handle single longest streak at the end', () => {
    const days = [
      createFocusDay({ date: '2026-01-10', completedItems: 1 }),
      // Gap
      createFocusDay({ date: '2026-01-15', completedItems: 1 }),
      createFocusDay({ date: '2026-01-16', completedItems: 1 }),
      createFocusDay({ date: '2026-01-17', completedItems: 1 }),
      createFocusDay({ date: '2026-01-18', completedItems: 1 }),
    ];
    expect(calculateLongestStreak(days)).toBe(4);
  });
});

// ============================================================================
// TREND CALCULATIONS TESTS
// ============================================================================

describe('calculateWeeklyTrend', () => {
  const today = new Date('2026-01-18');

  it('should return array of 7 zeros for empty input', () => {
    expect(calculateWeeklyTrend([], today)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('should fill in zeros for missing days', () => {
    const days = [createFocusDay({ date: '2026-01-18', completedPoints: 5 })];
    const trend = calculateWeeklyTrend(days, today);
    expect(trend).toHaveLength(7);
    expect(trend[6]).toBe(5); // Today (last position)
    expect(trend.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]); // Previous 6 days
  });

  it('should order from oldest to newest', () => {
    const days = [
      createFocusDay({ date: '2026-01-12', completedPoints: 1 }),
      createFocusDay({ date: '2026-01-18', completedPoints: 7 }),
    ];
    const trend = calculateWeeklyTrend(days, today);
    expect(trend[0]).toBe(1); // Jan 12
    expect(trend[6]).toBe(7); // Jan 18
  });

  it('should include all 7 days of data', () => {
    const days = createConsecutiveDays(today, 7, (i) => ({ completedPoints: 7 - i }));
    const trend = calculateWeeklyTrend(days, today);
    expect(trend).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('calculateMonthlyTrend', () => {
  const today = new Date('2026-01-18');

  it('should return array of 30 zeros for empty input', () => {
    expect(calculateMonthlyTrend([], today)).toHaveLength(30);
    expect(calculateMonthlyTrend([], today).every(v => v === 0)).toBe(true);
  });

  it('should correctly position recent data at the end', () => {
    const days = [
      createFocusDay({ date: '2026-01-18', completedPoints: 10 }),
      createFocusDay({ date: '2026-01-17', completedPoints: 8 }),
    ];
    const trend = calculateMonthlyTrend(days, today);
    expect(trend[29]).toBe(10); // Today
    expect(trend[28]).toBe(8); // Yesterday
  });
});

describe('determineTrendDirection', () => {
  it('should return stable for empty array', () => {
    expect(determineTrendDirection([])).toBe('stable');
  });

  it('should return stable for single value', () => {
    expect(determineTrendDirection([5])).toBe('stable');
  });

  it('should return up for increasing values', () => {
    expect(determineTrendDirection([1, 2, 3, 4, 5, 6, 7])).toBe('up');
  });

  it('should return down for decreasing values', () => {
    expect(determineTrendDirection([7, 6, 5, 4, 3, 2, 1])).toBe('down');
  });

  it('should return stable for small changes', () => {
    // 5% change is below default 10% threshold
    expect(determineTrendDirection([100, 100, 100, 103, 103, 103])).toBe('stable');
  });

  it('should respect custom threshold', () => {
    // 5% change should trigger with 5% threshold
    expect(determineTrendDirection([100, 100, 105, 105], 5)).toBe('up');
  });

  it('should handle all zeros', () => {
    expect(determineTrendDirection([0, 0, 0, 0])).toBe('stable');
  });

  it('should detect up trend from zero start', () => {
    expect(determineTrendDirection([0, 0, 5, 5])).toBe('up');
  });
});

// ============================================================================
// MAIN VELOCITY FUNCTION TESTS
// ============================================================================

describe('calculateVelocity', () => {
  const today = new Date('2026-01-18');

  it('should return zeros for empty input', () => {
    const velocity = calculateVelocity([], { today });
    expect(velocity.averagePointsPerDay).toBe(0);
    expect(velocity.averageCompletionRate).toBe(0);
    expect(velocity.totalDaysTracked).toBe(0);
    expect(velocity.currentStreak).toBe(0);
    expect(velocity.longestStreak).toBe(0);
    expect(velocity.weeklyTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('should calculate all metrics correctly', () => {
    const days = createConsecutiveDays(today, 5, (i) => ({
      completedPoints: 10 - i,
      plannedPoints: 10,
      completedItems: 2,
    }));

    const velocity = calculateVelocity(days, { today });

    expect(velocity.totalDaysTracked).toBe(5);
    expect(velocity.averagePointsPerDay).toBe(8); // (10+9+8+7+6) / 5
    expect(velocity.averageCompletionRate).toBe(80); // average of 100,90,80,70,60
    expect(velocity.currentStreak).toBe(5);
    expect(velocity.longestStreak).toBe(5);
    expect(velocity.weeklyTrend).toHaveLength(7);
  });

  it('should round average points to 1 decimal place', () => {
    const days = [
      createFocusDay({ date: '2026-01-18', completedPoints: 7, completedItems: 1 }),
      createFocusDay({ date: '2026-01-17', completedPoints: 8, completedItems: 1 }),
      createFocusDay({ date: '2026-01-16', completedPoints: 9, completedItems: 1 }),
    ];
    const velocity = calculateVelocity(days, { today });
    expect(velocity.averagePointsPerDay).toBe(8); // 8.0
  });

  it('should ensure longestStreak >= currentStreak', () => {
    // Current streak is 3, but there's an older streak of 2
    const days = [
      createFocusDay({ date: '2026-01-18', completedItems: 1 }),
      createFocusDay({ date: '2026-01-17', completedItems: 1 }),
      createFocusDay({ date: '2026-01-16', completedItems: 1 }),
      // Gap
      createFocusDay({ date: '2026-01-10', completedItems: 1 }),
      createFocusDay({ date: '2026-01-09', completedItems: 1 }),
    ];
    const velocity = calculateVelocity(days, { today });
    expect(velocity.currentStreak).toBe(3);
    expect(velocity.longestStreak).toBeGreaterThanOrEqual(velocity.currentStreak);
  });
});

// ============================================================================
// UTILITY FUNCTIONS TESTS
// ============================================================================

describe('createEmptyVelocity', () => {
  it('should create velocity with all zeros', () => {
    const empty = createEmptyVelocity();
    expect(empty.averagePointsPerDay).toBe(0);
    expect(empty.averageCompletionRate).toBe(0);
    expect(empty.totalDaysTracked).toBe(0);
    expect(empty.currentStreak).toBe(0);
    expect(empty.longestStreak).toBe(0);
    expect(empty.weeklyTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('isHealthyVelocity', () => {
  it('should return true for good metrics', () => {
    const velocity = {
      averagePointsPerDay: 8,
      averageCompletionRate: 80,
      totalDaysTracked: 10,
      currentStreak: 3,
      longestStreak: 5,
      weeklyTrend: [5, 6, 7, 8, 8, 9, 8],
    };
    expect(isHealthyVelocity(velocity)).toBe(true);
  });

  it('should return false for low completion rate', () => {
    const velocity = {
      averagePointsPerDay: 8,
      averageCompletionRate: 50,
      totalDaysTracked: 10,
      currentStreak: 3,
      longestStreak: 5,
      weeklyTrend: [5, 6, 7, 8, 8, 9, 8],
    };
    expect(isHealthyVelocity(velocity)).toBe(false);
  });

  it('should return false for zero streak', () => {
    const velocity = {
      averagePointsPerDay: 8,
      averageCompletionRate: 80,
      totalDaysTracked: 10,
      currentStreak: 0,
      longestStreak: 5,
      weeklyTrend: [5, 6, 7, 8, 8, 9, 8],
    };
    expect(isHealthyVelocity(velocity)).toBe(false);
  });

  it('should return true at exactly 70% rate', () => {
    const velocity = {
      averagePointsPerDay: 5,
      averageCompletionRate: 70,
      totalDaysTracked: 5,
      currentStreak: 1,
      longestStreak: 1,
      weeklyTrend: [0, 0, 0, 0, 5, 5, 5],
    };
    expect(isHealthyVelocity(velocity)).toBe(true);
  });
});

describe('getTrendDescription', () => {
  it('should describe up trend', () => {
    const desc = getTrendDescription('up', [2, 3, 4, 5, 6, 7, 8]);
    expect(desc).toContain('Improving');
    expect(desc).toContain('7'); // Recent average of last 3 days
  });

  it('should describe down trend', () => {
    const desc = getTrendDescription('down', [8, 7, 6, 5, 4, 3, 2]);
    expect(desc).toContain('Slowing');
    expect(desc).toContain('3'); // Recent average
  });

  it('should describe stable trend', () => {
    const desc = getTrendDescription('stable', [5, 5, 5, 5, 5, 5, 5]);
    expect(desc).toContain('Steady');
    expect(desc).toContain('5');
  });

  it('should handle zeros in trend', () => {
    const desc = getTrendDescription('stable', [0, 0, 0, 0, 0, 0, 0]);
    expect(desc).toContain('0');
  });
});
