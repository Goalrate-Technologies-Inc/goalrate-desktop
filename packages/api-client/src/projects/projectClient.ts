/**
 * Projects Client
 * Handles project and board operations
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type { Project, Board, BoardColumn } from '@goalrate-app/shared';

/**
 * Project list filters
 */
export interface ProjectListParams extends ListParams {
  status?: 'active' | 'completed' | 'archived';
  workspaceId?: string;
  vaultId?: string;
}

/**
 * Project creation data
 */
export interface ProjectCreate {
  name: string;
  description?: string;
  workspaceId?: string;
  vaultId?: string;
  linkedGoalId?: string;
  columns?: BoardColumn[];
}

/**
 * Project update data
 */
export interface ProjectUpdate {
  name?: string;
  description?: string;
  status?: 'active' | 'completed' | 'archived';
  linkedGoalId?: string | null;
}

/**
 * Column creation data
 */
export interface ColumnCreate {
  name: string;
  position?: number;
  wipLimit?: number;
}

/**
 * Column update data
 */
export interface ColumnUpdate {
  name?: string;
  position?: number;
  wipLimit?: number;
}

/**
 * Projects client for project and board operations
 */
export class ProjectClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Project Operations
  // ========================================

  /**
   * List all projects
   */
  async list(params?: ProjectListParams): Promise<PaginatedResponse<Project>> {
    const response = await this.http.get<PaginatedResponse<Project>>(
      '/api/projects',
      params
    );
    return response.data;
  }

  /**
   * Get a specific project by ID
   */
  async get(projectId: string): Promise<Project> {
    const response = await this.http.get<Project>(`/api/projects/${projectId}`);
    return response.data;
  }

  /**
   * Create a new project
   */
  async create(data: ProjectCreate): Promise<Project> {
    const response = await this.http.post<Project>('/api/projects', data);
    return response.data;
  }

  /**
   * Update a project
   */
  async update(projectId: string, data: ProjectUpdate): Promise<Project> {
    const response = await this.http.patch<Project>(
      `/api/projects/${projectId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a project
   */
  async delete(projectId: string): Promise<void> {
    await this.http.delete<void>(`/api/projects/${projectId}`);
  }

  /**
   * Archive a project
   */
  async archive(projectId: string): Promise<Project> {
    const response = await this.http.post<Project>(
      `/api/projects/${projectId}/archive`
    );
    return response.data;
  }

  /**
   * Unarchive a project
   */
  async unarchive(projectId: string): Promise<Project> {
    const response = await this.http.post<Project>(
      `/api/projects/${projectId}/unarchive`
    );
    return response.data;
  }

  // ========================================
  // Board Operations
  // ========================================

  /**
   * Get the project board with all columns and cards
   */
  async getBoard(projectId: string): Promise<Board> {
    const response = await this.http.get<Board>(
      `/api/projects/${projectId}/board`
    );
    return response.data;
  }

  /**
   * Add a column to the project board
   */
  async addColumn(projectId: string, data: ColumnCreate): Promise<BoardColumn> {
    const response = await this.http.post<BoardColumn>(
      `/api/projects/${projectId}/columns`,
      data
    );
    return response.data;
  }

  /**
   * Update a board column
   */
  async updateColumn(
    projectId: string,
    columnId: string,
    data: ColumnUpdate
  ): Promise<BoardColumn> {
    const response = await this.http.patch<BoardColumn>(
      `/api/projects/${projectId}/columns/${columnId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a board column
   */
  async deleteColumn(projectId: string, columnId: string): Promise<void> {
    await this.http.delete<void>(
      `/api/projects/${projectId}/columns/${columnId}`
    );
  }

  /**
   * Reorder columns
   */
  async reorderColumns(projectId: string, columnIds: string[]): Promise<void> {
    await this.http.post<void>(`/api/projects/${projectId}/columns/reorder`, {
      columnIds,
    });
  }

  // ========================================
  // Project Analytics
  // ========================================

  /**
   * Get project analytics
   */
  async getAnalytics(projectId: string): Promise<{
    totalItems: number;
    completedItems: number;
    totalPoints: number;
    completedPoints: number;
    velocity: number;
    burndown: Array<{ date: string; remaining: number }>;
  }> {
    const response = await this.http.get<{
      totalItems: number;
      completedItems: number;
      totalPoints: number;
      completedPoints: number;
      velocity: number;
      burndown: Array<{ date: string; remaining: number }>;
    }>(`/api/projects/${projectId}/analytics`);
    return response.data;
  }
}
