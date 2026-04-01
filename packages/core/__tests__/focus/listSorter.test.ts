import { describe, expect, it } from 'vitest';
import type { FocusListTask } from '../../src/focus/listFilter';
import {
  compareFocusListTasks,
  sortFocusListTasks,
} from '../../src/focus/listSorter';

function createTask(overrides: Partial<FocusListTask> = {}): FocusListTask {
  return {
    id: 'task-1',
    vaultId: 'vault-1',
    title: 'Task 1',
    dueAt: null,
    deadlineAt: null,
    priority: 3,
    storyPoints: 2,
    status: 'todo',
    assignedToUserId: 'user-1',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('compareFocusListTasks', () => {
  it('orders by deadlineAt when present, otherwise dueAt', () => {
    const dueOnly = createTask({
      id: 'due-only',
      dueAt: '2026-03-02T10:00:00.000Z',
      deadlineAt: null,
    });
    const deadlineTask = createTask({
      id: 'deadline-task',
      dueAt: '2026-03-10T10:00:00.000Z',
      deadlineAt: '2026-03-03T10:00:00.000Z',
    });

    expect(compareFocusListTasks(dueOnly, deadlineTask)).toBeLessThan(0);
    expect(compareFocusListTasks(deadlineTask, dueOnly)).toBeGreaterThan(0);
  });

  it('prefers deadlineAt over dueAt when both are present', () => {
    const withDeadline = createTask({
      id: 'with-deadline',
      dueAt: '2026-03-01T10:00:00.000Z',
      deadlineAt: '2026-03-05T10:00:00.000Z',
    });
    const dueOnly = createTask({
      id: 'due-only',
      dueAt: '2026-03-02T10:00:00.000Z',
      deadlineAt: null,
    });

    expect(compareFocusListTasks(withDeadline, dueOnly)).toBeGreaterThan(0);
    expect(compareFocusListTasks(dueOnly, withDeadline)).toBeLessThan(0);
  });

  it('orders by priority descending when effective due date ties', () => {
    const higherPriority = createTask({
      id: 'higher-priority',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 4,
    });
    const lowerPriority = createTask({
      id: 'lower-priority',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 1,
    });

    expect(compareFocusListTasks(higherPriority, lowerPriority)).toBeLessThan(0);
    expect(compareFocusListTasks(lowerPriority, higherPriority)).toBeGreaterThan(0);
  });

  it('falls back to dueAt when deadlineAt is invalid', () => {
    const withInvalidDeadline = createTask({
      id: 'with-invalid-deadline',
      dueAt: '2026-03-01T10:00:00.000Z',
      deadlineAt: 'not-a-date',
    });
    const laterDue = createTask({
      id: 'later-due',
      dueAt: '2026-03-02T10:00:00.000Z',
    });

    expect(compareFocusListTasks(withInvalidDeadline, laterDue)).toBeLessThan(0);
  });

  it('orders unscheduled tasks by priority when both have no valid due date', () => {
    const higherPriority = createTask({
      id: 'higher-priority',
      dueAt: null,
      deadlineAt: null,
      priority: 5,
    });
    const lowerPriority = createTask({
      id: 'lower-priority',
      dueAt: null,
      deadlineAt: null,
      priority: 2,
    });

    expect(compareFocusListTasks(higherPriority, lowerPriority)).toBeLessThan(0);
    expect(compareFocusListTasks(lowerPriority, higherPriority)).toBeGreaterThan(0);
  });

  it('uses createdAt then id as deterministic tie-breakers', () => {
    const earlierCreated = createTask({
      id: 'task-b',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const laterCreated = createTask({
      id: 'task-a',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: '2026-03-01T01:00:00.000Z',
    });
    const sameCreatedDifferentId = createTask({
      id: 'task-c',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: '2026-03-01T01:00:00.000Z',
    });

    expect(compareFocusListTasks(earlierCreated, laterCreated)).toBeLessThan(0);
    expect(compareFocusListTasks(laterCreated, sameCreatedDifferentId)).toBeLessThan(0);
  });

  it('falls back to id when createdAt is invalid for both tasks', () => {
    const taskA = createTask({
      id: 'task-a',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: 'not-a-date',
    });
    const taskB = createTask({
      id: 'task-b',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: 'also-not-a-date',
    });

    expect(compareFocusListTasks(taskA, taskB)).toBeLessThan(0);
    expect(compareFocusListTasks(taskB, taskA)).toBeGreaterThan(0);
  });

  it('uses locale-independent code-point ordering for id tie-breakers', () => {
    const zTask = createTask({
      id: 'z-task',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const umlautTask = createTask({
      id: 'ä-task',
      dueAt: '2026-03-03T10:00:00.000Z',
      priority: 2,
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(compareFocusListTasks(zTask, umlautTask)).toBeLessThan(0);
    expect(compareFocusListTasks(umlautTask, zTask)).toBeGreaterThan(0);
  });
});

describe('sortFocusListTasks', () => {
  it('returns a new array and does not mutate input', () => {
    const tasks = [
      createTask({ id: 'b', dueAt: '2026-03-02T00:00:00.000Z' }),
      createTask({ id: 'a', dueAt: '2026-03-01T00:00:00.000Z' }),
    ];
    const originalOrder = tasks.map((task) => task.id);

    const sorted = sortFocusListTasks(tasks);

    expect(sorted).not.toBe(tasks);
    expect(tasks.map((task) => task.id)).toEqual(originalOrder);
    expect(sorted.map((task) => task.id)).toEqual(['a', 'b']);
  });

  it('sorts using due/deadline asc, then priority descending, then tie-breakers', () => {
    const tasks = [
      createTask({
        id: 'no-date',
        dueAt: null,
        deadlineAt: null,
        priority: 1,
      }),
      createTask({
        id: 'same-due-lower-priority',
        dueAt: '2026-03-02T00:00:00.000Z',
        priority: 2,
        createdAt: '2026-03-01T01:00:00.000Z',
      }),
      createTask({
        id: 'same-due-higher-priority',
        dueAt: '2026-03-02T00:00:00.000Z',
        priority: 4,
        createdAt: '2026-03-01T05:00:00.000Z',
      }),
      createTask({
        id: 'deadline-first',
        dueAt: '2026-03-09T00:00:00.000Z',
        deadlineAt: '2026-03-01T00:00:00.000Z',
        priority: 5,
      }),
      createTask({
        id: 'same-due-higher-priority-earlier-created',
        dueAt: '2026-03-02T00:00:00.000Z',
        priority: 4,
        createdAt: '2026-03-01T00:00:00.000Z',
      }),
    ];

    const sorted = sortFocusListTasks(tasks);

    expect(sorted.map((task) => task.id)).toEqual([
      'deadline-first',
      'same-due-higher-priority-earlier-created',
      'same-due-higher-priority',
      'same-due-lower-priority',
      'no-date',
    ]);
  });

  it('keeps input order when all deterministic keys are equal', () => {
    const first = createTask({
      id: 'same-id',
      dueAt: '2026-03-02T00:00:00.000Z',
      priority: 3,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const second = createTask({
      id: 'same-id',
      dueAt: '2026-03-02T00:00:00.000Z',
      priority: 3,
      createdAt: '2026-03-01T00:00:00.000Z',
      title: 'Task 2',
    });

    const sorted = sortFocusListTasks([first, second]);

    expect(sorted[0]?.title).toBe('Task 1');
    expect(sorted[1]?.title).toBe('Task 2');
  });

  it('treats invalid dates as unscheduled and pushes them behind valid due dates', () => {
    const validDue = createTask({
      id: 'valid',
      dueAt: '2026-03-02T00:00:00.000Z',
    });
    const invalidDue = createTask({
      id: 'invalid',
      dueAt: 'not-a-date',
    });

    const sorted = sortFocusListTasks([invalidDue, validDue]);

    expect(sorted.map((task) => task.id)).toEqual(['valid', 'invalid']);
  });

  it('orders unscheduled tasks by priority and deterministic tie-breakers', () => {
    const tasks = [
      createTask({
        id: 'lowest-priority',
        dueAt: null,
        deadlineAt: null,
        priority: 1,
      }),
      createTask({
        id: 'highest-priority-later-created',
        dueAt: null,
        deadlineAt: null,
        priority: 5,
        createdAt: '2026-03-01T02:00:00.000Z',
      }),
      createTask({
        id: 'highest-priority-earlier-created',
        dueAt: null,
        deadlineAt: null,
        priority: 5,
        createdAt: '2026-03-01T01:00:00.000Z',
      }),
    ];

    const sorted = sortFocusListTasks(tasks);

    expect(sorted.map((task) => task.id)).toEqual([
      'highest-priority-earlier-created',
      'highest-priority-later-created',
      'lowest-priority',
    ]);
  });
});
