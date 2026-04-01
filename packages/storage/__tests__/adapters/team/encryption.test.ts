/**
 * Encryption Helper Tests
 * Tests for field-level encryption/decryption utilities
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateKey } from '@goalrate-app/crypto';
import type { SmartGoal, GoalTask, Project, Epic, Sprint, FocusDay } from '@goalrate-app/shared';
import {
  encryptValue,
  decryptValue,
  encryptArray,
  decryptArray,
  encryptGoal,
  decryptGoal,
  encryptGoalTask,
  decryptGoalTask,
  encryptProject,
  decryptProject,
  encryptEpic,
  decryptEpic,
  encryptSprint,
  decryptSprint,
  encryptFocusDay,
  decryptFocusDay,
} from '../../../src/adapters/team/encryption';
import type { EncryptedString } from '../../../src/adapters/team/types';

describe('Team Storage Encryption Helpers', () => {
  let key: CryptoKey;

  beforeEach(async () => {
    key = await generateKey();
  });

  describe('Basic encryption utilities', () => {
    it('should encrypt and decrypt a string value', async () => {
      const original = 'Hello, World!';
      const encrypted = await encryptValue(original, key);
      const decrypted = await decryptValue(encrypted, key);

      expect(decrypted).toBe(original);
      expect(encrypted).not.toBe(original);
      expect(encrypted).toContain('.'); // Format: nonce.ciphertext
    });

    it('should encrypt and decrypt an array of strings', async () => {
      const original = ['one', 'two', 'three'];
      const encrypted = await encryptArray(original, key);
      const decrypted = await decryptArray(encrypted, key);

      expect(decrypted).toEqual(original);
      expect(encrypted.length).toBe(original.length);
      expect(encrypted[0]).not.toBe(original[0]);
    });

    it('should handle empty strings', async () => {
      const original = '';
      const encrypted = await encryptValue(original, key);
      const decrypted = await decryptValue(encrypted, key);

      expect(decrypted).toBe(original);
    });

    it('should handle empty arrays', async () => {
      const original: string[] = [];
      const encrypted = await encryptArray(original, key);
      const decrypted = await decryptArray(encrypted, key);

      expect(decrypted).toEqual(original);
    });

    it('should handle unicode and emoji content', async () => {
      const original = 'Hello 世界 🎉 مرحبا';
      const encrypted = await encryptValue(original, key);
      const decrypted = await decryptValue(encrypted, key);

      expect(decrypted).toBe(original);
    });

    it('should handle long strings', async () => {
      const original = 'a'.repeat(10000);
      const encrypted = await encryptValue(original, key);
      const decrypted = await decryptValue(encrypted, key);

      expect(decrypted).toBe(original);
    });
  });

  describe('Goal encryption', () => {
    const sampleGoal: SmartGoal = {
      id: 'goal_123',
      title: 'Learn TypeScript',
      status: 'active',
      specific: 'Complete the TypeScript handbook and build a project',
      measurable: { unit: 'chapters completed' },
      achievable: 85,
      relevant: ['career', 'skills', 'programming'],
      deadline: '2024-12-31',
      columns: [
        { id: 'backlog', name: 'To Do' },
        { id: 'doing', name: 'In Progress' },
        { id: 'done', name: 'Done' },
      ],
      priority: 'high',
      tags: ['learning', 'typescript', 'frontend'],
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-15T00:00:00Z',
    };

    it('should encrypt and decrypt a goal', async () => {
      const encrypted = await encryptGoal(sampleGoal, key);
      const decrypted = await decryptGoal(encrypted, key);

      expect(decrypted).toEqual(sampleGoal);
    });

    it('should encrypt sensitive fields', async () => {
      const encrypted = await encryptGoal(sampleGoal, key);

      // Sensitive fields should be encrypted
      expect(encrypted.title).not.toBe(sampleGoal.title);
      expect(encrypted.specific).not.toBe(sampleGoal.specific);
      expect(encrypted.measurable.unit).not.toBe(sampleGoal.measurable.unit);
      expect(encrypted.relevant[0]).not.toBe(sampleGoal.relevant[0]);
      expect(encrypted.tags[0]).not.toBe(sampleGoal.tags[0]);

      // Non-sensitive fields should be preserved
      expect(encrypted.id).toBe(sampleGoal.id);
      expect(encrypted.status).toBe(sampleGoal.status);
      expect(encrypted.achievable).toBe(sampleGoal.achievable);
      expect(encrypted.deadline).toBe(sampleGoal.deadline);
      expect(encrypted.priority).toBe(sampleGoal.priority);
      expect(encrypted.columns).toEqual(sampleGoal.columns);
    });
  });

  describe('GoalTask encryption', () => {
    const sampleTask: GoalTask = {
      id: 'task_456',
      title: 'Read chapter 1',
      column: 'doing',
      points: 3,
      priority: 'high',
      dueDate: '2024-02-01',
      subtasks: [
        { title: 'Introduction', done: true },
        { title: 'Basic types', done: false },
      ],
    };

    it('should encrypt and decrypt a goal task', async () => {
      const encrypted = await encryptGoalTask(sampleTask, key);
      const decrypted = await decryptGoalTask(encrypted, key);

      expect(decrypted).toEqual(sampleTask);
    });

    it('should encrypt task title and subtask titles', async () => {
      const encrypted = await encryptGoalTask(sampleTask, key);

      expect(encrypted.title).not.toBe(sampleTask.title);
      expect(encrypted.subtasks[0].title).not.toBe(sampleTask.subtasks[0].title);

      // Non-sensitive fields preserved
      expect(encrypted.id).toBe(sampleTask.id);
      expect(encrypted.column).toBe(sampleTask.column);
      expect(encrypted.points).toBe(sampleTask.points);
      expect(encrypted.subtasks[0].done).toBe(sampleTask.subtasks[0].done);
    });
  });

  describe('Project encryption', () => {
    const sampleProject: Project = {
      id: 'project_789',
      name: 'E-commerce Platform',
      key: 'ECOM',
      description: 'Build a full-featured e-commerce platform',
      project_type: 'software',
      status: 'active',
      visibility: 'private',
      lead_id: 'user_1',
      created_by: 'user_1',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
      team_ids: ['team_1'],
      member_ids: ['user_1', 'user_2'],
      tags: ['web', 'commerce', 'fullstack'],
      epic_count: 0,
      story_count: 0,
      completed_story_count: 0,
      total_story_points: 0,
      completed_story_points: 0,
    };

    it('should encrypt and decrypt a project', async () => {
      const encrypted = await encryptProject(sampleProject, key);
      const decrypted = await decryptProject(encrypted, key);

      expect(decrypted).toEqual(sampleProject);
    });

    it('should encrypt name and description', async () => {
      const encrypted = await encryptProject(sampleProject, key);

      expect(encrypted.name).not.toBe(sampleProject.name);
      expect(encrypted.description).not.toBe(sampleProject.description);

      // Non-sensitive fields preserved
      expect(encrypted.id).toBe(sampleProject.id);
      expect(encrypted.status).toBe(sampleProject.status);
      expect(encrypted.key).toBe(sampleProject.key);
    });

    it('should handle project without description', async () => {
      const projectWithoutDescription = { ...sampleProject, description: undefined };
      const encrypted = await encryptProject(projectWithoutDescription, key);
      const decrypted = await decryptProject(encrypted, key);

      expect(decrypted.description).toBeUndefined();
    });
  });

  describe('Epic encryption', () => {
    const sampleEpic: Epic = {
      id: 'epic_101',
      title: 'User Authentication',
      description: 'Implement complete auth system',
      status: 'in_progress',
      priority: 'high',
      color: '#FF5733',
      project_id: 'project_789',
      story_count: 5,
      completed_story_count: 2,
      total_story_points: 21,
      completed_story_points: 8,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T00:00:00Z',
    };

    it('should encrypt and decrypt an epic', async () => {
      const encrypted = await encryptEpic(sampleEpic, key);
      const decrypted = await decryptEpic(encrypted, key);

      expect(decrypted).toEqual(sampleEpic);
    });

    it('should encrypt title and description', async () => {
      const encrypted = await encryptEpic(sampleEpic, key);

      expect(encrypted.title).not.toBe(sampleEpic.title);
      expect(encrypted.description).not.toBe(sampleEpic.description);

      // Non-sensitive fields preserved
      expect(encrypted.id).toBe(sampleEpic.id);
      expect(encrypted.color).toBe(sampleEpic.color);
      expect(encrypted.story_count).toBe(sampleEpic.story_count);
    });
  });

  describe('Sprint encryption', () => {
    const sampleSprint: Sprint = {
      id: 'sprint_303',
      name: 'Sprint 5',
      goal: 'Complete authentication module',
      start_date: '2024-01-15',
      end_date: '2024-01-29',
      status: 'active',
      project_id: 'project_789',
      velocity: 18,
      total_points: 21,
      completed_points: 8,
      created_at: '2024-01-14T00:00:00Z',
      updated_at: '2024-01-20T00:00:00Z',
    };

    it('should encrypt and decrypt a sprint', async () => {
      const encrypted = await encryptSprint(sampleSprint, key);
      const decrypted = await decryptSprint(encrypted, key);

      expect(decrypted).toEqual(sampleSprint);
    });

    it('should encrypt name and goal', async () => {
      const encrypted = await encryptSprint(sampleSprint, key);

      expect(encrypted.name).not.toBe(sampleSprint.name);
      expect(encrypted.goal).not.toBe(sampleSprint.goal);

      // Non-sensitive fields preserved
      expect(encrypted.id).toBe(sampleSprint.id);
      expect(encrypted.total_points).toBe(sampleSprint.total_points);
      expect(encrypted.velocity).toBe(sampleSprint.velocity);
    });

    it('should handle sprint without goal', async () => {
      const sprintWithoutGoal = { ...sampleSprint, goal: undefined };
      const encrypted = await encryptSprint(sprintWithoutGoal, key);
      const decrypted = await decryptSprint(encrypted, key);

      expect(decrypted.goal).toBeUndefined();
    });
  });

  describe('FocusDay encryption', () => {
    const sampleFocusDay: FocusDay = {
      id: 'focus_20240120',
      date: '2024-01-20',
      availableHours: 8,
      pointCapacity: 15,
      items: [
        {
          source: 'task_456',
          type: 'goal_task',
          title: 'Read chapter 1',
          points: 3,
          score: 85,
          reason: 'Due soon, high priority',
          status: 'pending',
        },
        {
          source: 'story_202',
          type: 'story',
          title: 'Login form',
          points: 5,
          score: 70,
          reason: 'Sprint commitment',
          status: 'done',
          completedAt: '2024-01-20T15:30:00Z',
        },
      ],
      plannedPoints: 8,
      completedPoints: 5,
      completedItems: 1,
      reflection: 'Good progress today, but got distracted in the afternoon.',
    };

    it('should encrypt and decrypt a focus day', async () => {
      const encrypted = await encryptFocusDay(sampleFocusDay, key);
      const decrypted = await decryptFocusDay(encrypted, key);

      expect(decrypted).toEqual(sampleFocusDay);
    });

    it('should encrypt item titles, reasons, and reflection', async () => {
      const encrypted = await encryptFocusDay(sampleFocusDay, key);

      expect(encrypted.items[0].title).not.toBe(sampleFocusDay.items[0].title);
      expect(encrypted.items[0].reason).not.toBe(sampleFocusDay.items[0].reason);
      expect(encrypted.reflection).not.toBe(sampleFocusDay.reflection);

      // Non-sensitive fields preserved
      expect(encrypted.date).toBe(sampleFocusDay.date);
      expect(encrypted.items[0].points).toBe(sampleFocusDay.items[0].points);
      expect(encrypted.items[0].score).toBe(sampleFocusDay.items[0].score);
      expect(encrypted.items[0].status).toBe(sampleFocusDay.items[0].status);
    });

    it('should handle focus day without reflection', async () => {
      const focusWithoutReflection = { ...sampleFocusDay, reflection: undefined };
      const encrypted = await encryptFocusDay(focusWithoutReflection, key);
      const decrypted = await decryptFocusDay(encrypted, key);

      expect(decrypted.reflection).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('should fail to decrypt with wrong key', async () => {
      const original = 'Secret message';
      const encrypted = await encryptValue(original, key);

      const wrongKey = await generateKey();

      await expect(decryptValue(encrypted, wrongKey)).rejects.toThrow();
    });

    it('should fail to decrypt tampered data', async () => {
      const original = 'Secret message';
      const encrypted = await encryptValue(original, key);

      // Tamper with the ciphertext
      const tampered = encrypted.slice(0, -5) + 'XXXXX';

      await expect(decryptValue(tampered as EncryptedString, key)).rejects.toThrow();
    });
  });
});
