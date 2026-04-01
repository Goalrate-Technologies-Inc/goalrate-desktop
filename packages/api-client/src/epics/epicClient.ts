/**
 * Epics Client
 * Handles epic operations within projects
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type { Epic } from '@goalrate-app/shared';

/**
 * Epic list filters
 */
export interface EpicListParams extends ListParams {
  status?: 'backlog' | 'in_progress' | 'done';
  projectId?: string;
}

/**
 * Epic creation data
 */
export interface EpicCreate {
  title: string;
  description?: string;
  projectId: string;
  status?: 'backlog' | 'in_progress' | 'done';
  targetDate?: string;
  color?: string;
}

/**
 * Epic update data
 */
export interface EpicUpdate {
  title?: string;
  description?: string;
  status?: 'backlog' | 'in_progress' | 'done';
  targetDate?: string;
  color?: string;
}

/**
 * Epics client for epic operations
 */
export class EpicClient {
  constructor(private http: HttpClient) {}

  /**
   * List all epics
   */
  async list(params?: EpicListParams): Promise<PaginatedResponse<Epic>> {
    const response = await this.http.get<PaginatedResponse<Epic>>(
      '/api/epics',
      params
    );
    return response.data;
  }

  /**
   * List epics for a specific project
   */
  async listByProject(
    projectId: string,
    params?: ListParams
  ): Promise<PaginatedResponse<Epic>> {
    const response = await this.http.get<PaginatedResponse<Epic>>(
      `/api/projects/${projectId}/epics`,
      params
    );
    return response.data;
  }

  /**
   * Get a specific epic by ID
   */
  async get(epicId: string): Promise<Epic> {
    const response = await this.http.get<Epic>(`/api/epics/${epicId}`);
    return response.data;
  }

  /**
   * Create a new epic
   */
  async create(data: EpicCreate): Promise<Epic> {
    const response = await this.http.post<Epic>('/api/epics', data);
    return response.data;
  }

  /**
   * Update an epic
   */
  async update(epicId: string, data: EpicUpdate): Promise<Epic> {
    const response = await this.http.patch<Epic>(`/api/epics/${epicId}`, data);
    return response.data;
  }

  /**
   * Delete an epic
   */
  async delete(epicId: string): Promise<void> {
    await this.http.delete<void>(`/api/epics/${epicId}`);
  }

  /**
   * Get epic progress statistics
   */
  async getProgress(epicId: string): Promise<{
    totalItems: number;
    completedItems: number;
    totalPoints: number;
    completedPoints: number;
    progressPercentage: number;
  }> {
    const response = await this.http.get<{
      totalItems: number;
      completedItems: number;
      totalPoints: number;
      completedPoints: number;
      progressPercentage: number;
    }>(`/api/epics/${epicId}/progress`);
    return response.data;
  }
}
