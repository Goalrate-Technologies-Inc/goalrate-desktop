import { describe, expect, it } from 'vitest';
import type { FocusDayStats } from '@goalrate-app/shared';
import { FocusService } from '../../src/focus/focusService';
import type { FocusListTask } from '../../src/focus/listFilter';

function createTask(overrides: Partial<FocusListTask> = {}): FocusListTask {
  return {
    id: 'task-1',
    vaultId: 'vault-1',
    title: 'Task 1',
    dueAt: null,
    deadlineAt: null,
    priority: 3,
    storyPoints: 1,
    status: 'todo',
    assignedToUserId: 'user-1',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildDayStats(params: {
  date: string;
  plannedTaskStoryPoints: number[];
  plannedTaskIds: string[];
  completedTaskIds: string[];
}): FocusDayStats {
  const completedSet = new Set(params.completedTaskIds);
  const completedTaskIds = params.plannedTaskIds.filter((id) =>
    completedSet.has(id)
  );
  const completedCount = completedTaskIds.length;
  const plannedCount = params.plannedTaskIds.length;
  const allDone =
    plannedCount > 0 &&
    completedCount === plannedCount;

  return {
    date: params.date,
    plannedCount,
    plannedSP: params.plannedTaskStoryPoints.reduce((sum, value) => sum + value, 0),
    completedCount,
    completedSP: params.plannedTaskStoryPoints
      .filter((_, index) => completedSet.has(params.plannedTaskIds[index]!))
      .reduce((sum, value) => sum + value, 0),
    allDone,
  };
}

describe('day close capacity adjustment integration', () => {
  const service = new FocusService();

  it('increases next-day capacity by 10% when all planned tasks are completed', () => {
    const result = service.aggregate({
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      tasks: [
        createTask({
          id: 'task-a',
          dueAt: '2026-03-01T10:00:00.000Z',
          priority: 4,
          storyPoints: 2,
        }),
        createTask({
          id: 'task-b',
          dueAt: '2026-03-01T11:00:00.000Z',
          priority: 3,
          storyPoints: 2,
        }),
      ],
      date: '2026-03-01',
      capacitySP: 13,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    const plannedTaskIds = result.focusListDay.entries.map((entry) => entry.taskId);
    const plannedTaskStoryPoints = result.focusListDay.entries.map(
      (entry) => entry.storyPoints
    );
    const nextCapacitySP = service.closeDay({
      date: result.focusListDay.date,
      currentCapacitySP: result.focusListDay.capacitySP,
      stats: buildDayStats({
        date: result.focusListDay.date,
        plannedTaskIds,
        plannedTaskStoryPoints,
        completedTaskIds: plannedTaskIds,
      }),
    });

    expect(result.focusListDay.plannedCount).toBe(2);
    expect(nextCapacitySP.nextCapacitySP).toBe(14.5);
  });

  it('decreases next-day capacity by 10% when any planned task is not completed', () => {
    const result = service.aggregate({
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      tasks: [
        createTask({
          id: 'task-a',
          dueAt: '2026-03-01T10:00:00.000Z',
          priority: 4,
          storyPoints: 2,
        }),
        createTask({
          id: 'task-b',
          dueAt: '2026-03-01T11:00:00.000Z',
          priority: 3,
          storyPoints: 2,
        }),
      ],
      date: '2026-03-01',
      capacitySP: 13,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    const plannedTaskIds = result.focusListDay.entries.map((entry) => entry.taskId);
    const plannedTaskStoryPoints = result.focusListDay.entries.map(
      (entry) => entry.storyPoints
    );
    const nextCapacitySP = service.closeDay({
      date: result.focusListDay.date,
      currentCapacitySP: result.focusListDay.capacitySP,
      stats: buildDayStats({
        date: result.focusListDay.date,
        plannedTaskIds,
        plannedTaskStoryPoints,
        completedTaskIds: [plannedTaskIds[0]!],
      }),
    });

    expect(nextCapacitySP.nextCapacitySP).toBe(11.5);
  });

  it('respects min/max clamps on day close adjustment', () => {
    const increasedAtMax = service.closeDay({
      date: '2026-03-01',
      currentCapacitySP: 40,
      stats: buildDayStats({
        date: '2026-03-01',
        plannedTaskIds: ['task-a'],
        plannedTaskStoryPoints: [2],
        completedTaskIds: ['task-a'],
      }),
    });
    const decreasedAtMin = service.closeDay({
      date: '2026-03-01',
      currentCapacitySP: 3,
      stats: buildDayStats({
        date: '2026-03-01',
        plannedTaskIds: ['task-a'],
        plannedTaskStoryPoints: [2],
        completedTaskIds: [],
      }),
    });

    expect(increasedAtMax.nextCapacitySP).toBe(40);
    expect(decreasedAtMin.nextCapacitySP).toBe(3);
  });
});
