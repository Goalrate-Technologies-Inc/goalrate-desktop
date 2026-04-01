import { describe, it, expect } from 'vitest';
import {
  determineQuadrant,
  classifyItem,
  classifyAndSort,
  groupByQuadrant,
  getTodaysFocusItems,
  shouldBeInTodaysFocus,
} from '../../src/prioritization/eisenhower';
import type { PrioritizableItem } from '@goalrate-app/shared';

describe('determineQuadrant', () => {
  it('should return do_first for urgent and important', () => {
    expect(determineQuadrant(75, 75)).toBe('do_first');
    expect(determineQuadrant(50, 50)).toBe('do_first');
  });

  it('should return schedule for not urgent but important', () => {
    expect(determineQuadrant(25, 75)).toBe('schedule');
    expect(determineQuadrant(49, 50)).toBe('schedule');
  });

  it('should return delegate for urgent but not important', () => {
    expect(determineQuadrant(75, 25)).toBe('delegate');
    expect(determineQuadrant(50, 49)).toBe('delegate');
  });

  it('should return eliminate for neither urgent nor important', () => {
    expect(determineQuadrant(25, 25)).toBe('eliminate');
    expect(determineQuadrant(49, 49)).toBe('eliminate');
  });
});

describe('classifyItem', () => {
  const today = new Date('2024-01-15');

  it('should classify item with all scores', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test Task',
      priority: 'high',
      due_date: '2024-01-16', // Due tomorrow - urgent
    };

    const classified = classifyItem(item, today);

    expect(classified.item).toBe(item);
    expect(classified.quadrant).toBe('do_first');
    expect(classified.urgencyLevel).toBe('critical');
    expect(classified.importanceLevel).toBe('high');
    expect(classified.daysUntilDue).toBe(1);
    expect(classified.urgencyScore).toBeGreaterThan(0);
    expect(classified.importanceScore).toBeGreaterThan(0);
    expect(classified.priorityScore).toBeGreaterThan(0);
  });

  it('should classify low priority distant item as eliminate', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test Task',
      priority: 'low',
      due_date: '2024-03-15', // 2 months away
    };

    const classified = classifyItem(item, today);
    expect(classified.quadrant).toBe('eliminate');
  });

  it('should classify high priority distant item as schedule', () => {
    const item: PrioritizableItem = {
      id: '1',
      title: 'Test Task',
      priority: 'high',
      due_date: '2024-03-15', // 2 months away
    };

    const classified = classifyItem(item, today);
    expect(classified.quadrant).toBe('schedule');
  });
});

describe('classifyAndSort', () => {
  const today = new Date('2024-01-15');

  const items: PrioritizableItem[] = [
    { id: '1', title: 'Low priority', priority: 'low' },
    { id: '2', title: 'Urgent', priority: 'high', due_date: '2024-01-15' },
    { id: '3', title: 'Done', priority: 'high', completed: true },
    { id: '4', title: 'Medium', priority: 'medium', due_date: '2024-01-20' },
  ];

  it('should exclude completed items by default', () => {
    const result = classifyAndSort(items, { today });
    expect(result.length).toBe(3);
    expect(result.find((r) => r.item.id === '3')).toBeUndefined();
  });

  it('should include completed items when option is false', () => {
    const result = classifyAndSort(items, { today, excludeCompleted: false });
    expect(result.length).toBe(4);
  });

  it('should sort by priority score descending', () => {
    const result = classifyAndSort(items, { today });
    expect(result[0]?.item.id).toBe('2'); // Urgent should be first
  });

  it('should exclude specified quadrants', () => {
    const result = classifyAndSort(items, {
      today,
      excludeQuadrants: ['eliminate'],
    });
    expect(result.every((r) => r.quadrant !== 'eliminate')).toBe(true);
  });
});

describe('groupByQuadrant', () => {
  const today = new Date('2024-01-15');

  const items: PrioritizableItem[] = [
    { id: '1', title: 'Q1 Task', priority: 'high', due_date: '2024-01-15' },
    { id: '2', title: 'Q2 Task', priority: 'high', due_date: '2024-03-15' },
    { id: '3', title: 'Q3 Task', priority: 'low', due_date: '2024-01-16' },
    { id: '4', title: 'Q4 Task', priority: 'low', due_date: '2024-03-15' },
  ];

  it('should group items by quadrant', () => {
    const classified = classifyAndSort(items, { today });
    const groups = groupByQuadrant(classified);

    expect(groups.do_first.length).toBeGreaterThan(0);
    expect(groups.schedule.length).toBeGreaterThan(0);
    expect(groups.delegate.length).toBeGreaterThan(0);
    expect(groups.eliminate.length).toBeGreaterThan(0);
  });

  it('should sort each group by priority score', () => {
    const classified = classifyAndSort(items, { today });
    const groups = groupByQuadrant(classified);

    for (const quadrant of ['do_first', 'schedule', 'delegate', 'eliminate'] as const) {
      const group = groups[quadrant];
      for (let i = 1; i < group.length; i++) {
        const current = group[i];
        const previous = group[i - 1];
        if (current && previous) {
          expect(previous.priorityScore).toBeGreaterThanOrEqual(current.priorityScore);
        }
      }
    }
  });
});

describe('getTodaysFocusItems', () => {
  const today = new Date('2024-01-15');

  const items: PrioritizableItem[] = [
    { id: '1', title: 'Urgent', priority: 'high', due_date: '2024-01-15' },
    { id: '2', title: 'Low', priority: 'low' },
    { id: '3', title: 'Important', priority: 'high', due_date: '2024-03-15' },
    { id: '4', title: 'Medium', priority: 'medium', due_date: '2024-01-20' },
  ];

  it('should return limited items', () => {
    const result = getTodaysFocusItems(items, 2, today);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('should exclude eliminate quadrant', () => {
    const result = getTodaysFocusItems(items, 10, today);
    expect(result.every((r) => r.quadrant !== 'eliminate')).toBe(true);
  });

  it('should return most important items first', () => {
    const result = getTodaysFocusItems(items, 10, today);
    if (result[0]) {
      expect(result[0].quadrant).toBe('do_first');
    }
  });
});

describe('shouldBeInTodaysFocus', () => {
  it('should return true for do_first quadrant', () => {
    const classified = {
      item: { id: '1', title: 'Test' },
      quadrant: 'do_first' as const,
      urgencyLevel: 'critical' as const,
      importanceLevel: 'high' as const,
      urgencyScore: 90,
      importanceScore: 75,
      priorityScore: 81,
      daysUntilDue: 0,
    };
    expect(shouldBeInTodaysFocus(classified)).toBe(true);
  });

  it('should return true for schedule items due soon', () => {
    const classified = {
      item: { id: '1', title: 'Test' },
      quadrant: 'schedule' as const,
      urgencyLevel: 'low' as const,
      importanceLevel: 'high' as const,
      urgencyScore: 25,
      importanceScore: 75,
      priorityScore: 55,
      daysUntilDue: 3,
    };
    expect(shouldBeInTodaysFocus(classified)).toBe(true);
  });

  it('should return true for critical importance in schedule', () => {
    const classified = {
      item: { id: '1', title: 'Test' },
      quadrant: 'schedule' as const,
      urgencyLevel: 'low' as const,
      importanceLevel: 'critical' as const,
      urgencyScore: 25,
      importanceScore: 90,
      priorityScore: 64,
      daysUntilDue: 30,
    };
    expect(shouldBeInTodaysFocus(classified)).toBe(true);
  });

  it('should return true for overdue delegate items', () => {
    const classified = {
      item: { id: '1', title: 'Test' },
      quadrant: 'delegate' as const,
      urgencyLevel: 'critical' as const,
      importanceLevel: 'low' as const,
      urgencyScore: 100,
      importanceScore: 25,
      priorityScore: 55,
      daysUntilDue: -5,
    };
    expect(shouldBeInTodaysFocus(classified)).toBe(true);
  });

  it('should return false for eliminate quadrant', () => {
    const classified = {
      item: { id: '1', title: 'Test' },
      quadrant: 'eliminate' as const,
      urgencyLevel: 'low' as const,
      importanceLevel: 'low' as const,
      urgencyScore: 25,
      importanceScore: 25,
      priorityScore: 25,
      daysUntilDue: 30,
    };
    expect(shouldBeInTodaysFocus(classified)).toBe(false);
  });
});
