/**
 * Storage Adapter Interface
 * Platform-agnostic interface for storage operations across Desktop, Web, and Mobile
 */

import type {
  // Vault types
  Vault,
  VaultConfig,
  VaultCreate,
  VaultUpdate,
  VaultListItem,
  VaultSettings,
  VaultStats,
  VaultSearchResult,
  VaultSyncState,

  // Goal types
  SmartGoal,
  GoalTask,
  GoalCreate,
  GoalUpdate,

  // Project types
  Project,
  ProjectCreate,
  ProjectUpdate,
  BoardColumn,

  // Epic types
  Epic,
  EpicCreate,
  EpicUpdate,

  // Sprint types
  Sprint,
  SprintCreate,
  SprintUpdate,
  BurndownEntry,
  Retrospective,

  // Focus types
  FocusDay,
  FocusCandidate,
  FocusHistory,
  FocusVelocity,
} from '@goalrate-app/shared';

// ============================================================================
// STORAGE RESULT TYPES
// ============================================================================

/**
 * Standard result wrapper for all storage operations
 * Enables consistent error handling across platforms
 */
export interface StorageResult<T> {
  success: boolean;
  data?: T;
  error?: StorageError;
}

/**
 * Storage-specific error with context
 */
export interface StorageError {
  code: StorageErrorCode;
  message: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

/**
 * Error codes for storage operations
 */
export type StorageErrorCode =
  | 'VAULT_NOT_FOUND'
  | 'VAULT_NOT_OPEN'
  | 'VAULT_ALREADY_EXISTS'
  | 'VAULT_LOCKED'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'SYNC_CONFLICT'
  | 'STORAGE_FULL'
  | 'ENCRYPTION_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'UNKNOWN_ERROR';

// ============================================================================
// QUERY OPTIONS
// ============================================================================

/**
 * Common query options for list operations
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Goal query filters
 */
export interface GoalQueryOptions extends QueryOptions {
  status?: 'active' | 'completed' | 'archived';
  priority?: 'high' | 'medium' | 'low' | 'critical';
  tags?: string[];
  search?: string;
}

/**
 * Project query filters
 */
export interface ProjectQueryOptions extends QueryOptions {
  status?: 'active' | 'completed' | 'archived' | 'on_hold' | 'planning';
  tags?: string[];
  search?: string;
}

/**
 * Sprint query options
 */
export interface SprintQueryOptions extends QueryOptions {
  status?: 'planning' | 'active' | 'completed' | 'cancelled';
  dateRange?: { start?: string; end?: string };
}

/**
 * Focus query options
 */
export interface FocusQueryOptions {
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/**
 * Search options
 */
export interface SearchOptions {
  types?: ('goal' | 'goal_task' | 'project' | 'focus')[];
  limit?: number;
  minScore?: number;
}

// ============================================================================
// STORAGE ADAPTER INTERFACE
// ============================================================================

/**
 * Core storage adapter interface
 * All platform implementations must implement this interface
 */
export interface StorageAdapter {
  // -------------------------------------------------------------------------
  // Vault Operations
  // -------------------------------------------------------------------------

  /**
   * List all available vaults
   */
  listVaults(): Promise<StorageResult<VaultListItem[]>>;

  /**
   * Open a vault by path (desktop) or ID (web/mobile)
   */
  openVault(identifier: string): Promise<StorageResult<Vault>>;

  /**
   * Create a new vault
   */
  createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>>;

  /**
   * Update vault configuration
   */
  updateVault(vaultId: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>>;

  /**
   * Close the currently open vault
   */
  closeVault(vaultId: string): Promise<StorageResult<void>>;

  /**
   * Delete a vault (with confirmation)
   */
  deleteVault(vaultId: string): Promise<StorageResult<void>>;

  /**
   * Get vault statistics
   */
  getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>>;

  /**
   * Update vault settings
   */
  updateVaultSettings(
    vaultId: string,
    settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>>;

  // -------------------------------------------------------------------------
  // Goal Operations (SMART Goals)
  // -------------------------------------------------------------------------

  /**
   * Get all goals in a vault
   */
  getGoals(vaultId: string, options?: GoalQueryOptions): Promise<StorageResult<SmartGoal[]>>;

  /**
   * Get a single goal by ID
   */
  getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>>;

  /**
   * Create a new goal
   */
  createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>>;

  /**
   * Update an existing goal
   */
  updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>>;

  /**
   * Delete a goal
   */
  deleteGoal(vaultId: string, goalId: string): Promise<StorageResult<void>>;

  /**
   * Archive a goal
   */
  archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>>;

  // -------------------------------------------------------------------------
  // Goal Task Operations
  // -------------------------------------------------------------------------

  /**
   * Get all tasks for a goal
   */
  getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>>;

  /**
   * Get a single goal task
   */
  getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>>;

  /**
   * Create a goal task
   */
  createGoalTask(
    vaultId: string,
    goalId: string,
    task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>>;

  /**
   * Update a goal task
   */
  updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>>;

  /**
   * Delete a goal task
   */
  deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<void>>;

  /**
   * Move a goal task to a different column
   */
  moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    position?: number
  ): Promise<StorageResult<GoalTask>>;

  /**
   * Complete a goal task
   */
  completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>>;

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  /**
   * Get all projects in a vault
   */
  getProjects(
    vaultId: string,
    options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>>;

  /**
   * Get a single project by ID
   */
  getProject(vaultId: string, projectId: string): Promise<StorageResult<Project>>;

  /**
   * Create a new project
   */
  createProject(vaultId: string, data: ProjectCreate): Promise<StorageResult<Project>>;

  /**
   * Update an existing project
   */
  updateProject(
    vaultId: string,
    projectId: string,
    data: ProjectUpdate
  ): Promise<StorageResult<Project>>;

  /**
   * Delete a project
   */
  deleteProject(vaultId: string, projectId: string): Promise<StorageResult<void>>;

  /**
   * Update project board columns
   */
  updateProjectColumns(
    vaultId: string,
    projectId: string,
    columns: BoardColumn[]
  ): Promise<StorageResult<Project>>;

  // -------------------------------------------------------------------------
  // Epic Operations
  // -------------------------------------------------------------------------

  /**
   * Get all epics for a project
   */
  getEpics(vaultId: string, projectId: string): Promise<StorageResult<Epic[]>>;

  /**
   * Get a single epic
   */
  getEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<Epic>>;

  /**
   * Create an epic
   */
  createEpic(
    vaultId: string,
    projectId: string,
    data: EpicCreate
  ): Promise<StorageResult<Epic>>;

  /**
   * Update an epic
   */
  updateEpic(
    vaultId: string,
    projectId: string,
    epicId: string,
    data: EpicUpdate
  ): Promise<StorageResult<Epic>>;

  /**
   * Delete an epic
   */
  deleteEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<void>>;

  // -------------------------------------------------------------------------
  // Sprint Operations
  // -------------------------------------------------------------------------

  /**
   * Get all sprints for a project
   */
  getSprints(
    vaultId: string,
    projectId: string,
    options?: SprintQueryOptions
  ): Promise<StorageResult<Sprint[]>>;

  /**
   * Get a single sprint
   */
  getSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>>;

  /**
   * Create a sprint
   */
  createSprint(
    vaultId: string,
    projectId: string,
    data: SprintCreate
  ): Promise<StorageResult<Sprint>>;

  /**
   * Update a sprint
   */
  updateSprint(
    vaultId: string,
    projectId: string,
    sprintId: string,
    data: SprintUpdate
  ): Promise<StorageResult<Sprint>>;

  /**
   * Delete a sprint
   */
  deleteSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<void>>;

  /**
   * Start a sprint
   */
  startSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>>;

  /**
   * Complete a sprint
   */
  completeSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>>;

  /**
   * Get sprint burndown data
   */
  getSprintBurndown(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>>;

  /**
   * Save sprint retrospective
   */
  saveRetrospective(
    vaultId: string,
    projectId: string,
    sprintId: string,
    retro: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>>;

  // -------------------------------------------------------------------------
  // Focus Day Operations (Today's Focus)
  // -------------------------------------------------------------------------

  /**
   * Get focus day for a specific date
   */
  getFocusDay(vaultId: string, date: string): Promise<StorageResult<FocusDay | null>>;

  /**
   * Create or update focus day
   */
  saveFocusDay(vaultId: string, focusDay: FocusDay): Promise<StorageResult<FocusDay>>;

  /**
   * Get focus history
   */
  getFocusHistory(
    vaultId: string,
    options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>>;

  /**
   * Get focus velocity metrics
   */
  getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>>;

  /**
   * Complete a focus item
   */
  completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>>;

  /**
   * Defer a focus item to another date
   */
  deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>>;

  /**
   * Gather focus candidates from all sources in vault
   */
  gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>>;

  // -------------------------------------------------------------------------
  // Search Operations
  // -------------------------------------------------------------------------

  /**
   * Search across all content in a vault
   */
  search(
    vaultId: string,
    query: string,
    options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>>;

  // -------------------------------------------------------------------------
  // Sync Operations (for Pro+ features)
  // -------------------------------------------------------------------------

  /**
   * Get sync state for a vault
   */
  getSyncState(vaultId: string): Promise<StorageResult<VaultSyncState>>;

  /**
   * Trigger manual sync
   */
  syncVault(vaultId: string): Promise<StorageResult<VaultSyncState>>;

  /**
   * Check if adapter supports sync
   */
  supportsSync(): boolean;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialize the storage adapter
   */
  initialize(): Promise<StorageResult<void>>;

  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

// ============================================================================
// RE-EXPORT TYPES FOR CONVENIENCE
// ============================================================================

export type {
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
};
