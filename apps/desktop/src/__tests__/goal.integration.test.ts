/**
 * Goal Integration Tests
 * Tests goal operations against the real Tauri backend
 *
 * Prerequisites:
 * - The desktop app must be running: pnpm run dev:desktop
 *
 * Run with: pnpm run test:integration
 */

import { it, expect, beforeAll, afterAll } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { VaultConfig, SmartGoal, GoalTask } from '@goalrate-app/shared';
import { describeTauriIntegration as describe } from '../test/tauriIntegration';

// Test vault configuration
const TEST_VAULT_PATH = '/tmp/goalrate-integration-test-goals';
const TEST_VAULT_NAME = 'Goal Integration Test Vault';

describe('Goal Operations (Integration)', () => {
  let vaultId: string;

  // Create test vault before all tests
  beforeAll(async () => {
    try {
      // Clean up any existing test vault
      const vaults = await invoke<Array<{ id: string; path: string }>>('list_vaults');
      const existing = vaults.find((v) => v.path === TEST_VAULT_PATH);
      if (existing) {
        await invoke('delete_vault', { vaultId: existing.id });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Create test vault
    const config = await invoke<VaultConfig>('create_vault', {
      data: {
        name: TEST_VAULT_NAME,
        path: TEST_VAULT_PATH,
        type: 'private',
      },
    });
    vaultId = config.id;
    console.log(`  Created test vault: ${vaultId}`);
  });

  // Clean up test vault after all tests
  afterAll(async () => {
    if (vaultId) {
      try {
        await invoke('delete_vault', { vaultId });
        console.log(`  Deleted test vault: ${vaultId}`);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('goal CRUD operations', () => {
    let createdGoalId: string;

    it('should create a goal in the vault', async () => {
      const goal = await invoke<SmartGoal>('create_goal', {
        vaultId,
        data: {
          title: 'Test Goal',
          specific: 'A specific goal for integration testing',
          measurable: { unit: 'tests passed' },
          achievable: 80,
          relevant: ['testing', 'quality'],
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          priority: 'high',
        },
      });

      createdGoalId = goal.id;

      expect(goal.title).toBe('Test Goal');
      expect(goal.specific).toBe('A specific goal for integration testing');
      expect(goal.priority).toBe('high');
      expect(goal.id).toMatch(/^goal_/);
    });

    it('should list goals and find the created goal', async () => {
      const goals = await invoke<SmartGoal[]>('list_goals', { vaultId });

      expect(Array.isArray(goals)).toBe(true);
      expect(goals.length).toBeGreaterThanOrEqual(1);

      const found = goals.find((g) => g.id === createdGoalId);
      expect(found).toBeDefined();
      expect(found?.title).toBe('Test Goal');
    });

    it('should get a specific goal by ID', async () => {
      const goal = await invoke<SmartGoal>('get_goal', {
        vaultId,
        goalId: createdGoalId,
      });

      expect(goal.id).toBe(createdGoalId);
      expect(goal.title).toBe('Test Goal');
    });

    it('should update a goal', async () => {
      const updated = await invoke<SmartGoal>('update_goal', {
        vaultId,
        goalId: createdGoalId,
        data: {
          title: 'Updated Test Goal',
          priority: 'medium',
        },
      });

      expect(updated.title).toBe('Updated Test Goal');
      expect(updated.priority).toBe('medium');
    });

    it('should archive a goal', async () => {
      const archived = await invoke<SmartGoal>('archive_goal', {
        vaultId,
        goalId: createdGoalId,
      });

      expect(archived.status).toBe('archived');
    });

    it('should delete a goal', async () => {
      // Create a new goal to delete
      const goal = await invoke<SmartGoal>('create_goal', {
        vaultId,
        data: {
          title: 'Goal to Delete',
          specific: 'This goal will be deleted',
          measurable: { unit: 'tests' },
          achievable: 50,
          relevant: [],
          deadline: new Date().toISOString(),
          priority: 'low',
        },
      });

      // Delete it
      await invoke('delete_goal', { vaultId, goalId: goal.id, confirmed: true });

      // Verify it's gone
      const goals = await invoke<SmartGoal[]>('list_goals', { vaultId });
      const found = goals.find((g) => g.id === goal.id);
      expect(found).toBeUndefined();
    });
  });

  describe('goal task operations', () => {
    let goalId: string;
    let taskId: string;

    beforeAll(async () => {
      // Create a goal for task tests
      const goal = await invoke<SmartGoal>('create_goal', {
        vaultId,
        data: {
          title: 'Task Test Goal',
          specific: 'Goal for testing tasks',
          measurable: { unit: 'tasks' },
          achievable: 90,
          relevant: ['testing'],
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          priority: 'high',
        },
      });
      goalId = goal.id;
    });

    it('should create a task in the goal', async () => {
      const task = await invoke<GoalTask>('create_goal_task', {
        vaultId,
        goalId,
        data: {
          title: 'Test Task',
        },
      });

      taskId = task.id;

      expect(task.title).toBe('Test Task');
      expect(task.column).toBe('backlog');
    });

    it('should list tasks and find the created task', async () => {
      const tasks = await invoke<GoalTask[]>('list_goal_tasks', {
        vaultId,
        goalId,
      });

      expect(Array.isArray(tasks)).toBe(true);
      expect(tasks.length).toBeGreaterThanOrEqual(1);

      const found = tasks.find((t) => t.id === taskId);
      expect(found).toBeDefined();
      expect(found?.title).toBe('Test Task');
    });

    it('should move a task to completed', async () => {
      const moved = await invoke<GoalTask>('move_goal_task', {
        vaultId,
        goalId,
        taskId,
        toColumn: 'done',
      });

      expect(moved.column).toBe('done');
    });

    it('should complete a task', async () => {
      const completed = await invoke<GoalTask>('complete_goal_task', {
        vaultId,
        goalId,
        taskId,
        completedBy: null,
      });

      expect(completed.column).toBe('done');
    });

    it('should update a task', async () => {
      const updated = await invoke<GoalTask>('update_goal_task', {
        vaultId,
        goalId,
        taskId,
        data: {
          title: 'Updated Task Title',
        },
      });

      expect(updated.title).toBe('Updated Task Title');
    });

    it('should delete a task', async () => {
      // Create a task to delete
      const task = await invoke<GoalTask>('create_goal_task', {
        vaultId,
        goalId,
        data: {
          title: 'Task to Delete',
        },
      });

      // Delete it
      await invoke('delete_goal_task', {
        vaultId,
        goalId,
        taskId: task.id,
        confirmed: true,
      });

      // Verify it's gone
      const tasks = await invoke<GoalTask[]>('list_goal_tasks', {
        vaultId,
        goalId,
      });
      const found = tasks.find((t) => t.id === task.id);
      expect(found).toBeUndefined();
    });
  });
});
