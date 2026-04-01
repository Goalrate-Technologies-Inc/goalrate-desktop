/**
 * Sprints Client
 * Handles sprint planning, management, and retrospectives
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type { Sprint, BurndownEntry } from '@goalrate-app/shared';

/**
 * Sprint list filters
 */
export interface SprintListParams extends ListParams {
  status?: 'planned' | 'active' | 'completed';
  projectId?: string;
}

/**
 * Sprint creation data
 */
export interface SprintCreate {
  name: string;
  projectId: string;
  goal?: string;
  startDate: string;
  endDate: string;
}

/**
 * Sprint update data
 */
export interface SprintUpdate {
  name?: string;
  goal?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Sprint retrospective data
 */
export interface RetrospectiveData {
  wentWell: string[];
  needsImprovement: string[];
  actionItems: string[];
}

/**
 * Sprint velocity data
 */
export interface SprintVelocity {
  sprintId: string;
  sprintName: string;
  plannedPoints: number;
  completedPoints: number;
  completionRate: number;
}

/**
 * Sprints client for sprint operations
 */
export class SprintClient {
  constructor(private http: HttpClient) {}

  // ========================================
  // Sprint Operations
  // ========================================

  /**
   * List all sprints
   */
  async list(params?: SprintListParams): Promise<PaginatedResponse<Sprint>> {
    const response = await this.http.get<PaginatedResponse<Sprint>>(
      '/api/sprints',
      params
    );
    return response.data;
  }

  /**
   * List sprints for a specific project
   */
  async listByProject(
    projectId: string,
    params?: Omit<SprintListParams, 'projectId'>
  ): Promise<PaginatedResponse<Sprint>> {
    const response = await this.http.get<PaginatedResponse<Sprint>>(
      `/api/projects/${projectId}/sprints`,
      params
    );
    return response.data;
  }

  /**
   * Get the current active sprint for a project
   */
  async getActive(projectId: string): Promise<Sprint | null> {
    const response = await this.http.get<Sprint | null>(
      `/api/projects/${projectId}/sprints/active`
    );
    return response.data;
  }

  /**
   * Get a specific sprint by ID
   */
  async get(sprintId: string): Promise<Sprint> {
    const response = await this.http.get<Sprint>(`/api/sprints/${sprintId}`);
    return response.data;
  }

  /**
   * Create a new sprint
   */
  async create(data: SprintCreate): Promise<Sprint> {
    const response = await this.http.post<Sprint>('/api/sprints', data);
    return response.data;
  }

  /**
   * Update a sprint
   */
  async update(sprintId: string, data: SprintUpdate): Promise<Sprint> {
    const response = await this.http.patch<Sprint>(
      `/api/sprints/${sprintId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a sprint
   */
  async delete(sprintId: string): Promise<void> {
    await this.http.delete<void>(`/api/sprints/${sprintId}`);
  }

  // ========================================
  // Sprint Lifecycle
  // ========================================

  /**
   * Start a sprint
   */
  async start(sprintId: string): Promise<Sprint> {
    const response = await this.http.post<Sprint>(
      `/api/sprints/${sprintId}/start`
    );
    return response.data;
  }

  /**
   * Complete a sprint
   */
  async complete(sprintId: string): Promise<Sprint> {
    const response = await this.http.post<Sprint>(
      `/api/sprints/${sprintId}/complete`
    );
    return response.data;
  }

  /**
   * Cancel a sprint
   */
  async cancel(sprintId: string): Promise<Sprint> {
    const response = await this.http.post<Sprint>(
      `/api/sprints/${sprintId}/cancel`
    );
    return response.data;
  }

  // ========================================
  // Analytics & Metrics
  // ========================================

  /**
   * Get burndown chart data for a sprint
   */
  async getBurndown(sprintId: string): Promise<BurndownEntry[]> {
    const response = await this.http.get<BurndownEntry[]>(
      `/api/sprints/${sprintId}/burndown`
    );
    return response.data;
  }

  /**
   * Get velocity data for a project's sprints
   */
  async getVelocity(projectId: string, limit?: number): Promise<SprintVelocity[]> {
    const response = await this.http.get<SprintVelocity[]>(
      `/api/projects/${projectId}/velocity`,
      { limit }
    );
    return response.data;
  }

  /**
   * Get sprint summary statistics
   */
  async getSummary(sprintId: string): Promise<{
    totalStories: number;
    completedStories: number;
    totalPoints: number;
    completedPoints: number;
    completionRate: number;
    averageLeadTime: number;
    remainingDays: number;
  }> {
    const response = await this.http.get<{
      totalStories: number;
      completedStories: number;
      totalPoints: number;
      completedPoints: number;
      completionRate: number;
      averageLeadTime: number;
      remainingDays: number;
    }>(`/api/sprints/${sprintId}/summary`);
    return response.data;
  }

  // ========================================
  // Retrospective
  // ========================================

  /**
   * Get retrospective for a sprint
   */
  async getRetrospective(sprintId: string): Promise<RetrospectiveData | null> {
    const response = await this.http.get<RetrospectiveData | null>(
      `/api/sprints/${sprintId}/retrospective`
    );
    return response.data;
  }

  /**
   * Save retrospective for a sprint
   */
  async saveRetrospective(
    sprintId: string,
    data: RetrospectiveData
  ): Promise<RetrospectiveData> {
    const response = await this.http.post<RetrospectiveData>(
      `/api/sprints/${sprintId}/retrospective`,
      data
    );
    return response.data;
  }
}
