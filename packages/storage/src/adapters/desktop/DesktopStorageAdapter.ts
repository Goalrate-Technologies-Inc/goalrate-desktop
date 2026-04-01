/**
 * Desktop Storage Adapter
 * Tauri-based implementation for desktop applications
 *
 * Uses @tauri-apps/api/core invoke() to call Rust commands
 * defined in the Tauri app backend.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  StorageAdapter,
  StorageResult,
  GoalQueryOptions,
  ProjectQueryOptions,
  SprintQueryOptions,
  FocusQueryOptions,
  SearchOptions,
} from '../../interface';
import type {
  Vault,
  VaultConfig,
  VaultCreate,
  VaultUpdate,
  VaultListItem,
  VaultSettings,
  VaultStats,
  SmartGoal,
  GoalCreate,
  GoalUpdate,
  GoalTask,
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
  VaultSearchResult,
  VaultSyncState,
} from '@goalrate-app/shared';
import {
  createStorageError,
  wrapError,
  wrapSuccess,
  type StorageError,
  type StorageErrorCode,
} from '../../errors';

/**
 * Map Tauri invoke errors to StorageError
 */
function mapTauriError(error: unknown): StorageError {
  if (typeof error === 'object' && error !== null) {
    const err = error as { code?: string; message?: string };
    const code = (err.code as StorageErrorCode) || 'UNKNOWN_ERROR';
    const message = err.message || 'Unknown error occurred';
    return createStorageError(code, message);
  }
  return createStorageError('UNKNOWN_ERROR', String(error));
}

/**
 * Helper to wrap Tauri invoke calls
 */
async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<StorageResult<T>> {
  try {
    const result = await invoke<T>(command, args);
    return wrapSuccess(result);
  } catch (error) {
    return wrapError(mapTauriError(error));
  }
}

/**
 * Desktop Storage Adapter using Tauri IPC
 */
export class DesktopStorageAdapter implements StorageAdapter {
  private notImplemented<T>(operation: string): StorageResult<T> {
    return wrapError<T>(
      createStorageError(
        'NOT_IMPLEMENTED',
        `Desktop adapter: ${operation} not yet implemented.`
      )
    );
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<StorageResult<void>> {
    // No initialization needed for desktop adapter
    return wrapSuccess(undefined);
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  supportsSync(): boolean {
    // Sync will be supported in future phases
    return false;
  }

  // ==========================================================================
  // Vault Operations (IMPLEMENTED)
  // ==========================================================================

  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    return invokeCommand<VaultListItem[]>('list_vaults');
  }

  async openVault(path: string): Promise<StorageResult<Vault>> {
    const result = await invokeCommand<VaultConfig>('open_vault', { path });
    if (!result.success || !result.data) {
      return result as StorageResult<Vault>;
    }
    // Convert VaultConfig to Vault (add required array fields)
    const vault: Vault = {
      ...result.data,
      goals: [],
      projects: [],
      focusDays: [],
    };
    return wrapSuccess(vault);
  }

  async createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    return invokeCommand<VaultConfig>('create_vault', { data });
  }

  async updateVault(_vaultId: string, _data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    return this.notImplemented<VaultConfig>('updateVault');
  }

  async closeVault(vaultId: string): Promise<StorageResult<void>> {
    return invokeCommand<void>('close_vault', { vaultId });
  }

  async deleteVault(vaultId: string): Promise<StorageResult<void>> {
    return invokeCommand<void>('delete_vault', { vaultId });
  }

  async getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>> {
    return invokeCommand<VaultStats>('get_vault_stats', { vaultId });
  }

  async updateVaultSettings(
    _vaultId: string,
    _settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    return this.notImplemented<VaultSettings>('updateVaultSettings');
  }

  // ==========================================================================
  // Goal Operations (IMPLEMENTED)
  // ==========================================================================

  async getGoals(vaultId: string, _options?: GoalQueryOptions): Promise<StorageResult<SmartGoal[]>> {
    return invokeCommand<SmartGoal[]>('list_goals', { vaultId });
  }

  async getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return invokeCommand<SmartGoal>('get_goal', { vaultId, goalId });
  }

  async createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    return invokeCommand<SmartGoal>('create_goal', { vaultId, data });
  }

  async updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    return invokeCommand<SmartGoal>('update_goal', { vaultId, goalId, data });
  }

  async deleteGoal(vaultId: string, goalId: string): Promise<StorageResult<void>> {
    return invokeCommand<void>('delete_goal', { vaultId, goalId });
  }

  async archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return invokeCommand<SmartGoal>('archive_goal', { vaultId, goalId });
  }

  // ==========================================================================
  // Goal Task Operations (IMPLEMENTED)
  // ==========================================================================

  async getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>> {
    return invokeCommand<GoalTask[]>('list_goal_tasks', { vaultId, goalId });
  }

  async getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return invokeCommand<GoalTask>('get_goal_task', { vaultId, goalId, taskId });
  }

  async createGoalTask(
    vaultId: string,
    goalId: string,
    task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    return invokeCommand<GoalTask>('create_goal_task', { vaultId, goalId, data: task });
  }

  async updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    return invokeCommand<GoalTask>('update_goal_task', { vaultId, goalId, taskId, data });
  }

  async deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<void>> {
    return invokeCommand<void>('delete_goal_task', { vaultId, goalId, taskId });
  }

  async moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    _position?: number
  ): Promise<StorageResult<GoalTask>> {
    return invokeCommand<GoalTask>('move_goal_task', { vaultId, goalId, taskId, toColumn: targetColumn });
  }

  async completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return invokeCommand<GoalTask>('complete_goal_task', { vaultId, goalId, taskId, completedBy: null });
  }

  // ==========================================================================
  // Project Operations (NOT YET IMPLEMENTED)
  // ==========================================================================

  async getProjects(
    _vaultId: string,
    _options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>> {
    return this.notImplemented<Project[]>('getProjects');
  }

  async getProject(_vaultId: string, _projectId: string): Promise<StorageResult<Project>> {
    return this.notImplemented<Project>('getProject');
  }

  async createProject(_vaultId: string, _data: ProjectCreate): Promise<StorageResult<Project>> {
    return this.notImplemented<Project>('createProject');
  }

  async updateProject(
    _vaultId: string,
    _projectId: string,
    _data: ProjectUpdate
  ): Promise<StorageResult<Project>> {
    return this.notImplemented<Project>('updateProject');
  }

  async deleteProject(_vaultId: string, _projectId: string): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteProject');
  }

  async updateProjectColumns(
    _vaultId: string,
    _projectId: string,
    _columns: BoardColumn[]
  ): Promise<StorageResult<Project>> {
    return this.notImplemented<Project>('updateProjectColumns');
  }

  // ==========================================================================
  // Epic Operations (NOT YET IMPLEMENTED)
  // ==========================================================================

  async getEpics(_vaultId: string, _projectId: string): Promise<StorageResult<Epic[]>> {
    return this.notImplemented<Epic[]>('getEpics');
  }

  async getEpic(
    _vaultId: string,
    _projectId: string,
    _epicId: string
  ): Promise<StorageResult<Epic>> {
    return this.notImplemented<Epic>('getEpic');
  }

  async createEpic(
    _vaultId: string,
    _projectId: string,
    _data: EpicCreate
  ): Promise<StorageResult<Epic>> {
    return this.notImplemented<Epic>('createEpic');
  }

  async updateEpic(
    _vaultId: string,
    _projectId: string,
    _epicId: string,
    _data: EpicUpdate
  ): Promise<StorageResult<Epic>> {
    return this.notImplemented<Epic>('updateEpic');
  }

  async deleteEpic(
    _vaultId: string,
    _projectId: string,
    _epicId: string
  ): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteEpic');
  }

  // ==========================================================================
  // Sprint Operations (NOT YET IMPLEMENTED)
  // ==========================================================================

  async getSprints(
    _vaultId: string,
    _projectId: string,
    _options?: SprintQueryOptions
  ): Promise<StorageResult<Sprint[]>> {
    return this.notImplemented<Sprint[]>('getSprints');
  }

  async getSprint(
    _vaultId: string,
    _projectId: string,
    _sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.notImplemented<Sprint>('getSprint');
  }

  async createSprint(
    _vaultId: string,
    _projectId: string,
    _data: SprintCreate
  ): Promise<StorageResult<Sprint>> {
    return this.notImplemented<Sprint>('createSprint');
  }

  async updateSprint(
    _vaultId: string,
    _projectId: string,
    _sprintId: string,
    _data: SprintUpdate
  ): Promise<StorageResult<Sprint>> {
    return this.notImplemented<Sprint>('updateSprint');
  }

  async deleteSprint(
    _vaultId: string,
    _projectId: string,
    _sprintId: string
  ): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteSprint');
  }

  async startSprint(
    _vaultId: string,
    _projectId: string,
    _sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.notImplemented<Sprint>('startSprint');
  }

  async completeSprint(
    _vaultId: string,
    _projectId: string,
    _sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.notImplemented<Sprint>('completeSprint');
  }

  async getSprintBurndown(
    _vaultId: string,
    _projectId: string,
    _sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>> {
    return this.notImplemented<BurndownEntry[]>('getSprintBurndown');
  }

  async saveRetrospective(
    _vaultId: string,
    _projectId: string,
    _sprintId: string,
    _retro: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>> {
    return this.notImplemented<Retrospective>('saveRetrospective');
  }

  // ==========================================================================
  // Focus Operations (IMPLEMENTED)
  // ==========================================================================

  async getFocusDay(
    vaultId: string,
    date: string
  ): Promise<StorageResult<FocusDay | null>> {
    return invokeCommand<FocusDay | null>('get_focus_day', { vaultId, date });
  }

  async saveFocusDay(
    vaultId: string,
    focusDay: FocusDay
  ): Promise<StorageResult<FocusDay>> {
    return invokeCommand<FocusDay>('save_focus_day', { vaultId, focusDay });
  }

  async getFocusHistory(
    _vaultId: string,
    _options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    // Focus history is not yet implemented in the backend
    return this.notImplemented<FocusHistory[]>('getFocusHistory');
  }

  async getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>> {
    return invokeCommand<FocusVelocity>('get_focus_velocity', { vaultId });
  }

  async completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    return invokeCommand<FocusDay>('complete_focus_item', { vaultId, date, itemSource });
  }

  async deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    return invokeCommand<FocusDay>('defer_focus_item', { vaultId, date, itemSource, deferTo });
  }

  async gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    return invokeCommand<FocusCandidate[]>('gather_focus_candidates', { vaultId });
  }

  // ==========================================================================
  // Search Operations (NOT YET IMPLEMENTED)
  // ==========================================================================

  async search(
    _vaultId: string,
    _query: string,
    _options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    return this.notImplemented<VaultSearchResult[]>('search');
  }

  // ==========================================================================
  // Sync Operations (NOT YET IMPLEMENTED)
  // ==========================================================================

  async getSyncState(_vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.notImplemented<VaultSyncState>('getSyncState');
  }

  async syncVault(_vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.notImplemented<VaultSyncState>('syncVault');
  }
}
