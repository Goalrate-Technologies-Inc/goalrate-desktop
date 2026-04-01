import { describe, it, expect } from 'vitest';
import {
  calculateUrgencyScore,
  getUrgencyLevel,
  calculateImportanceScore,
  getImportanceLevel,
  calculatePriorityScore,
  calculateItemScores,
} from '../../src/prioritization/scoring';
import type { PrioritizableItem } from '@goalrate-app/shared';

describe('calculateUrgencyScore', () => {
  it('should return 0 for null days', () => {
    expect(calculateUrgencyScore(null)).toBe(0);
  });

  it('should return 100 for overdue items', () => {
    expect(calculateUrgencyScore(-1)).toBe(100);
    expect(calculateUrgencyScore(-10)).toBe(100);
  });

  it('should return 95 for due today', () => {
    expect(calculateUrgencyScore(0)).toBe(95);
  });

  it('should return 90 for critical threshold (1 day)', () => {
    expect(calculateUrgencyScore(1)).toBe(90);
  });

  it('should return 75 for high threshold (3 days)', () => {
    expect(calculateUrgencyScore(3)).toBe(75);
  });

  it('should return 50 for medium threshold (7 days)', () => {
    expect(calculateUrgencyScore(7)).toBe(50);
  });

  it('should return 25 for low threshold (14 days)', () => {
    expect(calculateUrgencyScore(14)).toBe(25);
  });

  it('should decay for far future dates', () => {
    expect(calculateUrgencyScore(20)).toBeLessThan(25);
    // Formula: max(0, 20 - (days - 14)), so 0 when days >= 34
    expect(calculateUrgencyScore(30)).toBeLessThan(10);
    expect(calculateUrgencyScore(40)).toBe(0);
  });
});

describe('getUrgencyLevel', () => {
  it('should return critical for >= 90', () => {
    expect(getUrgencyLevel(100)).toBe('critical');
    expect(getUrgencyLevel(90)).toBe('critical');
  });

  it('should return high for >= 70', () => {
    expect(getUrgencyLevel(89)).toBe('high');
    expect(getUrgencyLevel(70)).toBe('high');
  });

  it('should return medium for >= 40', () => {
    expect(getUrgencyLevel(69)).toBe('medium');
    expect(getUrgencyLevel(40)).toBe('medium');
  });

  it('should return low for > 0', () => {
    expect(getUrgencyLevel(39)).toBe('low');
    expect(getUrgencyLevel(1)).toBe('low');
  });

  it('should return none for 0', () => {
    expect(getUrgencyLevel(0)).toBe('none');
  });
});

describe('calculateImportanceScore', () => {
  it('should return 50 for medium priority', () => {
    const item: PrioritizableItem = { id: '1', title: 'Test', priority: 'medium' };
    expect(calculateImportanceScore(item)).toBe(50);
  });

  it('should return 100 for critical priority', () => {
    const item: PrioritizableItem = { id: '1', title: 'Test', priority: 'critical' };
    expect(calculateImportanceScore(item)).toBe(100);
  });

  it('should return 75 for high priority', () => {
    const item: PrioritizableItem = { id: '1', title: 'Test', priority: 'high' };
    expect(calculateImportanceScore(item)).toBe(75);
  });

  it('should return 25 for low priority', () => {
    const item: PrioritizableItem = { id: '1', title: 'Test', priority: 'low' };
    expect(calculateImportanceScore(item)).toBe(25);
  });

  it('should add bonus for story points', () => {
    const baseItem: PrioritizableItem = { id: '1', title: 'Test', priority: 'medium' };
    const withPoints: PrioritizableItem = { ...baseItem, story_points: 8 };
    expect(calculateImportanceScore(withPoints)).toBeGreaterThan(
      calculateImportanceScore(baseItem)
    );
  });

  it('should add bonus for long estimated time', () => {
    const baseItem: PrioritizableItem = { id: '1', title: 'Test', priority: 'medium' };
    const withTime: PrioritizableItem = { ...baseItem, estimated_hours: 4 };
    expect(calculateImportanceScore(withTime)).toBeGreaterThan(
      calculateImportanceScore(baseItem)
    );
  });

  it('should cap score at 100', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test',
      priority: 'critical',
      story_points: 21,
      estimated_hours: 10,
    };
    expect(calculateImportanceScore(item)).toBeLessThanOrEqual(100);
  });
});

describe('getImportanceLevel', () => {
  it('should return critical for >= 80', () => {
    expect(getImportanceLevel(100)).toBe('critical');
    expect(getImportanceLevel(80)).toBe('critical');
  });

  it('should return high for >= 60', () => {
    expect(getImportanceLevel(79)).toBe('high');
    expect(getImportanceLevel(60)).toBe('high');
  });

  it('should return medium for >= 40', () => {
    expect(getImportanceLevel(59)).toBe('medium');
    expect(getImportanceLevel(40)).toBe('medium');
  });

  it('should return low for < 40', () => {
    expect(getImportanceLevel(39)).toBe('low');
    expect(getImportanceLevel(0)).toBe('low');
  });
});

describe('calculatePriorityScore', () => {
  it('should weight urgency at 40% and importance at 60%', () => {
    expect(calculatePriorityScore(100, 0)).toBe(40);
    expect(calculatePriorityScore(0, 100)).toBe(60);
    expect(calculatePriorityScore(100, 100)).toBe(100);
    expect(calculatePriorityScore(50, 50)).toBe(50);
  });
});

describe('calculateItemScores', () => {
  const today = new Date('2024-01-15');

  it('should calculate all scores for an item', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test',
      priority: 'high',
      due_date: '2024-01-17', // 2 days from today
    };

    const scores = calculateItemScores(item, today);

    expect(scores.daysUntilDue).toBe(2);
    expect(scores.urgencyScore).toBe(75); // high threshold
    expect(scores.importanceScore).toBe(75);
    expect(scores.priorityScore).toBe(75); // 75 * 0.4 + 75 * 0.6 = 75
    expect(scores.urgencyLevel).toBe('high');
    expect(scores.importanceLevel).toBe('high');
  });

  it('should handle item with no due date', () => {
    const item: PrioritizableItem = { id: '1', title: 'Test', priority: 'medium' };
    const scores = calculateItemScores(item, today);

    expect(scores.daysUntilDue).toBeNull();
    expect(scores.urgencyScore).toBe(0);
    expect(scores.urgencyLevel).toBe('none');
  });

  it('should use deadline if due_date not present', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test',
      priority: 'medium',
      deadline: '2024-01-15',
    };
    const scores = calculateItemScores(item, today);
    expect(scores.daysUntilDue).toBe(0);
    expect(scores.urgencyScore).toBe(95);
  });
});
