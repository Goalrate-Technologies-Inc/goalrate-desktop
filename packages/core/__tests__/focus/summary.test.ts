import { describe, it, expect } from 'vitest';
import {
  calculateCompletionPercentage,
  countDeferredItems,
  getCompletedItems,
  getTopCompletedItems,
  calculateComparisonToAverage,
  getComparisonInsight,
  generateEncouragement,
  generateSummaryInsights,
  generateEndOfDaySummary,
  updateFocusDayReflection,
  isSummaryReady,
  suggestMood,
} from '../../src/focus/summary';
import type { FocusDay, FocusItem, FocusVelocity } from '@goalrate-app/shared';

// Helper to create a focus item
function createFocusItem(overrides: Partial<FocusItem> = {}): FocusItem {
  return {
    source: 'task-1',
    type: 'goal_task',
    title: 'Test Task',
    points: 3,
    score: 75,
    reason: 'High priority',
    status: 'pending',
    ...overrides,
  };
}

// Helper to create a focus day
function createFocusDay(overrides: Partial<FocusDay> = {}): FocusDay {
  return {
    id: 'focus_2024-01-15',
    date: '2024-01-15',
    availableHours: 6,
    pointCapacity: 12,
    items: [],
    plannedPoints: 10,
    completedPoints: 0,
    completedItems: 0,
    ...overrides,
  };
}

describe('calculateCompletionPercentage', () => {
  it('should return 0 for empty focus day', () => {
    const focusDay = createFocusDay({ plannedPoints: 0, completedPoints: 0 });
    expect(calculateCompletionPercentage(focusDay)).toBe(0);
  });

  it('should return 100 when all points completed', () => {
    const focusDay = createFocusDay({ plannedPoints: 10, completedPoints: 10 });
    expect(calculateCompletionPercentage(focusDay)).toBe(100);
  });

  it('should return correct percentage for partial completion', () => {
    const focusDay = createFocusDay({ plannedPoints: 10, completedPoints: 7 });
    expect(calculateCompletionPercentage(focusDay)).toBe(70);
  });

  it('should round to nearest integer', () => {
    const focusDay = createFocusDay({ plannedPoints: 9, completedPoints: 7 });
    expect(calculateCompletionPercentage(focusDay)).toBe(78);
  });
});

describe('countDeferredItems', () => {
  it('should return 0 when no items deferred', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'pending' }),
        createFocusItem({ status: 'done' }),
      ],
    });
    expect(countDeferredItems(focusDay)).toBe(0);
  });

  it('should count deferred items', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'deferred', source: 't1' }),
        createFocusItem({ status: 'deferred', source: 't2' }),
        createFocusItem({ status: 'done', source: 't3' }),
      ],
    });
    expect(countDeferredItems(focusDay)).toBe(2);
  });
});

describe('getCompletedItems', () => {
  it('should return empty array when no items completed', () => {
    const focusDay = createFocusDay({
      items: [createFocusItem({ status: 'pending' })],
    });
    expect(getCompletedItems(focusDay)).toEqual([]);
  });

  it('should return only completed items', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'pending', source: 't1' }),
        createFocusItem({ status: 'done', source: 't2' }),
        createFocusItem({ status: 'done', source: 't3' }),
      ],
    });
    const completed = getCompletedItems(focusDay);
    expect(completed).toHaveLength(2);
    expect(completed.map((i) => i.source)).toContain('t2');
    expect(completed.map((i) => i.source)).toContain('t3');
  });

  it('should sort by completion time', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'done', source: 't1', completedAt: '2024-01-15T14:00:00Z' }),
        createFocusItem({ status: 'done', source: 't2', completedAt: '2024-01-15T10:00:00Z' }),
        createFocusItem({ status: 'done', source: 't3', completedAt: '2024-01-15T12:00:00Z' }),
      ],
    });
    const completed = getCompletedItems(focusDay);
    expect(completed[0].source).toBe('t2');
    expect(completed[1].source).toBe('t3');
    expect(completed[2].source).toBe('t1');
  });
});

describe('getTopCompletedItems', () => {
  it('should return top N items by points', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'done', source: 't1', points: 3 }),
        createFocusItem({ status: 'done', source: 't2', points: 5 }),
        createFocusItem({ status: 'done', source: 't3', points: 1 }),
      ],
    });
    const top = getTopCompletedItems(focusDay, 2);
    expect(top).toHaveLength(2);
    expect(top[0].source).toBe('t2'); // 5 points
    expect(top[1].source).toBe('t1'); // 3 points
  });

  it('should default to 5 items', () => {
    const focusDay = createFocusDay({
      items: Array(10)
        .fill(null)
        .map((_, i) =>
          createFocusItem({ status: 'done', source: `t${i}`, points: i })
        ),
    });
    const top = getTopCompletedItems(focusDay);
    expect(top).toHaveLength(5);
  });
});

describe('calculateComparisonToAverage', () => {
  it('should return 100 when average is 0 and completed > 0', () => {
    expect(calculateComparisonToAverage(5, 0)).toBe(100);
  });

  it('should return 0 when both are 0', () => {
    expect(calculateComparisonToAverage(0, 0)).toBe(0);
  });

  it('should return positive for above average', () => {
    expect(calculateComparisonToAverage(12, 10)).toBe(20);
  });

  it('should return negative for below average', () => {
    expect(calculateComparisonToAverage(8, 10)).toBe(-20);
  });
});

describe('getComparisonInsight', () => {
  it('should handle first day scenario', () => {
    expect(getComparisonInsight(5, 0)).toContain('Great start');
  });

  it('should celebrate high performance', () => {
    expect(getComparisonInsight(20, 10)).toContain('Outstanding');
  });

  it('should encourage on low days', () => {
    expect(getComparisonInsight(3, 10)).toContain('tomorrow');
  });
});

describe('generateEncouragement', () => {
  it('should congratulate perfect completion', () => {
    expect(generateEncouragement(100)).toContain('Perfect');
  });

  it('should encourage on partial completion', () => {
    expect(generateEncouragement(70)).toContain('effort');
  });

  it('should acknowledge low days positively', () => {
    expect(generateEncouragement(20)).toContain('progress');
  });

  it('should include streak in message when significant', () => {
    expect(generateEncouragement(80, 7)).toContain('7-day');
  });
});

describe('generateSummaryInsights', () => {
  it('should include achievement for 100% completion', () => {
    const focusDay = createFocusDay({
      plannedPoints: 10,
      completedPoints: 10,
    });
    const insights = generateSummaryInsights(focusDay);
    expect(insights.some((i) => i.type === 'achievement')).toBe(true);
  });

  it('should include streak for 2+ days', () => {
    const focusDay = createFocusDay();
    const velocity: FocusVelocity = {
      averagePointsPerDay: 8,
      averageCompletionRate: 75,
      totalDaysTracked: 10,
      currentStreak: 3,
      longestStreak: 5,
      weeklyTrend: [],
    };
    const insights = generateSummaryInsights(focusDay, velocity);
    expect(insights.some((i) => i.type === 'streak')).toBe(true);
  });

  it('should always include encouragement', () => {
    const focusDay = createFocusDay();
    const insights = generateSummaryInsights(focusDay);
    expect(insights.some((i) => i.type === 'encouragement')).toBe(true);
  });
});

describe('generateEndOfDaySummary', () => {
  it('should generate complete summary data', () => {
    const focusDay = createFocusDay({
      plannedPoints: 10,
      completedPoints: 8,
      completedItems: 3,
      items: [
        createFocusItem({ status: 'done', source: 't1', points: 3 }),
        createFocusItem({ status: 'done', source: 't2', points: 5 }),
        createFocusItem({ status: 'deferred', source: 't3', points: 2 }),
      ],
      mood: 'good',
      reflection: 'Great day!',
    });

    const summary = generateEndOfDaySummary(focusDay);

    expect(summary.date).toBe('2024-01-15');
    expect(summary.plannedPoints).toBe(10);
    expect(summary.completedPoints).toBe(8);
    expect(summary.completionPercentage).toBe(80);
    expect(summary.completedItems).toBe(3);
    expect(summary.totalItems).toBe(3);
    expect(summary.deferredCount).toBe(1);
    expect(summary.mood).toBe('good');
    expect(summary.reflection).toBe('Great day!');
    expect(summary.topCompletedItems).toHaveLength(2);
  });

  it('should include velocity comparison when available', () => {
    const focusDay = createFocusDay({
      completedPoints: 12,
    });
    const velocity: FocusVelocity = {
      averagePointsPerDay: 10,
      averageCompletionRate: 80,
      totalDaysTracked: 5,
      currentStreak: 2,
      longestStreak: 3,
      weeklyTrend: [],
    };

    const summary = generateEndOfDaySummary(focusDay, velocity);

    expect(summary.streakDays).toBe(2);
    expect(summary.comparisonToAverage).toBe(20);
  });
});

describe('updateFocusDayReflection', () => {
  it('should update mood', () => {
    const focusDay = createFocusDay();
    const updated = updateFocusDayReflection(focusDay, 'great');
    expect(updated.mood).toBe('great');
  });

  it('should update reflection', () => {
    const focusDay = createFocusDay();
    const updated = updateFocusDayReflection(focusDay, undefined, 'New reflection');
    expect(updated.reflection).toBe('New reflection');
  });

  it('should preserve existing values when not provided', () => {
    const focusDay = createFocusDay({ mood: 'good', reflection: 'Original' });
    const updated = updateFocusDayReflection(focusDay, undefined, undefined);
    expect(updated.mood).toBe('good');
    expect(updated.reflection).toBe('Original');
  });
});

describe('isSummaryReady', () => {
  it('should return true when all items done or deferred', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'done', source: 't1' }),
        createFocusItem({ status: 'deferred', source: 't2' }),
      ],
    });
    expect(isSummaryReady(focusDay)).toBe(true);
  });

  it('should return false when items are pending', () => {
    const focusDay = createFocusDay({
      items: [
        createFocusItem({ status: 'done', source: 't1' }),
        createFocusItem({ status: 'pending', source: 't2' }),
      ],
    });
    expect(isSummaryReady(focusDay)).toBe(false);
  });

  it('should return false when items are in progress', () => {
    const focusDay = createFocusDay({
      items: [createFocusItem({ status: 'in_progress', source: 't1' })],
    });
    expect(isSummaryReady(focusDay)).toBe(false);
  });
});

describe('suggestMood', () => {
  it('should suggest great for 90%+', () => {
    expect(suggestMood(95)).toBe('great');
  });

  it('should suggest good for 70-89%', () => {
    expect(suggestMood(75)).toBe('good');
  });

  it('should suggest okay for 40-69%', () => {
    expect(suggestMood(50)).toBe('okay');
  });

  it('should suggest low for under 40%', () => {
    expect(suggestMood(30)).toBe('low');
  });
});
