/**
 * Mock Storage Adapter
 * A mock implementation for testing with spy capabilities
 */

import type {
  StorageAdapter,
  StorageResult,
  DeleteGoalOptions,
  DeleteGoalTaskOptions,
  GoalQueryOptions,
  ProjectQueryOptions,
  SprintQueryOptions,
  FocusQueryOptions,
  SearchOptions,
} from '../interface';
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

// ============================================================================
// TYPES
// ============================================================================

export interface MockStorageAdapterOptions {
  /** Default return value for all methods */
  defaultResult?: StorageResult<unknown>;
  /** Initial vaults */
  vaults?: VaultListItem[];
  /** Initial current vault */
  currentVault?: Vault;
}

// ============================================================================
// MOCK ADAPTER
// ============================================================================

/**
 * Mock Storage Adapter for testing
 * All methods return configurable mock values and track calls
 */
export class MockStorageAdapter implements StorageAdapter {
  private defaultResult: StorageResult<unknown>;
  private _vaults: VaultListItem[];
  private _currentVault: Vault | null;

  // Call tracking
  private _calls: Map<string, unknown[][]> = new Map();

  constructor(options: MockStorageAdapterOptions = {}) {
    this.defaultResult = options.defaultResult || { success: true, data: undefined };
    this._vaults = options.vaults || [];
    this._currentVault = options.currentVault || null;
  }

  private trackCall(method: string, args: unknown[]): void {
    if (!this._calls.has(method)) {
      this._calls.set(method, []);
    }
    this._calls.get(method)!.push(args);
  }

  /** Get all calls made to a specific method */
  getCalls(method: string): unknown[][] {
    return this._calls.get(method) || [];
  }

  /** Clear all call tracking */
  clearCalls(): void {
    this._calls.clear();
  }

  /** Set mock vaults list */
  setVaults(vaults: VaultListItem[]): void {
    this._vaults = vaults;
  }

  /** Set mock current vault */
  setCurrentVault(vault: Vault | null): void {
    this._currentVault = vault;
  }

  // Lifecycle
  async initialize(): Promise<StorageResult<void>> {
    this.trackCall('initialize', []);
    return { success: true };
  }

  async dispose(): Promise<void> {
    this.trackCall('dispose', []);
  }

  supportsSync(): boolean {
    this.trackCall('supportsSync', []);
    return false;
  }

  // Vault operations
  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    this.trackCall('listVaults', []);
    return { success: true, data: this._vaults };
  }

  async openVault(identifier: string): Promise<StorageResult<Vault>> {
    this.trackCall('openVault', [identifier]);
    return { success: true, data: this._currentVault! };
  }

  async createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    this.trackCall('createVault', [data]);
    return this.defaultResult as StorageResult<VaultConfig>;
  }

  async updateVault(vaultId: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    this.trackCall('updateVault', [vaultId, data]);
    return this.defaultResult as StorageResult<VaultConfig>;
  }

  async closeVault(vaultId: string): Promise<StorageResult<void>> {
    this.trackCall('closeVault', [vaultId]);
    return { success: true };
  }

  async deleteVault(vaultId: string): Promise<StorageResult<void>> {
    this.trackCall('deleteVault', [vaultId]);
    return { success: true };
  }

  async getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>> {
    this.trackCall('getVaultStats', [vaultId]);
    return this.defaultResult as StorageResult<VaultStats>;
  }

  async updateVaultSettings(
    vaultId: string,
    settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    this.trackCall('updateVaultSettings', [vaultId, settings]);
    return this.defaultResult as StorageResult<VaultSettings>;
  }

  // Goal operations
  async getGoals(vaultId: string, options?: GoalQueryOptions): Promise<StorageResult<SmartGoal[]>> {
    this.trackCall('getGoals', [vaultId, options]);
    return { success: true, data: [] };
  }

  async getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    this.trackCall('getGoal', [vaultId, goalId]);
    return this.defaultResult as StorageResult<SmartGoal>;
  }

  async createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    this.trackCall('createGoal', [vaultId, data]);
    return this.defaultResult as StorageResult<SmartGoal>;
  }

  async updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    this.trackCall('updateGoal', [vaultId, goalId, data]);
    return this.defaultResult as StorageResult<SmartGoal>;
  }

  async deleteGoal(
    vaultId: string,
    goalId: string,
    options: DeleteGoalOptions
  ): Promise<StorageResult<void>> {
    this.trackCall('deleteGoal', [vaultId, goalId, options]);
    return { success: true };
  }

  async archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    this.trackCall('archiveGoal', [vaultId, goalId]);
    return this.defaultResult as StorageResult<SmartGoal>;
  }

  // Goal task operations
  async getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>> {
    this.trackCall('getGoalTasks', [vaultId, goalId]);
    return { success: true, data: [] };
  }

  async getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    this.trackCall('getGoalTask', [vaultId, goalId, taskId]);
    return this.defaultResult as StorageResult<GoalTask>;
  }

  async createGoalTask(
    vaultId: string,
    goalId: string,
    task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    this.trackCall('createGoalTask', [vaultId, goalId, task]);
    return this.defaultResult as StorageResult<GoalTask>;
  }

  async updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    this.trackCall('updateGoalTask', [vaultId, goalId, taskId, data]);
    return this.defaultResult as StorageResult<GoalTask>;
  }

  async deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    options: DeleteGoalTaskOptions
  ): Promise<StorageResult<void>> {
    this.trackCall('deleteGoalTask', [vaultId, goalId, taskId, options]);
    return { success: true };
  }

  async moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    position?: number
  ): Promise<StorageResult<GoalTask>> {
    this.trackCall('moveGoalTask', [vaultId, goalId, taskId, targetColumn, position]);
    return this.defaultResult as StorageResult<GoalTask>;
  }

  async completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    this.trackCall('completeGoalTask', [vaultId, goalId, taskId]);
    return this.defaultResult as StorageResult<GoalTask>;
  }

  // Project operations
  async getProjects(
    vaultId: string,
    options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>> {
    this.trackCall('getProjects', [vaultId, options]);
    return { success: true, data: [] };
  }

  async getProject(vaultId: string, projectId: string): Promise<StorageResult<Project>> {
    this.trackCall('getProject', [vaultId, projectId]);
    return this.defaultResult as StorageResult<Project>;
  }

  async createProject(vaultId: string, data: ProjectCreate): Promise<StorageResult<Project>> {
    this.trackCall('createProject', [vaultId, data]);
    return this.defaultResult as StorageResult<Project>;
  }

  async updateProject(
    vaultId: string,
    projectId: string,
    data: ProjectUpdate
  ): Promise<StorageResult<Project>> {
    this.trackCall('updateProject', [vaultId, projectId, data]);
    return this.defaultResult as StorageResult<Project>;
  }

  async deleteProject(vaultId: string, projectId: string): Promise<StorageResult<void>> {
    this.trackCall('deleteProject', [vaultId, projectId]);
    return { success: true };
  }

  async updateProjectColumns(
    vaultId: string,
    projectId: string,
    columns: BoardColumn[]
  ): Promise<StorageResult<Project>> {
    this.trackCall('updateProjectColumns', [vaultId, projectId, columns]);
    return this.defaultResult as StorageResult<Project>;
  }

  // Epic operations
  async getEpics(vaultId: string, projectId: string): Promise<StorageResult<Epic[]>> {
    this.trackCall('getEpics', [vaultId, projectId]);
    return { success: true, data: [] };
  }

  async getEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<Epic>> {
    this.trackCall('getEpic', [vaultId, projectId, epicId]);
    return this.defaultResult as StorageResult<Epic>;
  }

  async createEpic(
    vaultId: string,
    projectId: string,
    data: EpicCreate
  ): Promise<StorageResult<Epic>> {
    this.trackCall('createEpic', [vaultId, projectId, data]);
    return this.defaultResult as StorageResult<Epic>;
  }

  async updateEpic(
    vaultId: string,
    projectId: string,
    epicId: string,
    data: EpicUpdate
  ): Promise<StorageResult<Epic>> {
    this.trackCall('updateEpic', [vaultId, projectId, epicId, data]);
    return this.defaultResult as StorageResult<Epic>;
  }

  async deleteEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<void>> {
    this.trackCall('deleteEpic', [vaultId, projectId, epicId]);
    return { success: true };
  }

  // Sprint operations
  async getSprints(
    vaultId: string,
    projectId: string,
    options?: SprintQueryOptions
  ): Promise<StorageResult<Sprint[]>> {
    this.trackCall('getSprints', [vaultId, projectId, options]);
    return { success: true, data: [] };
  }

  async getSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    this.trackCall('getSprint', [vaultId, projectId, sprintId]);
    return this.defaultResult as StorageResult<Sprint>;
  }

  async createSprint(
    vaultId: string,
    projectId: string,
    data: SprintCreate
  ): Promise<StorageResult<Sprint>> {
    this.trackCall('createSprint', [vaultId, projectId, data]);
    return this.defaultResult as StorageResult<Sprint>;
  }

  async updateSprint(
    vaultId: string,
    projectId: string,
    sprintId: string,
    data: SprintUpdate
  ): Promise<StorageResult<Sprint>> {
    this.trackCall('updateSprint', [vaultId, projectId, sprintId, data]);
    return this.defaultResult as StorageResult<Sprint>;
  }

  async deleteSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<void>> {
    this.trackCall('deleteSprint', [vaultId, projectId, sprintId]);
    return { success: true };
  }

  async startSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    this.trackCall('startSprint', [vaultId, projectId, sprintId]);
    return this.defaultResult as StorageResult<Sprint>;
  }

  async completeSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    this.trackCall('completeSprint', [vaultId, projectId, sprintId]);
    return this.defaultResult as StorageResult<Sprint>;
  }

  async getSprintBurndown(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>> {
    this.trackCall('getSprintBurndown', [vaultId, projectId, sprintId]);
    return { success: true, data: [] };
  }

  async saveRetrospective(
    vaultId: string,
    projectId: string,
    sprintId: string,
    retro: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>> {
    this.trackCall('saveRetrospective', [vaultId, projectId, sprintId, retro]);
    return this.defaultResult as StorageResult<Retrospective>;
  }

  // Focus operations
  async getFocusDay(vaultId: string, date: string): Promise<StorageResult<FocusDay | null>> {
    this.trackCall('getFocusDay', [vaultId, date]);
    return this.defaultResult as StorageResult<FocusDay | null>;
  }

  async saveFocusDay(vaultId: string, focusDay: FocusDay): Promise<StorageResult<FocusDay>> {
    this.trackCall('saveFocusDay', [vaultId, focusDay]);
    return this.defaultResult as StorageResult<FocusDay>;
  }

  async getFocusHistory(
    vaultId: string,
    options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    this.trackCall('getFocusHistory', [vaultId, options]);
    return { success: true, data: [] };
  }

  async getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>> {
    this.trackCall('getFocusVelocity', [vaultId]);
    return this.defaultResult as StorageResult<FocusVelocity>;
  }

  async completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    this.trackCall('completeFocusItem', [vaultId, date, itemSource]);
    return this.defaultResult as StorageResult<FocusDay>;
  }

  async deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    this.trackCall('deferFocusItem', [vaultId, date, itemSource, deferTo]);
    return this.defaultResult as StorageResult<FocusDay>;
  }

  async gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    this.trackCall('gatherFocusCandidates', [vaultId]);
    return { success: true, data: [] };
  }

  // Search operations
  async search(
    vaultId: string,
    query: string,
    options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    this.trackCall('search', [vaultId, query, options]);
    return { success: true, data: [] };
  }

  // Sync operations
  async getSyncState(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    this.trackCall('getSyncState', [vaultId]);
    return this.defaultResult as StorageResult<VaultSyncState>;
  }

  async syncVault(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    this.trackCall('syncVault', [vaultId]);
    return this.defaultResult as StorageResult<VaultSyncState>;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create a mock storage adapter
 */
export function createMockStorage(options?: MockStorageAdapterOptions): MockStorageAdapter {
  return new MockStorageAdapter(options);
}
