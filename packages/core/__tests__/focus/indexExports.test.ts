import { describe, expect, it } from 'vitest';
import {
  FocusService,
  focusService,
  packFocusListTasks,
  type FocusListTask,
} from '../../src/focus';

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

describe('focus barrel exports', () => {
  it('exports focusService class and singleton', () => {
    expect(typeof FocusService).toBe('function');
    expect(focusService).toBeInstanceOf(FocusService);
  });

  it('exports packFocusListTasks via the focus index', () => {
    const result = packFocusListTasks({
      tasks: [createTask()],
      capacitySP: 2,
    });

    expect(result.packedTasks.map((task) => task.id)).toEqual(['task-1']);
    expect(result.overflowTasks).toEqual([]);
  });
});
