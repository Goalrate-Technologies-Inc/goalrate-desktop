import { describe, expect, it, vi } from 'vitest';
import type { FocusListTask } from '../../src/focus/listFilter';
import {
  loadTasksFromVaultAdapter,
  type VaultTaskSourceAdapter,
} from '../../src/focus/vaultAdapter';

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

describe('loadTasksFromVaultAdapter', () => {
  it('returns [] and does not call adapter when openVaultIds is empty', async () => {
    const adapter: VaultTaskSourceAdapter = {
      listTasksForUser: vi.fn().mockResolvedValue([
        createTask({ id: 'task-a', vaultId: 'vault-1' }),
      ]),
    };

    const result = await loadTasksFromVaultAdapter({
      adapter,
      userId: 'user-1',
      openVaultIds: [],
    });

    expect(adapter.listTasksForUser).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('filters out tasks from closed vaults', async () => {
    const adapter: VaultTaskSourceAdapter = {
      listTasksForUser: vi.fn().mockResolvedValue([
        createTask({ id: 'open-1', vaultId: 'vault-open' }),
        createTask({ id: 'open-2', vaultId: 'vault-open' }),
        createTask({ id: 'closed-1', vaultId: 'vault-closed' }),
      ]),
    };

    const result = await loadTasksFromVaultAdapter({
      adapter,
      userId: 'user-1',
      openVaultIds: ['vault-open'],
    });

    expect(result.map((task) => task.id)).toEqual(['open-1', 'open-2']);
  });

  it('deduplicates openVaultIds passed to adapter', async () => {
    const adapter: VaultTaskSourceAdapter = {
      listTasksForUser: vi.fn().mockResolvedValue([
        createTask({ id: 'open-1', vaultId: 'vault-1' }),
      ]),
    };

    await loadTasksFromVaultAdapter({
      adapter,
      userId: 'user-1',
      openVaultIds: ['vault-1', 'vault-1', 'vault-2'],
    });

    expect(adapter.listTasksForUser).toHaveBeenCalledWith({
      userId: 'user-1',
      openVaultIds: ['vault-1', 'vault-2'],
    });
  });
});
