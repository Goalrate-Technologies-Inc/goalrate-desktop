import { describe, it, expect } from 'vitest';
import {
  generateFocusList,
  generateFocusDay,
  completeFocusItem,
  deferFocusItem,
} from '../../src/focus/generator';
import type { FocusCandidate, FocusDay } from '@goalrate-app/shared';

describe('generateFocusList', () => {
  const today = new Date('2024-01-15');

  const candidates: FocusCandidate[] = [
    {
      id: 'task-1',
      type: 'goal_task',
      title: 'Task 1',
      points: 3,
      priority: 'high',
      dueDate: '2024-01-16',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: true,
    },
    {
      id: 'task-2',
      type: 'goal_task',
      title: 'Task 2',
      points: 5,
      priority: 'medium',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    },
    {
      id: 'task-3',
      type: 'story',
      title: 'Story 1',
      points: 8,
      priority: 'low',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    },
  ];

  it('should generate focus list within capacity', () => {
    const result = generateFocusList(candidates, {
      pointCapacity: 10,
      today,
    });

    expect(result.totalPoints).toBeLessThanOrEqual(10);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('should put overflow items in overflow array', () => {
    const result = generateFocusList(candidates, {
      pointCapacity: 5,
      today,
    });

    expect(result.overflow.length).toBeGreaterThan(0);
    expect(result.totalPoints).toBeLessThanOrEqual(5);
  });

  it('should calculate capacity used percentage', () => {
    const result = generateFocusList(candidates, {
      pointCapacity: 10,
      today,
    });

    expect(result.capacityUsed).toBe((result.totalPoints / 10) * 100);
  });

  it('should generate reasons for items', () => {
    const result = generateFocusList(candidates, {
      pointCapacity: 15,
      today,
    });

    result.items.forEach((item) => {
      expect(item.reason).toBeTruthy();
      expect(typeof item.reason).toBe('string');
    });
  });

  it('should set items to pending status', () => {
    const result = generateFocusList(candidates, {
      pointCapacity: 15,
      today,
    });

    result.items.forEach((item) => {
      expect(item.status).toBe('pending');
    });
  });

  it('should include goal/project context', () => {
    const candidatesWithContext: FocusCandidate[] = [
      {
        ...candidates[0]!,
        goalId: 'goal-1',
        goalTitle: 'Test Goal',
      },
    ];

    const result = generateFocusList(candidatesWithContext, {
      pointCapacity: 15,
      today,
    });

    expect(result.items[0]?.goalId).toBe('goal-1');
    expect(result.items[0]?.goalTitle).toBe('Test Goal');
  });

  it('should filter excluded goals', () => {
    const candidatesWithGoals: FocusCandidate[] = [
      { ...candidates[0]!, goalId: 'goal-1' },
      { ...candidates[1]!, goalId: 'goal-2' },
    ];

    const result = generateFocusList(candidatesWithGoals, {
      pointCapacity: 15,
      today,
      excludeGoals: ['goal-1'],
    });

    expect(result.items.every((i) => i.goalId !== 'goal-1')).toBe(true);
  });

  it('should prioritize specified goal', () => {
    const candidatesWithGoals: FocusCandidate[] = [
      { ...candidates[0]!, goalId: 'goal-1', priority: 'low' },
      { ...candidates[1]!, goalId: 'goal-2', priority: 'high' },
    ];

    const result = generateFocusList(candidatesWithGoals, {
      pointCapacity: 15,
      today,
      prioritizeGoalId: 'goal-1',
    });

    // The lower priority item from goal-1 should be boosted above
    const goal1Index = result.items.findIndex((i) => i.goalId === 'goal-1');
    expect(goal1Index).toBe(0);
  });
});

describe('generateFocusDay', () => {
  const today = new Date('2024-01-15');

  const candidates: FocusCandidate[] = [
    {
      id: 'task-1',
      type: 'goal_task',
      title: 'Task 1',
      points: 3,
      priority: 'high',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    },
    {
      id: 'task-2',
      type: 'goal_task',
      title: 'Task 2',
      points: 5,
      priority: 'medium',
      blocks: [],
      blocksPeople: false,
      inCurrentSprint: false,
    },
  ];

  it('should create a complete FocusDay', () => {
    const focusDay = generateFocusDay(candidates, 6, today);

    expect(focusDay.id).toBe('focus_2024-01-15');
    expect(focusDay.date).toBe('2024-01-15');
    expect(focusDay.availableHours).toBe(6);
    expect(focusDay.pointCapacity).toBe(9); // 6 * 1.5
    expect(focusDay.items.length).toBeGreaterThan(0);
    expect(focusDay.plannedPoints).toBeGreaterThan(0);
    expect(focusDay.completedPoints).toBe(0);
    expect(focusDay.completedItems).toBe(0);
  });

  it('should calculate capacity from hours', () => {
    const focusDay4Hours = generateFocusDay(candidates, 4, today);
    const focusDay8Hours = generateFocusDay(candidates, 8, today);

    expect(focusDay4Hours.pointCapacity).toBe(6); // 4 * 1.5
    expect(focusDay8Hours.pointCapacity).toBe(12); // 8 * 1.5
  });
});

describe('completeFocusItem', () => {
  const baseFocusDay: FocusDay = {
    id: 'focus_2024-01-15',
    date: '2024-01-15',
    availableHours: 6,
    pointCapacity: 9,
    items: [
      {
        source: 'task-1',
        type: 'goal_task',
        title: 'Task 1',
        points: 3,
        score: 75,
        reason: 'Due today',
        status: 'pending',
      },
      {
        source: 'task-2',
        type: 'goal_task',
        title: 'Task 2',
        points: 5,
        score: 50,
        reason: 'In sprint',
        status: 'pending',
      },
    ],
    plannedPoints: 8,
    completedPoints: 0,
    completedItems: 0,
  };

  it('should mark item as done', () => {
    const updated = completeFocusItem(baseFocusDay, 'task-1');
    const completedItem = updated.items.find((i) => i.source === 'task-1');

    expect(completedItem?.status).toBe('done');
    expect(completedItem?.completedAt).toBeTruthy();
  });

  it('should update completed counts', () => {
    const updated = completeFocusItem(baseFocusDay, 'task-1');

    expect(updated.completedItems).toBe(1);
    expect(updated.completedPoints).toBe(3);
  });

  it('should not modify other items', () => {
    const updated = completeFocusItem(baseFocusDay, 'task-1');
    const otherItem = updated.items.find((i) => i.source === 'task-2');

    expect(otherItem?.status).toBe('pending');
  });

  it('should handle completing multiple items', () => {
    let updated = completeFocusItem(baseFocusDay, 'task-1');
    updated = completeFocusItem(updated, 'task-2');

    expect(updated.completedItems).toBe(2);
    expect(updated.completedPoints).toBe(8);
  });
});

describe('deferFocusItem', () => {
  const baseFocusDay: FocusDay = {
    id: 'focus_2024-01-15',
    date: '2024-01-15',
    availableHours: 6,
    pointCapacity: 9,
    items: [
      {
        source: 'task-1',
        type: 'goal_task',
        title: 'Task 1',
        points: 3,
        score: 75,
        reason: 'Due today',
        status: 'pending',
      },
      {
        source: 'task-2',
        type: 'goal_task',
        title: 'Task 2',
        points: 5,
        score: 50,
        reason: 'In sprint',
        status: 'pending',
      },
    ],
    plannedPoints: 8,
    completedPoints: 0,
    completedItems: 0,
  };

  it('should mark item as deferred', () => {
    const updated = deferFocusItem(baseFocusDay, 'task-1', '2024-01-16');
    const deferredItem = updated.items.find((i) => i.source === 'task-1');

    expect(deferredItem?.status).toBe('deferred');
    expect(deferredItem?.deferredTo).toBe('2024-01-16');
  });

  it('should update planned points', () => {
    const updated = deferFocusItem(baseFocusDay, 'task-1', '2024-01-16');

    // Only task-2 (5 points) should remain in planned
    expect(updated.plannedPoints).toBe(5);
  });

  it('should not modify other items', () => {
    const updated = deferFocusItem(baseFocusDay, 'task-1', '2024-01-16');
    const otherItem = updated.items.find((i) => i.source === 'task-2');

    expect(otherItem?.status).toBe('pending');
  });
});
