import { describe, expect, it } from 'vitest';
import type { FocusListTask } from '../../src/focus/listFilter';
import { packFocusListTasks } from '../../src/focus/listPacker';

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

describe('packFocusListTasks', () => {
  it('greedily packs in input order without exceeding capacity', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-5', storyPoints: 5 }),
      createTask({ id: 'task-4', storyPoints: 4 }),
      createTask({ id: 'task-3', storyPoints: 3 }),
    ];

    const result = packFocusListTasks({ tasks, capacitySP: 8 });

    expect(result.capacitySP).toBe(8);
    expect(result.packedSP).toBe(8);
    expect(result.packedTasks.map((task) => task.id)).toEqual(['task-5', 'task-3']);
    expect(result.overflowTasks.map((task) => task.id)).toEqual(['task-4']);
  });

  it('supports fractional story points while keeping packedSP <= capacity', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-2.5', storyPoints: 2.5 }),
      createTask({ id: 'task-1.5', storyPoints: 1.5 }),
      createTask({ id: 'task-1', storyPoints: 1 }),
    ];

    const result = packFocusListTasks({ tasks, capacitySP: 4 });

    expect(result.packedSP).toBe(4);
    expect(result.packedSP).toBeLessThanOrEqual(result.capacitySP);
    expect(result.packedTasks.map((task) => task.id)).toEqual(['task-2.5', 'task-1.5']);
    expect(result.overflowTasks.map((task) => task.id)).toEqual(['task-1']);
  });

  it('treats non-positive or invalid capacity as zero', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-1', storyPoints: 1 }),
      createTask({ id: 'task-2', storyPoints: 2 }),
    ];

    const result = packFocusListTasks({ tasks, capacitySP: Number.NaN });

    expect(result.capacitySP).toBe(0);
    expect(result.packedSP).toBe(0);
    expect(result.packedTasks).toEqual([]);
    expect(result.overflowTasks.map((task) => task.id)).toEqual(['task-1', 'task-2']);
  });

  it('treats invalid story points as overflow', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'valid', storyPoints: 1 }),
      createTask({ id: 'zero', storyPoints: 0 }),
      createTask({ id: 'negative', storyPoints: -1 }),
      createTask({ id: 'nan', storyPoints: Number.NaN }),
      createTask({ id: 'infinity', storyPoints: Number.POSITIVE_INFINITY }),
    ];

    const result = packFocusListTasks({ tasks, capacitySP: 3 });

    expect(result.packedTasks.map((task) => task.id)).toEqual(['valid']);
    expect(result.overflowTasks.map((task) => task.id)).toEqual([
      'zero',
      'negative',
      'nan',
      'infinity',
    ]);
  });

  it('does not mutate the original task array', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-2', storyPoints: 2 }),
      createTask({ id: 'task-1', storyPoints: 1 }),
    ];
    const originalOrder = tasks.map((task) => task.id);

    const result = packFocusListTasks({ tasks, capacitySP: 2 });

    expect(result.packedTasks).not.toBe(tasks);
    expect(result.overflowTasks).not.toBe(tasks);
    expect(tasks.map((task) => task.id)).toEqual(originalOrder);
  });
});
