/**
 * Web Storage Adapter
 * HTTP API-based implementation for web applications
 */

import type {
  StorageAdapter,
  StorageResult,
  StorageError,
  DeleteGoalOptions,
  DeleteGoalTaskOptions,
  GoalQueryOptions,
  ProjectQueryOptions,
  FocusQueryOptions,
  SearchOptions,
  Vault,
  VaultConfig,
  VaultCreate,
  VaultUpdate,
  VaultListItem,
  VaultSettings,
  VaultStats,
  VaultSearchResult,
  VaultSyncState,
  SmartGoal,
  GoalTask,
  GoalCreate,
  GoalUpdate,
  Project,
  ProjectCreate,
  ProjectUpdate,
  BoardColumn,
  Epic,
  EpicCreate,
  EpicUpdate,
  Sprint,
  SprintCreate,
  SprintUpdate,
  BurndownEntry,
  Retrospective,
  FocusDay,
  FocusCandidate,
  FocusHistory,
  FocusVelocity,
} from '../../interface';
import { createStorageError, wrapSuccess, wrapError } from '../../errors';
import { ApiClient, ApiClientError, type ApiClientOptions } from './api-client';

// ============================================================================
// API STORAGE ADAPTER OPTIONS
// ============================================================================

export interface ApiStorageAdapterOptions extends ApiClientOptions {
  /** Retry failed requests */
  retryOnError?: boolean;
  /** Maximum number of retries */
  maxRetries?: number;
}

// ============================================================================
// API STORAGE ADAPTER
// ============================================================================

/**
 * Web storage adapter using HTTP API
 */
export class ApiStorageAdapter implements StorageAdapter {
  private client: ApiClient;
  private currentVaultId: string | null = null;

  constructor(options: ApiStorageAdapterOptions) {
    this.client = new ApiClient(options);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<StorageResult<void>> {
    try {
      // Verify API connectivity with health check
      await this.client.get('/api/health');
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to connect to API'));
    }
  }

  async dispose(): Promise<void> {
    this.currentVaultId = null;
  }

  supportsSync(): boolean {
    return true;
  }

  /**
   * Set authentication token
   */
  setAccessToken(token: string | null): void {
    this.client.setAccessToken(token);
  }

  // -------------------------------------------------------------------------
  // Vault Operations
  // -------------------------------------------------------------------------

  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    try {
      const response = await this.client.get<VaultListItem[]>('/api/vaults');
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to list vaults'));
    }
  }

  async openVault(identifier: string): Promise<StorageResult<Vault>> {
    try {
      const response = await this.client.get<Vault>(`/api/vaults/${identifier}`);
      this.currentVaultId = response.data.id;
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to open vault'));
    }
  }

  async createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    try {
      const response = await this.client.post<VaultConfig>('/api/vaults', data);
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create vault'));
    }
  }

  async updateVault(vaultId: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    try {
      const response = await this.client.patch<VaultConfig>(`/api/vaults/${vaultId}`, data);
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update vault'));
    }
  }

  async closeVault(vaultId: string): Promise<StorageResult<void>> {
    if (this.currentVaultId === vaultId) {
      this.currentVaultId = null;
    }
    return wrapSuccess(undefined);
  }

  async deleteVault(vaultId: string): Promise<StorageResult<void>> {
    try {
      await this.client.delete(`/api/vaults/${vaultId}`);
      if (this.currentVaultId === vaultId) {
        this.currentVaultId = null;
      }
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete vault'));
    }
  }

  async getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>> {
    try {
      const response = await this.client.get<VaultStats>(`/api/vaults/${vaultId}/stats`);
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get vault stats'));
    }
  }

  async updateVaultSettings(
    vaultId: string,
    settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    try {
      const response = await this.client.patch<VaultSettings>(
        `/api/vaults/${vaultId}/settings`,
        settings
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update vault settings'));
    }
  }

  // -------------------------------------------------------------------------
  // Goal Operations
  // -------------------------------------------------------------------------

  async getGoals(
    vaultId: string,
    options?: GoalQueryOptions
  ): Promise<StorageResult<SmartGoal[]>> {
    try {
      const response = await this.client.get<SmartGoal[]>(
        `/api/vaults/${vaultId}/goals`,
        options as Record<string, unknown>
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get goals'));
    }
  }

  async getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    try {
      const response = await this.client.get<SmartGoal>(
        `/api/vaults/${vaultId}/goals/${goalId}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get goal'));
    }
  }

  async createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    try {
      const response = await this.client.post<SmartGoal>(
        `/api/vaults/${vaultId}/goals`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create goal'));
    }
  }

  async updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    try {
      const response = await this.client.patch<SmartGoal>(
        `/api/vaults/${vaultId}/goals/${goalId}`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update goal'));
    }
  }

  async deleteGoal(
    vaultId: string,
    goalId: string,
    options: DeleteGoalOptions
  ): Promise<StorageResult<void>> {
    if (!options.confirmed) {
      return wrapError(
        createStorageError(
          'VALIDATION_ERROR',
          'Deleting a goal requires explicit confirmation'
        )
      );
    }

    try {
      await this.client.delete(`/api/vaults/${vaultId}/goals/${goalId}`);
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete goal'));
    }
  }

  async archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.updateGoal(vaultId, goalId, { status: 'archived' });
  }

  // -------------------------------------------------------------------------
  // Goal Task Operations
  // -------------------------------------------------------------------------

  async getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>> {
    try {
      const response = await this.client.get<GoalTask[]>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get goal tasks'));
    }
  }

  async getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    try {
      const response = await this.client.get<GoalTask>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks/${taskId}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get goal task'));
    }
  }

  async createGoalTask(
    vaultId: string,
    goalId: string,
    task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    try {
      const response = await this.client.post<GoalTask>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks`,
        task
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create goal task'));
    }
  }

  async updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    try {
      const response = await this.client.patch<GoalTask>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks/${taskId}`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update goal task'));
    }
  }

  async deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    options: DeleteGoalTaskOptions
  ): Promise<StorageResult<void>> {
    if (!options.confirmed) {
      return wrapError(
        createStorageError(
          'VALIDATION_ERROR',
          'Deleting a goal task requires explicit confirmation'
        )
      );
    }

    try {
      await this.client.delete(`/api/vaults/${vaultId}/goals/${goalId}/tasks/${taskId}`);
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete goal task'));
    }
  }

  async moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    position?: number
  ): Promise<StorageResult<GoalTask>> {
    try {
      const response = await this.client.patch<GoalTask>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks/${taskId}/move`,
        { column: targetColumn, position }
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to move goal task'));
    }
  }

  async completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    try {
      const response = await this.client.patch<GoalTask>(
        `/api/vaults/${vaultId}/goals/${goalId}/tasks/${taskId}/complete`,
        {}
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to complete goal task'));
    }
  }

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  async getProjects(
    vaultId: string,
    options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>> {
    try {
      const response = await this.client.get<Project[]>(
        `/api/vaults/${vaultId}/projects`,
        options as Record<string, unknown>
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get projects'));
    }
  }

  async getProject(vaultId: string, projectId: string): Promise<StorageResult<Project>> {
    try {
      const response = await this.client.get<Project>(
        `/api/vaults/${vaultId}/projects/${projectId}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get project'));
    }
  }

  async createProject(vaultId: string, data: ProjectCreate): Promise<StorageResult<Project>> {
    try {
      const response = await this.client.post<Project>(
        `/api/vaults/${vaultId}/projects`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create project'));
    }
  }

  async updateProject(
    vaultId: string,
    projectId: string,
    data: ProjectUpdate
  ): Promise<StorageResult<Project>> {
    try {
      const response = await this.client.patch<Project>(
        `/api/vaults/${vaultId}/projects/${projectId}`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update project'));
    }
  }

  async deleteProject(vaultId: string, projectId: string): Promise<StorageResult<void>> {
    try {
      await this.client.delete(`/api/vaults/${vaultId}/projects/${projectId}`);
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete project'));
    }
  }

  async updateProjectColumns(
    vaultId: string,
    projectId: string,
    columns: BoardColumn[]
  ): Promise<StorageResult<Project>> {
    try {
      const response = await this.client.patch<Project>(
        `/api/vaults/${vaultId}/projects/${projectId}/columns`,
        { columns }
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update project columns'));
    }
  }

  // -------------------------------------------------------------------------
  // Epic Operations
  // -------------------------------------------------------------------------

  async getEpics(vaultId: string, projectId: string): Promise<StorageResult<Epic[]>> {
    try {
      const response = await this.client.get<Epic[]>(
        `/api/vaults/${vaultId}/projects/${projectId}/epics`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get epics'));
    }
  }

  async getEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<Epic>> {
    try {
      const response = await this.client.get<Epic>(
        `/api/vaults/${vaultId}/projects/${projectId}/epics/${epicId}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get epic'));
    }
  }

  async createEpic(
    vaultId: string,
    projectId: string,
    data: EpicCreate
  ): Promise<StorageResult<Epic>> {
    try {
      const response = await this.client.post<Epic>(
        `/api/vaults/${vaultId}/projects/${projectId}/epics`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create epic'));
    }
  }

  async updateEpic(
    vaultId: string,
    projectId: string,
    epicId: string,
    data: EpicUpdate
  ): Promise<StorageResult<Epic>> {
    try {
      const response = await this.client.patch<Epic>(
        `/api/vaults/${vaultId}/projects/${projectId}/epics/${epicId}`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update epic'));
    }
  }

  async deleteEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<void>> {
    try {
      await this.client.delete(`/api/vaults/${vaultId}/projects/${projectId}/epics/${epicId}`);
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete epic'));
    }
  }

  // -------------------------------------------------------------------------
  // Sprint Operations
  // -------------------------------------------------------------------------

  async getSprints(vaultId: string, projectId: string): Promise<StorageResult<Sprint[]>> {
    try {
      const response = await this.client.get<Sprint[]>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get sprints'));
    }
  }

  async getSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    try {
      const response = await this.client.get<Sprint>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get sprint'));
    }
  }

  async createSprint(
    vaultId: string,
    projectId: string,
    data: SprintCreate
  ): Promise<StorageResult<Sprint>> {
    try {
      const response = await this.client.post<Sprint>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to create sprint'));
    }
  }

  async updateSprint(
    vaultId: string,
    projectId: string,
    sprintId: string,
    data: SprintUpdate
  ): Promise<StorageResult<Sprint>> {
    try {
      const response = await this.client.patch<Sprint>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}`,
        data
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to update sprint'));
    }
  }

  async deleteSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<void>> {
    try {
      await this.client.delete(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}`
      );
      return wrapSuccess(undefined);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to delete sprint'));
    }
  }

  async startSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    try {
      const response = await this.client.patch<Sprint>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}/start`,
        {}
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to start sprint'));
    }
  }

  async completeSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    try {
      const response = await this.client.patch<Sprint>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}/complete`,
        {}
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to complete sprint'));
    }
  }

  async getSprintBurndown(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>> {
    try {
      const response = await this.client.get<BurndownEntry[]>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}/burndown`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get sprint burndown'));
    }
  }

  async saveRetrospective(
    vaultId: string,
    projectId: string,
    sprintId: string,
    retro: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>> {
    try {
      const response = await this.client.post<Retrospective>(
        `/api/vaults/${vaultId}/projects/${projectId}/sprints/${sprintId}/retrospective`,
        retro
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to save retrospective'));
    }
  }

  // -------------------------------------------------------------------------
  // Focus Day Operations
  // -------------------------------------------------------------------------

  async getFocusDay(vaultId: string, date: string): Promise<StorageResult<FocusDay | null>> {
    try {
      const response = await this.client.get<FocusDay | null>(
        `/api/vaults/${vaultId}/focus/${date}`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      // Return null for 404 (focus day not found)
      if (error instanceof ApiClientError && error.status === 404) {
        return wrapSuccess(null);
      }
      return wrapError(this.mapError(error, 'Failed to get focus day'));
    }
  }

  async saveFocusDay(vaultId: string, focusDay: FocusDay): Promise<StorageResult<FocusDay>> {
    try {
      const response = await this.client.put<FocusDay>(
        `/api/vaults/${vaultId}/focus/${focusDay.date}`,
        focusDay
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to save focus day'));
    }
  }

  async getFocusHistory(
    vaultId: string,
    options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    try {
      const response = await this.client.get<FocusHistory[]>(
        `/api/vaults/${vaultId}/focus/history`,
        options as Record<string, unknown>
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get focus history'));
    }
  }

  async getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>> {
    try {
      const response = await this.client.get<FocusVelocity>(
        `/api/vaults/${vaultId}/focus/velocity`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      // Return empty velocity if endpoint not found (focus feature may not be
      // implemented on backend yet) or other errors - velocity is non-critical
      if (error instanceof ApiClientError && (error.status === 404 || error.status === 501)) {
        return wrapSuccess(this.createEmptyVelocity());
      }
      // For other errors, still return empty velocity to not block the UI
      // Focus velocity is a supplementary feature
      console.warn('Failed to get focus velocity, returning empty:', error);
      return wrapSuccess(this.createEmptyVelocity());
    }
  }

  /**
   * Create an empty velocity object for when no data is available
   */
  private createEmptyVelocity(): FocusVelocity {
    return {
      averagePointsPerDay: 0,
      averageCompletionRate: 0,
      totalDaysTracked: 0,
      currentStreak: 0,
      longestStreak: 0,
      weeklyTrend: [0, 0, 0, 0, 0, 0, 0],
    };
  }

  async completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    try {
      const response = await this.client.patch<FocusDay>(
        `/api/vaults/${vaultId}/focus/${date}/items/${itemSource}/complete`,
        {}
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to complete focus item'));
    }
  }

  async deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    try {
      const response = await this.client.patch<FocusDay>(
        `/api/vaults/${vaultId}/focus/${date}/items/${itemSource}/defer`,
        { defer_to: deferTo }
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to defer focus item'));
    }
  }

  async gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    try {
      const response = await this.client.get<FocusCandidate[]>(
        `/api/vaults/${vaultId}/focus/candidates`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to gather focus candidates'));
    }
  }

  // -------------------------------------------------------------------------
  // Search Operations
  // -------------------------------------------------------------------------

  async search(
    vaultId: string,
    query: string,
    options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    try {
      const response = await this.client.get<VaultSearchResult[]>(
        `/api/vaults/${vaultId}/search`,
        { query, ...options }
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to search'));
    }
  }

  // -------------------------------------------------------------------------
  // Sync Operations
  // -------------------------------------------------------------------------

  async getSyncState(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    try {
      const response = await this.client.get<VaultSyncState>(
        `/api/vaults/${vaultId}/sync/state`
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to get sync state'));
    }
  }

  async syncVault(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    try {
      const response = await this.client.post<VaultSyncState>(
        `/api/vaults/${vaultId}/sync`,
        {}
      );
      return wrapSuccess(response.data);
    } catch (error) {
      return wrapError(this.mapError(error, 'Failed to sync vault'));
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Map API errors to StorageError
   */
  private mapError(error: unknown, context: string): StorageError {
    if (error instanceof ApiClientError) {
      switch (error.status) {
        case 401:
          return createStorageError('PERMISSION_DENIED', 'Authentication required', error);
        case 403:
          return createStorageError('PERMISSION_DENIED', context, error);
        case 404:
          return createStorageError('ITEM_NOT_FOUND', context, error);
        case 409:
          return createStorageError('SYNC_CONFLICT', context, error);
        case 422:
          return createStorageError('VALIDATION_ERROR', context, error, {
            data: error.data,
          });
        case 408:
          return createStorageError('NETWORK_ERROR', 'Request timeout', error);
        default:
          if (error.status === 0 || error.status >= 500) {
            return createStorageError('NETWORK_ERROR', context, error);
          }
          return createStorageError('UNKNOWN_ERROR', context, error);
      }
    }

    if (error instanceof Error) {
      return createStorageError('UNKNOWN_ERROR', error.message, error);
    }

    return createStorageError('UNKNOWN_ERROR', context, error);
  }
}

/**
 * Factory function to create a web storage adapter
 */
export function createWebStorage(baseUrl: string, options?: Partial<ApiStorageAdapterOptions>): ApiStorageAdapter {
  return new ApiStorageAdapter({
    baseUrl,
    ...options,
  });
}
