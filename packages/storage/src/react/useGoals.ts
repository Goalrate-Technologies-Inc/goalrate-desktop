/**
 * Goals Operations Hook
 * Provides CRUD operations for goals and goal tasks
 */

import { useCallback, useState, useEffect } from 'react';
import type {
  SmartGoal,
  GoalCreate,
  GoalUpdate,
  GoalTask,
} from '@goalrate-app/shared';

/** Type for creating a goal task */
export type GoalTaskCreate = Omit<GoalTask, 'id'>;
/** Type for updating a goal task */
export type GoalTaskUpdate = Partial<GoalTask>;
import type { StorageResult, GoalQueryOptions } from '../interface';
import { useStorageContext, useCurrentVault } from './StorageProvider';

// ============================================================================
// TYPES
// ============================================================================

export interface UseGoalsReturn {
  /** List of goals */
  goals: SmartGoal[];
  /** Whether goals are loading */
  loading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Fetch goals with optional filters */
  fetchGoals: (options?: GoalQueryOptions) => Promise<void>;
  /** Get a single goal by ID */
  getGoal: (id: string) => Promise<StorageResult<SmartGoal>>;
  /** Create a new goal */
  createGoal: (data: GoalCreate) => Promise<StorageResult<SmartGoal>>;
  /** Update an existing goal */
  updateGoal: (id: string, data: GoalUpdate) => Promise<StorageResult<SmartGoal>>;
  /** Delete a goal */
  deleteGoal: (id: string) => Promise<StorageResult<void>>;
  /** Archive a goal */
  archiveGoal: (id: string) => Promise<StorageResult<SmartGoal>>;
  /** Clear error state */
  clearError: () => void;
}

export interface UseGoalTasksReturn {
  /** List of tasks for the current goal */
  tasks: GoalTask[];
  /** Whether tasks are loading */
  loading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Fetch tasks for a goal */
  fetchTasks: (goalId: string) => Promise<void>;
  /** Create a new task */
  createTask: (goalId: string, data: GoalTaskCreate) => Promise<StorageResult<GoalTask>>;
  /** Update a task */
  updateTask: (goalId: string, taskId: string, data: GoalTaskUpdate) => Promise<StorageResult<GoalTask>>;
  /** Move a task to a different column */
  moveTask: (goalId: string, taskId: string, targetColumn: string, position?: number) => Promise<StorageResult<GoalTask>>;
  /** Complete a task */
  completeTask: (goalId: string, taskId: string) => Promise<StorageResult<GoalTask>>;
  /** Delete a task */
  deleteTask: (goalId: string, taskId: string) => Promise<StorageResult<void>>;
  /** Clear error state */
  clearError: () => void;
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook for goal operations
 * Automatically fetches goals when vault changes
 */
export function useGoals(options?: GoalQueryOptions): UseGoalsReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [goals, setGoals] = useState<SmartGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchGoals = useCallback(
    async (queryOptions?: GoalQueryOptions) => {
      if (!vault) {
        setGoals([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getGoals(vault.id, queryOptions);

      if (result.success) {
        setGoals(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to fetch goals');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  // Auto-fetch on vault change
  useEffect(() => {
    if (vault && context.initialized) {
      fetchGoals(options);
    }
  }, [vault?.id, context.initialized, fetchGoals, options]);

  const getGoal = useCallback(
    async (id: string): Promise<StorageResult<SmartGoal>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }
      return context.adapter.getGoal(vault.id, id);
    },
    [context.adapter, vault]
  );

  const createGoal = useCallback(
    async (data: GoalCreate): Promise<StorageResult<SmartGoal>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.createGoal(vault.id, data);

      if (result.success && result.data) {
        setGoals((prev) => [...prev, result.data!]);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateGoal = useCallback(
    async (id: string, data: GoalUpdate): Promise<StorageResult<SmartGoal>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateGoal(vault.id, id, data);

      if (result.success && result.data) {
        setGoals((prev) => prev.map((g) => (g.id === id ? result.data! : g)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deleteGoal = useCallback(
    async (id: string): Promise<StorageResult<void>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deleteGoal(vault.id, id);

      if (result.success) {
        setGoals((prev) => prev.filter((g) => g.id !== id));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const archiveGoal = useCallback(
    async (id: string): Promise<StorageResult<SmartGoal>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.archiveGoal(vault.id, id);

      if (result.success && result.data) {
        setGoals((prev) => prev.map((g) => (g.id === id ? result.data! : g)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    goals,
    loading,
    error,
    fetchGoals,
    getGoal,
    createGoal,
    updateGoal,
    deleteGoal,
    archiveGoal,
    clearError,
  };
}

/**
 * Hook for goal task operations
 */
export function useGoalTasks(goalId?: string): UseGoalTasksReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [tasks, setTasks] = useState<GoalTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(
    async (gId: string) => {
      if (!vault) {
        setTasks([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getGoalTasks(vault.id, gId);

      if (result.success) {
        setTasks(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to fetch tasks');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  // Auto-fetch when goalId changes
  useEffect(() => {
    if (goalId && vault && context.initialized) {
      fetchTasks(goalId);
    }
  }, [goalId, vault?.id, context.initialized, fetchTasks]);

  const createTask = useCallback(
    async (gId: string, data: GoalTaskCreate): Promise<StorageResult<GoalTask>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.createGoalTask(vault.id, gId, data);

      if (result.success && result.data) {
        setTasks((prev) => [...prev, result.data!]);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateTask = useCallback(
    async (gId: string, taskId: string, data: GoalTaskUpdate): Promise<StorageResult<GoalTask>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateGoalTask(vault.id, gId, taskId, data);

      if (result.success && result.data) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? result.data! : t)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const moveTask = useCallback(
    async (gId: string, taskId: string, targetColumn: string, position?: number): Promise<StorageResult<GoalTask>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.moveGoalTask(vault.id, gId, taskId, targetColumn, position);

      if (result.success) {
        // Refetch to get updated order for all tasks
        await fetchTasks(gId);
      }

      return result;
    },
    [context.adapter, vault, fetchTasks]
  );

  const completeTask = useCallback(
    async (gId: string, taskId: string): Promise<StorageResult<GoalTask>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.completeGoalTask(vault.id, gId, taskId);

      if (result.success && result.data) {
        setTasks((prev) => prev.map((t) => (t.id === taskId ? result.data! : t)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deleteTask = useCallback(
    async (gId: string, taskId: string): Promise<StorageResult<void>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deleteGoalTask(vault.id, gId, taskId);

      if (result.success) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    tasks,
    loading,
    error,
    fetchTasks,
    createTask,
    updateTask,
    moveTask,
    completeTask,
    deleteTask,
    clearError,
  };
}
