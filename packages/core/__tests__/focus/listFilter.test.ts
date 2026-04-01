import { describe, expect, it } from 'vitest';
import {
  filterFocusListTasks,
  type FocusListTask,
} from '../../src/focus/listFilter';

function createTask(overrides: Partial<FocusListTask> = {}): FocusListTask {
  return {
    id: 'task-1',
    vaultId: 'vault-1',
    title: 'Task 1',
    dueAt: null,
    deadlineAt: null,
    priority: 3,
    storyPoints: 3,
    status: 'todo',
    assignedToUserId: 'user-1',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterFocusListTasks', () => {
  it('returns tasks assigned to the user with eligible statuses and story points', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'eligible-todo', status: 'todo' }),
      createTask({ id: 'eligible-in-progress', status: 'in_progress' }),
      createTask({ id: 'done-task', status: 'done' }),
      createTask({ id: 'blocked-task', status: 'blocked' }),
      createTask({ id: 'other-user', assignedToUserId: 'user-2' }),
      createTask({ id: 'no-points', storyPoints: 0 }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-1'],
    });

    expect(result.map((task) => task.id)).toEqual([
      'eligible-todo',
      'eligible-in-progress',
    ]);
  });

  it('drops tasks with invalid story points', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'valid', storyPoints: 0.5 }),
      createTask({ id: 'negative', storyPoints: -1 }),
      createTask({ id: 'not-finite', storyPoints: Number.POSITIVE_INFINITY }),
      createTask({ id: 'nan-points', storyPoints: Number.NaN }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-1'],
    });

    expect(result.map((task) => task.id)).toEqual(['valid']);
  });

  it('restricts results to open vault ids when provided', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'open-vault-task', vaultId: 'vault-open' }),
      createTask({ id: 'closed-vault-task', vaultId: 'vault-closed' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-open'],
    });

    expect(result.map((task) => task.id)).toEqual(['open-vault-task']);
  });

  it('returns no tasks when open vault ids is explicitly empty', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-1', vaultId: 'vault-1' }),
      createTask({ id: 'task-2', vaultId: 'vault-2' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: [],
    });

    expect(result).toEqual([]);
  });

  it('returns no tasks when open vault ids are unavailable', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'task-1', vaultId: 'vault-1' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
    });

    expect(result).toEqual([]);
  });

  it('supports overriding eligible statuses', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'todo-task', status: 'todo' }),
      createTask({ id: 'in-progress-task', status: 'in_progress' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      eligibleStatuses: ['in_progress'],
    });

    expect(result.map((task) => task.id)).toEqual(['in-progress-task']);
  });

  it('always excludes blocked tasks even when explicitly listed as eligible', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'blocked-task', status: 'blocked' }),
      createTask({ id: 'todo-task', status: 'todo' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      eligibleStatuses: ['todo', 'blocked'],
    });

    expect(result.map((task) => task.id)).toEqual(['todo-task']);
  });

  it('always excludes done tasks even when explicitly listed as eligible', () => {
    const tasks: FocusListTask[] = [
      createTask({ id: 'done-task', status: 'done' }),
      createTask({ id: 'todo-task', status: 'todo' }),
    ];

    const result = filterFocusListTasks({
      tasks,
      userId: 'user-1',
      openVaultIds: ['vault-1'],
      eligibleStatuses: ['todo', 'done'],
    });

    expect(result.map((task) => task.id)).toEqual(['todo-task']);
  });
});
