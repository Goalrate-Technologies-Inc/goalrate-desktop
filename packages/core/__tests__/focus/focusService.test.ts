import { describe, expect, it, vi } from 'vitest';
import type { FocusDayStats } from '@goalrate-app/shared';
import { FocusService } from '../../src/focus/focusService';
import type { FocusListTask } from '../../src/focus/listFilter';
import type { VaultTaskSourceAdapter } from '../../src/focus/vaultAdapter';

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

describe('FocusService.aggregate', () => {
  const service = new FocusService();

  it('filters, sorts, and packs tasks into a FocusListDay payload', () => {
    const tasks: FocusListTask[] = [
      createTask({
        id: 'task-a',
        title: 'Later due task',
        dueAt: '2026-03-03T12:00:00.000Z',
        priority: 2,
        storyPoints: 3,
      }),
      createTask({
        id: 'task-b',
        title: 'Same day higher priority',
        dueAt: '2026-03-01T12:00:00.000Z',
        priority: 4,
        storyPoints: 2,
      }),
      createTask({
        id: 'task-c',
        title: 'Same day lower priority',
        dueAt: '2026-03-01T12:00:00.000Z',
        priority: 1,
        storyPoints: 2,
      }),
      createTask({
        id: 'task-not-assigned',
        assignedToUserId: 'other-user',
        storyPoints: 1,
      }),
      createTask({
        id: 'task-blocked',
        status: 'blocked',
        storyPoints: 1,
      }),
      createTask({
        id: 'task-no-points',
        storyPoints: 0,
      }),
      createTask({
        id: 'task-closed-vault',
        vaultId: 'vault-closed',
        storyPoints: 1,
      }),
    ];

    const result = service.aggregate({
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      tasks,
      date: '2026-03-01',
      capacitySP: 4,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    expect(result.focusListDay.date).toBe('2026-03-01');
    expect(result.focusListDay.capacitySP).toBe(4);
    expect(result.focusListDay.packedSP).toBe(4);
    expect(result.focusListDay.plannedCount).toBe(2);
    expect(result.focusListDay.generatedAt).toBe('2026-03-01T08:00:00.000Z');

    expect(result.focusListDay.entries.map((entry) => entry.taskId)).toEqual([
      'task-b',
      'task-c',
    ]);
    expect(result.focusListDay.entries.map((entry) => entry.id)).toEqual([
      'focus_2026-03-01_task-b',
      'focus_2026-03-01_task-c',
    ]);

    expect(result.overflowTasks.map((task) => task.id)).toEqual(['task-a']);
  });

  it('uses deadlineAt over dueAt for entry dueAt', () => {
    const result = service.aggregate({
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      tasks: [
        createTask({
          id: 'task-deadline',
          dueAt: '2026-03-10T10:00:00.000Z',
          deadlineAt: '2026-03-02T10:00:00.000Z',
          storyPoints: 1,
        }),
      ],
      date: '2026-03-01',
      capacitySP: 3,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    expect(result.focusListDay.entries[0]?.dueAt).toBe('2026-03-02T10:00:00.000Z');
  });

  it('does not mutate source tasks', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-a', storyPoints: 2 }),
      createTask({ id: 'task-b', storyPoints: 2 }),
    ];
    const originalIds = tasks.map((task) => task.id);

    service.aggregate({
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      tasks,
      date: '2026-03-01',
      capacitySP: 2,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    expect(tasks.map((task) => task.id)).toEqual(originalIds);
  });
});

describe('FocusService.aggregateFromVaults', () => {
  it('loads tasks from VaultTaskSourceAdapter and aggregates them', async () => {
    const adapter: VaultTaskSourceAdapter = {
      listTasksForUser: vi.fn(() => [
        createTask({
          id: 'vault-1-task',
          vaultId: 'vault-1',
          dueAt: '2026-03-02T10:00:00.000Z',
          priority: 3,
          storyPoints: 2,
        }),
        createTask({
          id: 'vault-2-higher-priority',
          vaultId: 'vault-2',
          dueAt: '2026-03-02T10:00:00.000Z',
          priority: 5,
          storyPoints: 2,
        }),
        createTask({
          id: 'vault-2-other-user',
          vaultId: 'vault-2',
          assignedToUserId: 'other-user',
          storyPoints: 1,
        }),
        createTask({
          id: 'closed-vault-task',
          vaultId: 'vault-closed',
          storyPoints: 1,
        }),
      ]),
    };

    const service = new FocusService(adapter);

    const result = await service.aggregateFromVaults({
      userId: 'user-1',
      openVaultIds: ['vault-1', 'vault-2'],
      date: '2026-03-01',
      capacitySP: 4,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    expect(adapter.listTasksForUser).toHaveBeenCalledTimes(1);
    expect(adapter.listTasksForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      openVaultIds: ['vault-1', 'vault-2'],
    });
    expect(result.focusListDay.entries.map((entry) => entry.taskId)).toEqual([
      'vault-2-higher-priority',
      'vault-1-task',
    ]);
    expect(result.overflowTasks).toEqual([]);
  });

  it('throws when aggregateFromVaults is called without an adapter', async () => {
    const service = new FocusService();

    await expect(
      service.aggregateFromVaults({
        userId: 'user-1',
        openVaultIds: ['vault-1'],
        date: '2026-03-01',
        capacitySP: 4,
      })
    ).rejects.toThrow('requires a VaultTaskSourceAdapter');
  });
});

describe('FocusService.closeDay', () => {
  const service = new FocusService();

  function buildDayStats(
    overrides: Partial<FocusDayStats> = {}
  ): FocusDayStats {
    return {
      date: '2026-03-01',
      plannedCount: 2,
      plannedSP: 5,
      completedCount: 2,
      completedSP: 5,
      allDone: true,
      ...overrides,
    };
  }

  it('increases next-day capacity by 10% when all planned work is complete', () => {
    const aggregation = service.aggregate({
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
          storyPoints: 3,
        }),
      ],
      date: '2026-03-01',
      capacitySP: 13,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    const closeDayResult = service.closeDay({
      date: aggregation.focusListDay.date,
      currentCapacitySP: aggregation.focusListDay.capacitySP,
      stats: buildDayStats({
        plannedCount: aggregation.focusListDay.plannedCount,
        plannedSP: aggregation.focusListDay.packedSP,
        completedCount: aggregation.focusListDay.plannedCount,
        completedSP: aggregation.focusListDay.packedSP,
        allDone: true,
      }),
    });

    expect(closeDayResult.nextCapacitySP).toBe(14.5);
  });

  it('decreases next-day capacity by 10% when planned work is not fully complete', () => {
    const aggregation = service.aggregate({
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
          storyPoints: 3,
        }),
      ],
      date: '2026-03-01',
      capacitySP: 13,
      generatedAt: '2026-03-01T08:00:00.000Z',
    });

    const closeDayResult = service.closeDay({
      date: aggregation.focusListDay.date,
      currentCapacitySP: aggregation.focusListDay.capacitySP,
      stats: buildDayStats({
        plannedCount: aggregation.focusListDay.plannedCount,
        plannedSP: aggregation.focusListDay.packedSP,
        completedCount: 1,
        completedSP: 2,
        allDone: false,
      }),
    });

    expect(closeDayResult.nextCapacitySP).toBe(11.5);
  });

  it('supports reset-to-baseline debug overrides', () => {
    const closeDayResult = service.closeDay({
      date: '2026-03-01',
      currentCapacitySP: 29,
      stats: buildDayStats({ allDone: false }),
      profile: {
        baselineSP: 11,
        minSP: 3,
        maxSP: 40,
      },
      debug: {
        resetToBaseline: true,
      },
    });

    expect(closeDayResult.nextCapacitySP).toBe(11);
  });

  it('supports freeze-capacity debug overrides', () => {
    const closeDayResult = service.closeDay({
      date: '2026-03-01',
      currentCapacitySP: 17,
      stats: buildDayStats({ allDone: true }),
      debug: {
        freezeCapacity: true,
      },
    });

    expect(closeDayResult.nextCapacitySP).toBe(17);
  });
});
