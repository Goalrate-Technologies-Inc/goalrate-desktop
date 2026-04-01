/**
 * Desktop Storage Adapter Tests
 * Tests Tauri command invocation and error handling
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { DesktopStorageAdapter } from '../../../src/adapters/desktop/DesktopStorageAdapter';

// Mock the Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Import after mocking
import { invoke } from '@tauri-apps/api/core';

const mockInvoke = invoke as Mock;

describe('DesktopStorageAdapter', () => {
  let adapter: DesktopStorageAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new DesktopStorageAdapter();
  });

  // ==========================================================================
  // Lifecycle Tests
  // ==========================================================================

  describe('lifecycle', () => {
    it('should initialize successfully', async () => {
      const result = await adapter.initialize();
      expect(result.success).toBe(true);
    });

    it('should dispose without error', async () => {
      await expect(adapter.dispose()).resolves.not.toThrow();
    });

    it('should report supportsSync as false', () => {
      expect(adapter.supportsSync()).toBe(false);
    });
  });

  // ==========================================================================
  // Vault Operations Tests
  // ==========================================================================

  describe('vault operations', () => {
    describe('listVaults', () => {
      it('should invoke list_vaults command', async () => {
        const mockVaults = [
          { id: 'vault_1', name: 'Test Vault', path: '/tmp/test', type: 'private' },
        ];
        mockInvoke.mockResolvedValue(mockVaults);

        const result = await adapter.listVaults();

        expect(mockInvoke).toHaveBeenCalledWith('list_vaults', undefined);
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockVaults);
      });

      it('should wrap error on failure', async () => {
        mockInvoke.mockRejectedValue({ code: 'IO_ERROR', message: 'Failed to read vaults' });

        const result = await adapter.listVaults();

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('IO_ERROR');
        expect(result.error?.message).toBe('Failed to read vaults');
      });
    });

    describe('openVault', () => {
      it('should invoke open_vault with path', async () => {
        const mockConfig = {
          id: 'vault_1',
          name: 'Test',
          path: '/tmp/test',
          type: 'private',
          created: '2024-01-01',
        };
        mockInvoke.mockResolvedValue(mockConfig);

        const result = await adapter.openVault('/tmp/test');

        expect(mockInvoke).toHaveBeenCalledWith('open_vault', { path: '/tmp/test' });
        expect(result.success).toBe(true);
      });

      it('should convert VaultConfig to Vault with empty arrays', async () => {
        const mockConfig = {
          id: 'vault_1',
          name: 'Test',
          path: '/tmp/test',
          type: 'private',
          created: '2024-01-01',
        };
        mockInvoke.mockResolvedValue(mockConfig);

        const result = await adapter.openVault('/tmp/test');

        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          ...mockConfig,
          goals: [],
          projects: [],
          focusDays: [],
        });
      });

      it('should wrap error on failure', async () => {
        mockInvoke.mockRejectedValue({ code: 'ITEM_NOT_FOUND', message: 'Vault not found' });

        const result = await adapter.openVault('/nonexistent');

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('ITEM_NOT_FOUND');
      });
    });

    describe('createVault', () => {
      it('should invoke create_vault with data', async () => {
        const createData = { name: 'New Vault', path: '/tmp/new', type: 'private' as const };
        const mockConfig = { id: 'vault_new', ...createData, created: '2024-01-01' };
        mockInvoke.mockResolvedValue(mockConfig);

        const result = await adapter.createVault(createData);

        expect(mockInvoke).toHaveBeenCalledWith('create_vault', { data: createData });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockConfig);
      });
    });

    describe('closeVault', () => {
      it('should invoke close_vault with vaultId', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const result = await adapter.closeVault('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('close_vault', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteVault', () => {
      it('should invoke delete_vault with vaultId', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const result = await adapter.deleteVault('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('delete_vault', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
      });
    });

    describe('getVaultStats', () => {
      it('should invoke get_vault_stats with vaultId', async () => {
        const mockStats = { totalGoals: 5, activeGoals: 3 };
        mockInvoke.mockResolvedValue(mockStats);

        const result = await adapter.getVaultStats('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('get_vault_stats', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockStats);
      });
    });
  });

  // ==========================================================================
  // Goal Operations Tests
  // ==========================================================================

  describe('goal operations', () => {
    describe('getGoals', () => {
      it('should invoke list_goals with vaultId', async () => {
        const mockGoals = [{ id: 'goal_1', title: 'Test Goal' }];
        mockInvoke.mockResolvedValue(mockGoals);

        const result = await adapter.getGoals('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('list_goals', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockGoals);
      });
    });

    describe('getGoal', () => {
      it('should invoke get_goal with vaultId and goalId', async () => {
        const mockGoal = { id: 'goal_1', title: 'Test Goal' };
        mockInvoke.mockResolvedValue(mockGoal);

        const result = await adapter.getGoal('vault_1', 'goal_1');

        expect(mockInvoke).toHaveBeenCalledWith('get_goal', { vaultId: 'vault_1', goalId: 'goal_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockGoal);
      });
    });

    describe('createGoal', () => {
      it('should invoke create_goal with vaultId and data', async () => {
        const createData = { title: 'New Goal' };
        const mockGoal = { id: 'goal_new', ...createData };
        mockInvoke.mockResolvedValue(mockGoal);

        const result = await adapter.createGoal('vault_1', createData);

        expect(mockInvoke).toHaveBeenCalledWith('create_goal', { vaultId: 'vault_1', data: createData });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockGoal);
      });
    });

    describe('updateGoal', () => {
      it('should invoke update_goal with all params', async () => {
        const updateData = { title: 'Updated Goal' };
        const mockGoal = { id: 'goal_1', ...updateData };
        mockInvoke.mockResolvedValue(mockGoal);

        const result = await adapter.updateGoal('vault_1', 'goal_1', updateData);

        expect(mockInvoke).toHaveBeenCalledWith('update_goal', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          data: updateData,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteGoal', () => {
      it('should invoke delete_goal with vaultId and goalId', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const result = await adapter.deleteGoal('vault_1', 'goal_1');

        expect(mockInvoke).toHaveBeenCalledWith('delete_goal', { vaultId: 'vault_1', goalId: 'goal_1' });
        expect(result.success).toBe(true);
      });
    });

    describe('archiveGoal', () => {
      it('should invoke archive_goal command', async () => {
        const mockGoal = { id: 'goal_1', status: 'archived' };
        mockInvoke.mockResolvedValue(mockGoal);

        const result = await adapter.archiveGoal('vault_1', 'goal_1');

        expect(mockInvoke).toHaveBeenCalledWith('archive_goal', { vaultId: 'vault_1', goalId: 'goal_1' });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Goal Task Operations Tests
  // ==========================================================================

  describe('goal task operations', () => {
    describe('getGoalTasks', () => {
      it('should invoke list_goal_tasks', async () => {
        const mockTasks = [{ id: 'task_1', title: 'Test Task' }];
        mockInvoke.mockResolvedValue(mockTasks);

        const result = await adapter.getGoalTasks('vault_1', 'goal_1');

        expect(mockInvoke).toHaveBeenCalledWith('list_goal_tasks', { vaultId: 'vault_1', goalId: 'goal_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockTasks);
      });
    });

    describe('getGoalTask', () => {
      it('should invoke get_goal_task', async () => {
        const mockTask = { id: 'task_1', title: 'Test Task' };
        mockInvoke.mockResolvedValue(mockTask);

        const result = await adapter.getGoalTask('vault_1', 'goal_1', 'task_1');

        expect(mockInvoke).toHaveBeenCalledWith('get_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          taskId: 'task_1',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('createGoalTask', () => {
      it('should invoke create_goal_task', async () => {
        const taskData = { title: 'New Task', column: 'backlog', points: 2, priority: 'medium' as const, subtasks: [] };
        const mockTask = { id: 'task_new', ...taskData };
        mockInvoke.mockResolvedValue(mockTask);

        const result = await adapter.createGoalTask('vault_1', 'goal_1', taskData);

        expect(mockInvoke).toHaveBeenCalledWith('create_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          data: taskData,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('updateGoalTask', () => {
      it('should invoke update_goal_task', async () => {
        const updateData = { title: 'Updated Task' };
        mockInvoke.mockResolvedValue({ id: 'task_1', ...updateData });

        const result = await adapter.updateGoalTask('vault_1', 'goal_1', 'task_1', updateData);

        expect(mockInvoke).toHaveBeenCalledWith('update_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          taskId: 'task_1',
          data: updateData,
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deleteGoalTask', () => {
      it('should invoke delete_goal_task', async () => {
        mockInvoke.mockResolvedValue(undefined);

        const result = await adapter.deleteGoalTask('vault_1', 'goal_1', 'task_1');

        expect(mockInvoke).toHaveBeenCalledWith('delete_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          taskId: 'task_1',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('moveGoalTask', () => {
      it('should invoke move_goal_task with toColumn', async () => {
        const mockTask = { id: 'task_1', column: 'doing' };
        mockInvoke.mockResolvedValue(mockTask);

        const result = await adapter.moveGoalTask('vault_1', 'goal_1', 'task_1', 'doing');

        expect(mockInvoke).toHaveBeenCalledWith('move_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          taskId: 'task_1',
          toColumn: 'doing',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('completeGoalTask', () => {
      it('should invoke complete_goal_task', async () => {
        const mockTask = { id: 'task_1', column: 'done' };
        mockInvoke.mockResolvedValue(mockTask);

        const result = await adapter.completeGoalTask('vault_1', 'goal_1', 'task_1');

        expect(mockInvoke).toHaveBeenCalledWith('complete_goal_task', {
          vaultId: 'vault_1',
          goalId: 'goal_1',
          taskId: 'task_1',
          completedBy: null,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Focus Operations Tests
  // ==========================================================================

  describe('focus operations', () => {
    describe('getFocusDay', () => {
      it('should invoke get_focus_day with vaultId and date', async () => {
        const mockFocusDay = { id: 'focus_2024-01-01', date: '2024-01-01', items: [] };
        mockInvoke.mockResolvedValue(mockFocusDay);

        const result = await adapter.getFocusDay('vault_1', '2024-01-01');

        expect(mockInvoke).toHaveBeenCalledWith('get_focus_day', { vaultId: 'vault_1', date: '2024-01-01' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockFocusDay);
      });

      it('should handle null response', async () => {
        mockInvoke.mockResolvedValue(null);

        const result = await adapter.getFocusDay('vault_1', '2024-01-01');

        expect(result.success).toBe(true);
        expect(result.data).toBeNull();
      });
    });

    describe('saveFocusDay', () => {
      it('should invoke save_focus_day with focusDay', async () => {
        const focusDay = { id: 'focus_2024-01-01', date: '2024-01-01', items: [], plannedPoints: 0, completedPoints: 0, completedItems: 0, availableHours: 8, pointCapacity: 10 };
        mockInvoke.mockResolvedValue(focusDay);

        const result = await adapter.saveFocusDay('vault_1', focusDay);

        expect(mockInvoke).toHaveBeenCalledWith('save_focus_day', { vaultId: 'vault_1', focusDay });
        expect(result.success).toBe(true);
      });
    });

    describe('completeFocusItem', () => {
      it('should invoke complete_focus_item', async () => {
        const mockFocusDay = { id: 'focus_2024-01-01', items: [] };
        mockInvoke.mockResolvedValue(mockFocusDay);

        const result = await adapter.completeFocusItem('vault_1', '2024-01-01', 'task_1');

        expect(mockInvoke).toHaveBeenCalledWith('complete_focus_item', {
          vaultId: 'vault_1',
          date: '2024-01-01',
          itemSource: 'task_1',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('deferFocusItem', () => {
      it('should invoke defer_focus_item', async () => {
        const mockFocusDay = { id: 'focus_2024-01-01', items: [] };
        mockInvoke.mockResolvedValue(mockFocusDay);

        const result = await adapter.deferFocusItem('vault_1', '2024-01-01', 'task_1', '2024-01-02');

        expect(mockInvoke).toHaveBeenCalledWith('defer_focus_item', {
          vaultId: 'vault_1',
          date: '2024-01-01',
          itemSource: 'task_1',
          deferTo: '2024-01-02',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('gatherFocusCandidates', () => {
      it('should invoke gather_focus_candidates', async () => {
        const mockCandidates = [{ id: 'candidate_1', title: 'Task 1' }];
        mockInvoke.mockResolvedValue(mockCandidates);

        const result = await adapter.gatherFocusCandidates('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('gather_focus_candidates', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockCandidates);
      });
    });

    describe('getFocusVelocity', () => {
      it('should invoke get_focus_velocity', async () => {
        const mockVelocity = { averagePointsPerDay: 8, currentStreak: 5 };
        mockInvoke.mockResolvedValue(mockVelocity);

        const result = await adapter.getFocusVelocity('vault_1');

        expect(mockInvoke).toHaveBeenCalledWith('get_focus_velocity', { vaultId: 'vault_1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockVelocity);
      });
    });
  });

  // ==========================================================================
  // Not Implemented Operations Tests
  // ==========================================================================

  describe('not implemented operations', () => {
    it('should return NOT_IMPLEMENTED error for getProjects', async () => {
      const result = await adapter.getProjects('vault_1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return NOT_IMPLEMENTED error for createProject', async () => {
      const result = await adapter.createProject('vault_1', { title: 'Test' } as any);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return NOT_IMPLEMENTED error for updateVault', async () => {
      const result = await adapter.updateVault('vault_1', { name: 'New Name' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return NOT_IMPLEMENTED error for search', async () => {
      const result = await adapter.search('vault_1', 'query');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return NOT_IMPLEMENTED error for syncVault', async () => {
      const result = await adapter.syncVault('vault_1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('should return NOT_IMPLEMENTED error for getFocusHistory', async () => {
      const result = await adapter.getFocusHistory('vault_1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_IMPLEMENTED');
    });
  });

  // ==========================================================================
  // Error Mapping Tests
  // ==========================================================================

  describe('error mapping', () => {
    it('should map Tauri error with code to StorageError', async () => {
      mockInvoke.mockRejectedValue({ code: 'VALIDATION_ERROR', message: 'Invalid data' });

      const result = await adapter.listVaults();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toBe('Invalid data');
    });

    it('should map Tauri error with only message to StorageError', async () => {
      mockInvoke.mockRejectedValue({ message: 'Something went wrong' });

      const result = await adapter.listVaults();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('Something went wrong');
    });

    it('should map unknown error to UNKNOWN_ERROR', async () => {
      mockInvoke.mockRejectedValue('String error');

      const result = await adapter.listVaults();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('String error');
    });

    it('should handle null error object', async () => {
      mockInvoke.mockRejectedValue(null);

      const result = await adapter.listVaults();

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
    });
  });
});
