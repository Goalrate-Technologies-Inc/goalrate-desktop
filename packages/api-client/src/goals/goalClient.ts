/**
 * Goals Client
 * Handles SMART goals and goal task operations
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type {
  GoalExtended,
  GoalCreate,
  GoalUpdate,
  GoalTask,
  DailyTask,
} from '@goalrate-app/shared';

/**
 * Goal list filters
 */
export interface GoalListParams extends ListParams {
  status?: 'active' | 'completed' | 'archived';
  priority?: 'critical' | 'high' | 'medium' | 'low';
  workspaceId?: string;
  vaultId?: string;
  category?: string;
}

/**
 * Goal task creation data
 */
export interface GoalTaskCreate {
  title: string;
  column?: string;
  points?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  dueDate?: string;
}

/**
 * Goal task update data
 */
export interface GoalTaskUpdate {
  title?: string;
  column?: string;
  points?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  dueDate?: string;
}

/**
 * Daily task creation data
 */
export interface DailyTaskCreate {
  title: string;
  description?: string;
  estimated_time?: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  source_goal_id?: string;
  source_project_id?: string;
}

/**
 * Goals client for goal and goal task operations
 */
export class GoalClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Goal Operations
  // ========================================

  /**
   * List all goals
   */
  async list(params?: GoalListParams): Promise<PaginatedResponse<GoalExtended>> {
    const response = await this.http.get<PaginatedResponse<GoalExtended>>(
      '/api/goals',
      params
    );
    return response.data;
  }

  /**
   * Get a specific goal by ID
   */
  async get(goalId: string): Promise<GoalExtended> {
    const response = await this.http.get<GoalExtended>(`/api/goals/${goalId}`);
    return response.data;
  }

  /**
   * Create a new goal
   */
  async create(data: GoalCreate): Promise<GoalExtended> {
    const response = await this.http.post<GoalExtended>('/api/goals', data);
    return response.data;
  }

  /**
   * Update an existing goal
   */
  async update(goalId: string, data: GoalUpdate): Promise<GoalExtended> {
    const response = await this.http.patch<GoalExtended>(
      `/api/goals/${goalId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a goal
   */
  async delete(goalId: string): Promise<void> {
    await this.http.delete<void>(`/api/goals/${goalId}`);
  }

  /**
   * Archive a goal
   */
  async archive(goalId: string): Promise<GoalExtended> {
    const response = await this.http.post<GoalExtended>(
      `/api/goals/${goalId}/archive`
    );
    return response.data;
  }

  /**
   * Unarchive a goal
   */
  async unarchive(goalId: string): Promise<GoalExtended> {
    const response = await this.http.post<GoalExtended>(
      `/api/goals/${goalId}/unarchive`
    );
    return response.data;
  }

  /**
   * Update goal progress
   */
  async updateProgress(goalId: string, progress: number): Promise<GoalExtended> {
    const response = await this.http.patch<GoalExtended>(
      `/api/goals/${goalId}/progress`,
      { progress }
    );
    return response.data;
  }

  // ========================================
  // Goal Task Operations
  // ========================================

  /**
   * List tasks for a goal
   */
  async listTasks(goalId: string): Promise<GoalTask[]> {
    const response = await this.http.get<GoalTask[]>(
      `/api/goals/${goalId}/tasks`
    );
    return response.data;
  }

  /**
   * Get a specific goal task
   */
  async getTask(goalId: string, taskId: string): Promise<GoalTask> {
    const response = await this.http.get<GoalTask>(
      `/api/goals/${goalId}/tasks/${taskId}`
    );
    return response.data;
  }

  /**
   * Create a new goal task
   */
  async createTask(goalId: string, data: GoalTaskCreate): Promise<GoalTask> {
    const response = await this.http.post<GoalTask>(
      `/api/goals/${goalId}/tasks`,
      data
    );
    return response.data;
  }

  /**
   * Update a goal task
   */
  async updateTask(
    goalId: string,
    taskId: string,
    data: GoalTaskUpdate
  ): Promise<GoalTask> {
    const response = await this.http.patch<GoalTask>(
      `/api/goals/${goalId}/tasks/${taskId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a goal task
   */
  async deleteTask(goalId: string, taskId: string): Promise<void> {
    await this.http.delete<void>(`/api/goals/${goalId}/tasks/${taskId}`);
  }

  /**
   * Move a goal task to a different column
   */
  async moveTask(
    goalId: string,
    taskId: string,
    column: string
  ): Promise<GoalTask> {
    const response = await this.http.patch<GoalTask>(
      `/api/goals/${goalId}/tasks/${taskId}/move`,
      { column }
    );
    return response.data;
  }

  /**
   * Complete a goal task
   */
  async completeTask(goalId: string, taskId: string): Promise<GoalTask> {
    const response = await this.http.post<GoalTask>(
      `/api/goals/${goalId}/tasks/${taskId}/complete`
    );
    return response.data;
  }

  // ========================================
  // Daily Task Operations
  // ========================================

  /**
   * List daily tasks
   */
  async listDailyTasks(date?: string): Promise<DailyTask[]> {
    const response = await this.http.get<DailyTask[]>('/api/daily-tasks', {
      date,
    });
    return response.data;
  }

  /**
   * Create a daily task
   */
  async createDailyTask(data: DailyTaskCreate): Promise<DailyTask> {
    const response = await this.http.post<DailyTask>('/api/daily-tasks', data);
    return response.data;
  }

  /**
   * Update a daily task
   */
  async updateDailyTask(
    taskId: string,
    data: Partial<DailyTaskCreate> & { completed?: boolean }
  ): Promise<DailyTask> {
    const response = await this.http.patch<DailyTask>(
      `/api/daily-tasks/${taskId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a daily task
   */
  async deleteDailyTask(taskId: string): Promise<void> {
    await this.http.delete<void>(`/api/daily-tasks/${taskId}`);
  }

  /**
   * Complete a daily task
   */
  async completeDailyTask(taskId: string): Promise<DailyTask> {
    const response = await this.http.post<DailyTask>(
      `/api/daily-tasks/${taskId}/complete`
    );
    return response.data;
  }

  /**
   * Generate AI tasks for a goal
   */
  async generateAITasks(goalId: string): Promise<DailyTask[]> {
    const response = await this.http.post<DailyTask[]>(
      `/api/goals/${goalId}/generate-tasks`
    );
    return response.data;
  }
}
