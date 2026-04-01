/**
 * Desktop Storage Adapter (Placeholder)
 * Tauri-based implementation for desktop applications
 *
 * This is a placeholder that will be fully implemented in Phase 1
 * when the Tauri desktop application is created.
 *
 * The actual implementation will use @tauri-apps/api/core invoke()
 * to call Rust commands defined in the vault-core crate.
 */

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
import { createStorageError, wrapError } from '../../errors';

/**
 * Placeholder Desktop Storage Adapter
 * Throws NOT_IMPLEMENTED for all operations until Phase 1
 */
export class DesktopStorageAdapterPlaceholder implements StorageAdapter {
  private notImplemented<T>(operation: string): StorageResult<T> {
    return wrapError<T>(
      createStorageError(
        'NOT_IMPLEMENTED',
        `Desktop adapter not yet implemented: ${operation}. Will be implemented in Phase 1 with Tauri.`
      )
    );
  }

  // Lifecycle
  async initialize(): Promise<StorageResult<void>> {
    return this.notImplemented<void>('initialize');
  }

  async dispose(): Promise<void> {}

  supportsSync(): boolean {
    return false;
  }

  // Vault operations
  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    return this.notImplemented<VaultListItem[]>('listVaults');
  }

  async openVault(_identifier: string): Promise<StorageResult<Vault>> {
    return this.notImplemented<Vault>('openVault');
  }

  async createVault(_data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    return this.notImplemented<VaultConfig>('createVault');
  }

  async updateVault(_vaultId: string, _data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    return this.notImplemented<VaultConfig>('updateVault');
  }

  async closeVault(_vaultId: string): Promise<StorageResult<void>> {
    return this.notImplemented<void>('closeVault');
  }

  async deleteVault(_vaultId: string): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteVault');
  }

  async getVaultStats(_vaultId: string): Promise<StorageResult<VaultStats>> {
    return this.notImplemented<VaultStats>('getVaultStats');
  }

  async updateVaultSettings(
    _vaultId: string,
    _settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    return this.notImplemented<VaultSettings>('updateVaultSettings');
  }

  // Goal operations
  async getGoals(_vaultId: string, _options?: GoalQueryOptions): Promise<StorageResult<SmartGoal[]>> {
    return this.notImplemented<SmartGoal[]>('getGoals');
  }

  async getGoal(_vaultId: string, _goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.notImplemented<SmartGoal>('getGoal');
  }

  async createGoal(_vaultId: string, _data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    return this.notImplemented<SmartGoal>('createGoal');
  }

  async updateGoal(
    _vaultId: string,
    _goalId: string,
    _data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    return this.notImplemented<SmartGoal>('updateGoal');
  }

  async deleteGoal(_vaultId: string, _goalId: string): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteGoal');
  }

  async archiveGoal(_vaultId: string, _goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.notImplemented<SmartGoal>('archiveGoal');
  }

  // Goal task operations
  async getGoalTasks(_vaultId: string, _goalId: string): Promise<StorageResult<GoalTask[]>> {
    return this.notImplemented<GoalTask[]>('getGoalTasks');
  }

  async getGoalTask(
    _vaultId: string,
    _goalId: string,
    _taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return this.notImplemented<GoalTask>('getGoalTask');
  }

  async createGoalTask(
    _vaultId: string,
    _goalId: string,
    _task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    return this.notImplemented<GoalTask>('createGoalTask');
  }

  async updateGoalTask(
    _vaultId: string,
    _goalId: string,
    _taskId: string,
    _data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    return this.notImplemented<GoalTask>('updateGoalTask');
  }

  async deleteGoalTask(
    _vaultId: string,
    _goalId: string,
    _taskId: string
  ): Promise<StorageResult<void>> {
    return this.notImplemented<void>('deleteGoalTask');
  }

  async moveGoalTask(
    _vaultId: string,
    _goalId: string,
    _taskId: string,
    _targetColumn: string,
    _position?: number
  ): Promise<StorageResult<GoalTask>> {
    return this.notImplemented<GoalTask>('moveGoalTask');
  }

  async completeGoalTask(
    _vaultId: string,
    _goalId: string,
    _taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return this.notImplemented<GoalTask>('completeGoalTask');
  }

  // Project operations
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

  // Epic operations
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

  // Sprint operations
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

  // Focus operations
  async getFocusDay(
    _vaultId: string,
    _date: string
  ): Promise<StorageResult<FocusDay | null>> {
    return this.notImplemented<FocusDay | null>('getFocusDay');
  }

  async saveFocusDay(
    _vaultId: string,
    _focusDay: FocusDay
  ): Promise<StorageResult<FocusDay>> {
    return this.notImplemented<FocusDay>('saveFocusDay');
  }

  async getFocusHistory(
    _vaultId: string,
    _options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    return this.notImplemented<FocusHistory[]>('getFocusHistory');
  }

  async getFocusVelocity(_vaultId: string): Promise<StorageResult<FocusVelocity>> {
    return this.notImplemented<FocusVelocity>('getFocusVelocity');
  }

  async completeFocusItem(
    _vaultId: string,
    _date: string,
    _itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    return this.notImplemented<FocusDay>('completeFocusItem');
  }

  async deferFocusItem(
    _vaultId: string,
    _date: string,
    _itemSource: string,
    _deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    return this.notImplemented<FocusDay>('deferFocusItem');
  }

  async gatherFocusCandidates(_vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    return this.notImplemented<FocusCandidate[]>('gatherFocusCandidates');
  }

  // Search operations
  async search(
    _vaultId: string,
    _query: string,
    _options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    return this.notImplemented<VaultSearchResult[]>('search');
  }

  // Sync operations
  async getSyncState(_vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.notImplemented<VaultSyncState>('getSyncState');
  }

  async syncVault(_vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.notImplemented<VaultSyncState>('syncVault');
  }
}

/**
 * Factory function to create a desktop storage adapter
 * Returns a placeholder until Phase 1 implementation
 */
export function createDesktopStorage(): StorageAdapter {
  console.warn(
    '[@goalrate-app/storage] Desktop storage adapter is a placeholder. ' +
      'Full implementation will be available in Phase 1 with Tauri.'
  );
  return new DesktopStorageAdapterPlaceholder();
}

// Re-export the actual implementation for Tauri apps
export { DesktopStorageAdapter } from './DesktopStorageAdapter';

/**
 * Factory function to create the Tauri-based desktop storage adapter
 * Use this in actual Tauri applications
 */
export async function createTauriStorage(): Promise<StorageAdapter> {
  const { DesktopStorageAdapter } = await import('./DesktopStorageAdapter');
  return new DesktopStorageAdapter();
}
