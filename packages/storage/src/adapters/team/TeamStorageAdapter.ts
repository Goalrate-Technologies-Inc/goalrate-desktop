/**
 * Team Storage Adapter
 * Wraps ApiStorageAdapter with end-to-end encryption for team vaults
 */

import type { VaultEncryptionConfig } from '@goalrate-app/shared';
import type {
  StorageAdapter,
  StorageResult,
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
import { ApiStorageAdapter } from '../web/ApiStorageAdapter';
import type {
  TeamStorageConfig,
  PendingOperation,
  QueueStats,
  VaultLockState,
} from './types';
import { DEFAULT_TEAM_CONFIG } from './types';
import {
  encryptGoal,
  decryptGoal,
  decryptGoals,
  encryptGoalTask,
  decryptGoalTask,
  decryptGoalTasks,
  encryptProject,
  decryptProject,
  decryptProjects,
  encryptEpic,
  decryptEpic,
  decryptEpics,
  encryptSprint,
  decryptSprint,
  decryptSprints,
  encryptFocusDay,
  decryptFocusDay,
  type EncryptedGoal,
  type EncryptedGoalTask,
  type EncryptedProject,
  type EncryptedEpic,
  type EncryptedSprint,
  type EncryptedFocusDay,
} from './encryption';
import {
  createSession,
  getKey,
  getLockState,
  isUnlocked,
  clearSession,
  clearAllSessions,
  getActiveSessions,
  startSessionCleanup,
  stopSessionCleanup,
} from './keys';

// ============================================================================
// TEAM STORAGE ADAPTER
// ============================================================================

/**
 * Internal config with resolved defaults
 */
interface ResolvedTeamConfig extends TeamStorageConfig {
  maxQueueSize: number;
  operationTimeout: number;
  onLockRequired: (vaultId: string) => void;
  onQueueFlushed: (operationCount: number) => void;
  onEntityChange?: (event: import('./types').EntityChangeEvent) => void;
}

/**
 * Team storage adapter that wraps ApiStorageAdapter with encryption
 */
export class TeamStorageAdapter implements StorageAdapter {
  private api: ApiStorageAdapter;
  private config: ResolvedTeamConfig;
  private pendingOperations: Map<string, PendingOperation[]> = new Map();
  private operationIdCounter = 0;

  constructor(config: TeamStorageConfig) {
    this.api = new ApiStorageAdapter(config);
    this.config = {
      ...config,
      maxQueueSize: config.maxQueueSize ?? DEFAULT_TEAM_CONFIG.maxQueueSize,
      operationTimeout: config.operationTimeout ?? DEFAULT_TEAM_CONFIG.operationTimeout,
      onLockRequired: config.onLockRequired ?? (() => {}),
      onQueueFlushed: config.onQueueFlushed ?? (() => {}),
      onEntityChange: config.onEntityChange ?? undefined,
    };

    // Start session cleanup
    startSessionCleanup();
  }

  /**
   * Emit an entity change event for sync integration
   */
  private emitEntityChange(
    entityType: string,
    entityId: string,
    vaultId: string,
    changeType: 'create' | 'update' | 'delete',
    changes?: Record<string, unknown>,
    version?: number,
  ): void {
    if (this.config.onEntityChange) {
      this.config.onEntityChange({
        entityType,
        entityId,
        vaultId,
        changeType,
        changes,
        version,
      });
    }
  }

  private getEntityVersion(entity: unknown): number | undefined {
    if (entity && typeof entity === 'object' && 'version' in entity) {
      const versionValue = (entity as { version?: unknown }).version;
      return typeof versionValue === 'number' ? versionValue : undefined;
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<StorageResult<void>> {
    return this.api.initialize();
  }

  async dispose(): Promise<void> {
    // Clear all pending operations
    for (const [, operations] of this.pendingOperations.entries()) {
      for (const op of operations) {
        if (op.timeoutId) {
          clearTimeout(op.timeoutId);
        }
        op.reject(new Error('Adapter disposed'));
      }
    }
    this.pendingOperations.clear();

    // Clear all sessions
    clearAllSessions();

    // Stop cleanup
    stopSessionCleanup();

    return this.api.dispose();
  }

  supportsSync(): boolean {
    return true;
  }

  /**
   * Set authentication token
   */
  setAccessToken(token: string | null): void {
    this.api.setAccessToken(token);
  }

  // -------------------------------------------------------------------------
  // Team-Specific Methods
  // -------------------------------------------------------------------------

  /**
   * Unlock a team vault with a password
   */
  async unlockVault(
    vaultId: string,
    password: string,
    encryptionConfig: VaultEncryptionConfig
  ): Promise<void> {
    await createSession(vaultId, password, encryptionConfig);

    // Flush any queued operations
    await this.flushQueue(vaultId);
  }

  /**
   * Lock a team vault
   */
  lockVault(vaultId: string): void {
    clearSession(vaultId);

    // Reject any pending operations
    const operations = this.pendingOperations.get(vaultId) || [];
    for (const op of operations) {
      if (op.timeoutId) {
        clearTimeout(op.timeoutId);
      }
      op.reject(new Error('Vault locked'));
    }
    this.pendingOperations.delete(vaultId);
  }

  /**
   * Check if a vault is unlocked
   */
  isVaultUnlocked(vaultId: string): boolean {
    return isUnlocked(vaultId);
  }

  /**
   * Get the lock state for a vault
   */
  getVaultLockState(vaultId: string): VaultLockState {
    return getLockState(vaultId);
  }

  /**
   * Get queue statistics for a vault
   */
  getQueueStats(vaultId: string): QueueStats {
    const operations = this.pendingOperations.get(vaultId) || [];
    return {
      pendingCount: operations.length,
      oldestOperation: operations.length > 0 ? operations[0].queuedAt : undefined,
      atCapacity: operations.length >= this.config.maxQueueSize,
    };
  }

  /**
   * Get info about all active sessions
   */
  getActiveSessions(): Array<{ vaultId: string; createdAt: Date; state: VaultLockState }> {
    return getActiveSessions();
  }

  // -------------------------------------------------------------------------
  // Operation Queue Management
  // -------------------------------------------------------------------------

  /**
   * Queue an operation for execution when vault is unlocked
   */
  private queueOperation<T>(
    vaultId: string,
    operationType: string,
    execute: () => Promise<T>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const operations = this.pendingOperations.get(vaultId) || [];

      // Check queue capacity
      if (operations.length >= this.config.maxQueueSize) {
        reject(
          createStorageError(
            'UNKNOWN_ERROR',
            'Operation queue is full',
            undefined,
            { code: 'QUEUE_FULL', vaultId, queueSize: operations.length }
          )
        );
        return;
      }

      // Create the operation
      const operation: PendingOperation<T> = {
        id: `op_${++this.operationIdCounter}`,
        vaultId,
        operationType,
        execute,
        resolve: resolve as (value: unknown) => void,
        reject,
        queuedAt: new Date(),
      };

      // Set timeout
      operation.timeoutId = setTimeout(() => {
        this.removeOperation(vaultId, operation.id);
        reject(
          createStorageError(
            'NETWORK_ERROR',
            'Operation timed out waiting for vault unlock',
            undefined,
            { code: 'OPERATION_TIMEOUT', vaultId, operationType }
          )
        );
      }, this.config.operationTimeout);

      // Add to queue (cast to unknown to handle variance)
      operations.push(operation as unknown as PendingOperation);
      this.pendingOperations.set(vaultId, operations);

      // Notify that lock is required
      this.config.onLockRequired(vaultId);
    });
  }

  /**
   * Remove an operation from the queue
   */
  private removeOperation(vaultId: string, operationId: string): void {
    const operations = this.pendingOperations.get(vaultId) || [];
    const index = operations.findIndex((op) => op.id === operationId);
    if (index !== -1) {
      const op = operations[index];
      if (op.timeoutId) {
        clearTimeout(op.timeoutId);
      }
      operations.splice(index, 1);
      this.pendingOperations.set(vaultId, operations);
    }
  }

  /**
   * Flush all queued operations for a vault
   */
  private async flushQueue(vaultId: string): Promise<void> {
    const operations = this.pendingOperations.get(vaultId) || [];
    if (operations.length === 0) {
      return;
    }

    // Clear the queue first
    this.pendingOperations.delete(vaultId);

    // Execute operations in order
    for (const op of operations) {
      if (op.timeoutId) {
        clearTimeout(op.timeoutId);
      }

      try {
        const result = await op.execute();
        op.resolve(result);
      } catch (error) {
        op.reject(error as Error);
      }
    }

    // Notify that queue was flushed
    this.config.onQueueFlushed(operations.length);
  }

  /**
   * Ensure vault is unlocked, or queue the operation
   */
  private async ensureUnlockedOrQueue<T>(
    vaultId: string,
    operationType: string,
    execute: () => Promise<T>
  ): Promise<T> {
    if (isUnlocked(vaultId)) {
      return execute();
    }

    return this.queueOperation(vaultId, operationType, execute);
  }

  /**
   * Get the encryption key for a vault, throwing if not available
   */
  private getKeyOrThrow(vaultId: string): CryptoKey {
    const key = getKey(vaultId);
    if (!key) {
      throw createStorageError(
        'PERMISSION_DENIED',
        'Vault is locked',
        undefined,
        { code: 'VAULT_LOCKED', vaultId }
      );
    }
    return key;
  }

  // -------------------------------------------------------------------------
  // Vault Operations (passthrough - no encryption needed)
  // -------------------------------------------------------------------------

  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    return this.api.listVaults();
  }

  async openVault(identifier: string): Promise<StorageResult<Vault>> {
    return this.api.openVault(identifier);
  }

  async createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    return this.api.createVault(data);
  }

  async updateVault(vaultId: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    return this.api.updateVault(vaultId, data);
  }

  async closeVault(vaultId: string): Promise<StorageResult<void>> {
    // Lock the vault when closing
    this.lockVault(vaultId);
    return this.api.closeVault(vaultId);
  }

  async deleteVault(vaultId: string): Promise<StorageResult<void>> {
    // Lock the vault when deleting
    this.lockVault(vaultId);
    return this.api.deleteVault(vaultId);
  }

  async getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>> {
    return this.api.getVaultStats(vaultId);
  }

  async updateVaultSettings(
    vaultId: string,
    settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    return this.api.updateVaultSettings(vaultId, settings);
  }

  // -------------------------------------------------------------------------
  // Goal Operations (with encryption)
  // -------------------------------------------------------------------------

  async getGoals(
    vaultId: string,
    options?: GoalQueryOptions
  ): Promise<StorageResult<SmartGoal[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getGoals', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getGoals(vaultId, options);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoals(result.data as unknown as EncryptedGoal[], key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goals', error as Error)
        );
      }
    });
  }

  async getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getGoal', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getGoal(vaultId, goalId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoal(result.data as unknown as EncryptedGoal, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goal', error as Error)
        );
      }
    });
  }

  async createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    return this.ensureUnlockedOrQueue(vaultId, 'createGoal', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        // Encrypt the goal data before sending
        const encrypted = await encryptGoal(data as unknown as SmartGoal, key);
        const result = await this.api.createGoal(vaultId, encrypted as unknown as GoalCreate);

        if (!result.success) {
          return result;
        }

        // Decrypt the response
        const decrypted = await decryptGoal(result.data as unknown as EncryptedGoal, key);

        // Emit entity change event for sync integration
        this.emitEntityChange('goal', decrypted.id, vaultId, 'create', undefined, this.getEntityVersion(decrypted));

        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt goal', error as Error)
        );
      }
    });
  }

  async updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateGoal', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        // Encrypt the update data (partial encryption)
        const encryptedData: Record<string, unknown> = { ...data };
        if (data.title) {
          const { encryptValue } = await import('./encryption');
          encryptedData.title = await encryptValue(data.title, key);
        }

        const result = await this.api.updateGoal(vaultId, goalId, encryptedData as GoalUpdate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptGoal(result.data as unknown as EncryptedGoal, key);

        // Emit entity change event for sync integration
        this.emitEntityChange('goal', goalId, vaultId, 'update', data as Record<string, unknown>, this.getEntityVersion(decrypted));

        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to update goal', error as Error)
        );
      }
    });
  }

  async deleteGoal(vaultId: string, goalId: string): Promise<StorageResult<void>> {
    // Delete doesn't need encryption, but should wait for unlock
    return this.ensureUnlockedOrQueue(vaultId, 'deleteGoal', async () => {
      const result = await this.api.deleteGoal(vaultId, goalId);

      if (result.success) {
        // Emit entity change event for sync integration
        this.emitEntityChange('goal', goalId, vaultId, 'delete');
      }

      return result;
    });
  }

  async archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.updateGoal(vaultId, goalId, { status: 'archived' });
  }

  // -------------------------------------------------------------------------
  // Goal Task Operations (with encryption)
  // -------------------------------------------------------------------------

  async getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getGoalTasks', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getGoalTasks(vaultId, goalId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoalTasks(result.data as unknown as EncryptedGoalTask[], key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goal tasks', error as Error)
        );
      }
    });
  }

  async getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getGoalTask', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getGoalTask(vaultId, goalId, taskId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoalTask(result.data as unknown as EncryptedGoalTask, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goal task', error as Error)
        );
      }
    });
  }

  async createGoalTask(
    vaultId: string,
    goalId: string,
    task: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    return this.ensureUnlockedOrQueue(vaultId, 'createGoalTask', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encrypted = await encryptGoalTask({ ...task, id: '' } as GoalTask, key);
        const result = await this.api.createGoalTask(vaultId, goalId, encrypted as unknown as Omit<GoalTask, 'id'>);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptGoalTask(result.data as unknown as EncryptedGoalTask, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt goal task', error as Error)
        );
      }
    });
  }

  async updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateGoalTask', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encryptedData: Record<string, unknown> = { ...data };
        if (data.title) {
          const { encryptValue } = await import('./encryption');
          encryptedData.title = await encryptValue(data.title, key);
        }

        const result = await this.api.updateGoalTask(vaultId, goalId, taskId, encryptedData as Partial<GoalTask>);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptGoalTask(result.data as unknown as EncryptedGoalTask, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to update goal task', error as Error)
        );
      }
    });
  }

  async deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<void>> {
    return this.ensureUnlockedOrQueue(vaultId, 'deleteGoalTask', () =>
      this.api.deleteGoalTask(vaultId, goalId, taskId)
    );
  }

  async moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    position?: number
  ): Promise<StorageResult<GoalTask>> {
    return this.ensureUnlockedOrQueue(vaultId, 'moveGoalTask', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.moveGoalTask(vaultId, goalId, taskId, targetColumn, position);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoalTask(result.data as unknown as EncryptedGoalTask, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goal task', error as Error)
        );
      }
    });
  }

  async completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return this.ensureUnlockedOrQueue(vaultId, 'completeGoalTask', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.completeGoalTask(vaultId, goalId, taskId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptGoalTask(result.data as unknown as EncryptedGoalTask, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt goal task', error as Error)
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Project Operations (with encryption)
  // -------------------------------------------------------------------------

  async getProjects(
    vaultId: string,
    options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getProjects', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getProjects(vaultId, options);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptProjects(result.data as unknown as EncryptedProject[], key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt projects', error as Error)
        );
      }
    });
  }

  async getProject(vaultId: string, projectId: string): Promise<StorageResult<Project>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getProject', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getProject(vaultId, projectId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptProject(result.data as unknown as EncryptedProject, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt project', error as Error)
        );
      }
    });
  }

  async createProject(vaultId: string, data: ProjectCreate): Promise<StorageResult<Project>> {
    return this.ensureUnlockedOrQueue(vaultId, 'createProject', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encrypted = await encryptProject(data as unknown as Project, key);
        const result = await this.api.createProject(vaultId, encrypted as unknown as ProjectCreate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptProject(result.data as unknown as EncryptedProject, key);

        // Emit entity change event for sync integration
        this.emitEntityChange('project', decrypted.id, vaultId, 'create', undefined, this.getEntityVersion(decrypted));

        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt project', error as Error)
        );
      }
    });
  }

  async updateProject(
    vaultId: string,
    projectId: string,
    data: ProjectUpdate
  ): Promise<StorageResult<Project>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateProject', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encryptedData: Record<string, unknown> = { ...data };
        const { encryptValue } = await import('./encryption');

        if (data.name) {
          encryptedData.name = await encryptValue(data.name, key);
        }
        if (data.description) {
          encryptedData.description = await encryptValue(data.description, key);
        }

        const result = await this.api.updateProject(vaultId, projectId, encryptedData as ProjectUpdate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptProject(result.data as unknown as EncryptedProject, key);

        // Emit entity change event for sync integration
        this.emitEntityChange('project', projectId, vaultId, 'update', data as Record<string, unknown>, this.getEntityVersion(decrypted));

        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to update project', error as Error)
        );
      }
    });
  }

  async deleteProject(vaultId: string, projectId: string): Promise<StorageResult<void>> {
    return this.ensureUnlockedOrQueue(vaultId, 'deleteProject', async () => {
      const result = await this.api.deleteProject(vaultId, projectId);

      if (result.success) {
        // Emit entity change event for sync integration
        this.emitEntityChange('project', projectId, vaultId, 'delete');
      }

      return result;
    });
  }

  async updateProjectColumns(
    vaultId: string,
    projectId: string,
    columns: BoardColumn[]
  ): Promise<StorageResult<Project>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateProjectColumns', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.updateProjectColumns(vaultId, projectId, columns);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptProject(result.data as unknown as EncryptedProject, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt project', error as Error)
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Epic Operations (with encryption)
  // -------------------------------------------------------------------------

  async getEpics(vaultId: string, projectId: string): Promise<StorageResult<Epic[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getEpics', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getEpics(vaultId, projectId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptEpics(result.data as unknown as EncryptedEpic[], key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt epics', error as Error)
        );
      }
    });
  }

  async getEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<Epic>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getEpic', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getEpic(vaultId, projectId, epicId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptEpic(result.data as unknown as EncryptedEpic, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt epic', error as Error)
        );
      }
    });
  }

  async createEpic(
    vaultId: string,
    projectId: string,
    data: EpicCreate
  ): Promise<StorageResult<Epic>> {
    return this.ensureUnlockedOrQueue(vaultId, 'createEpic', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encrypted = await encryptEpic(data as unknown as Epic, key);
        const result = await this.api.createEpic(vaultId, projectId, encrypted as unknown as EpicCreate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptEpic(result.data as unknown as EncryptedEpic, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt epic', error as Error)
        );
      }
    });
  }

  async updateEpic(
    vaultId: string,
    projectId: string,
    epicId: string,
    data: EpicUpdate
  ): Promise<StorageResult<Epic>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateEpic', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encryptedData: Record<string, unknown> = { ...data };
        const { encryptValue } = await import('./encryption');

        if (data.title) {
          encryptedData.title = await encryptValue(data.title, key);
        }
        if (data.description) {
          encryptedData.description = await encryptValue(data.description, key);
        }

        const result = await this.api.updateEpic(vaultId, projectId, epicId, encryptedData as EpicUpdate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptEpic(result.data as unknown as EncryptedEpic, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to update epic', error as Error)
        );
      }
    });
  }

  async deleteEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<void>> {
    return this.ensureUnlockedOrQueue(vaultId, 'deleteEpic', () =>
      this.api.deleteEpic(vaultId, projectId, epicId)
    );
  }

  // -------------------------------------------------------------------------
  // Sprint Operations (with encryption)
  // -------------------------------------------------------------------------

  async getSprints(vaultId: string, projectId: string): Promise<StorageResult<Sprint[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getSprints', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getSprints(vaultId, projectId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptSprints(result.data as unknown as EncryptedSprint[], key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt sprints', error as Error)
        );
      }
    });
  }

  async getSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getSprint', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getSprint(vaultId, projectId, sprintId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptSprint(result.data as unknown as EncryptedSprint, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt sprint', error as Error)
        );
      }
    });
  }

  async createSprint(
    vaultId: string,
    projectId: string,
    data: SprintCreate
  ): Promise<StorageResult<Sprint>> {
    return this.ensureUnlockedOrQueue(vaultId, 'createSprint', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encrypted = await encryptSprint(data as unknown as Sprint, key);
        const result = await this.api.createSprint(vaultId, projectId, encrypted as unknown as SprintCreate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptSprint(result.data as unknown as EncryptedSprint, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt sprint', error as Error)
        );
      }
    });
  }

  async updateSprint(
    vaultId: string,
    projectId: string,
    sprintId: string,
    data: SprintUpdate
  ): Promise<StorageResult<Sprint>> {
    return this.ensureUnlockedOrQueue(vaultId, 'updateSprint', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encryptedData: Record<string, unknown> = { ...data };
        const { encryptValue } = await import('./encryption');

        if (data.name) {
          encryptedData.name = await encryptValue(data.name, key);
        }
        if (data.goal) {
          encryptedData.goal = await encryptValue(data.goal, key);
        }

        const result = await this.api.updateSprint(vaultId, projectId, sprintId, encryptedData as SprintUpdate);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptSprint(result.data as unknown as EncryptedSprint, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to update sprint', error as Error)
        );
      }
    });
  }

  async deleteSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<void>> {
    return this.ensureUnlockedOrQueue(vaultId, 'deleteSprint', () =>
      this.api.deleteSprint(vaultId, projectId, sprintId)
    );
  }

  async startSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.ensureUnlockedOrQueue(vaultId, 'startSprint', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.startSprint(vaultId, projectId, sprintId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptSprint(result.data as unknown as EncryptedSprint, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt sprint', error as Error)
        );
      }
    });
  }

  async completeSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.ensureUnlockedOrQueue(vaultId, 'completeSprint', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.completeSprint(vaultId, projectId, sprintId);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptSprint(result.data as unknown as EncryptedSprint, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt sprint', error as Error)
        );
      }
    });
  }

  async getSprintBurndown(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>> {
    // Burndown data doesn't contain sensitive content
    return this.ensureUnlockedOrQueue(vaultId, 'getSprintBurndown', () =>
      this.api.getSprintBurndown(vaultId, projectId, sprintId)
    );
  }

  async saveRetrospective(
    vaultId: string,
    projectId: string,
    sprintId: string,
    retro: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>> {
    return this.ensureUnlockedOrQueue(vaultId, 'saveRetrospective', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const { encryptArray, encryptValue } = await import('./encryption');

        // Encrypt action items (RetrospectiveAction[]) - need to encrypt description field
        const encryptedActionItems = await Promise.all(
          (retro.action_items || []).map(async (item) => ({
            ...item,
            description: await encryptValue(item.description, key),
          }))
        );

        const encryptedRetro = {
          ...retro,
          went_well: await encryptArray(retro.went_well || [], key),
          to_improve: await encryptArray(retro.to_improve || [], key),
          action_items: encryptedActionItems,
        };

        const result = await this.api.saveRetrospective(
          vaultId,
          projectId,
          sprintId,
          encryptedRetro as unknown as Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
        );

        if (!result.success || !result.data) {
          return result;
        }

        // Decrypt the response
        const { decryptArray, decryptValue } = await import('./encryption');
        const decryptedActionItems = await Promise.all(
          (result.data.action_items || []).map(async (item) => ({
            ...item,
            description: await decryptValue(item.description as unknown as import('./types').EncryptedString, key),
          }))
        );

        const decrypted: Retrospective = {
          ...result.data,
          went_well: await decryptArray((result.data.went_well || []) as unknown as import('./types').EncryptedString[], key),
          to_improve: await decryptArray((result.data.to_improve || []) as unknown as import('./types').EncryptedString[], key),
          action_items: decryptedActionItems,
        };

        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt retrospective', error as Error)
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Focus Day Operations (with encryption)
  // -------------------------------------------------------------------------

  async getFocusDay(vaultId: string, date: string): Promise<StorageResult<FocusDay | null>> {
    return this.ensureUnlockedOrQueue(vaultId, 'getFocusDay', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.getFocusDay(vaultId, date);

      if (!result.success) {
        return result;
      }

      if (result.data === null) {
        return wrapSuccess(null);
      }

      try {
        const decrypted = await decryptFocusDay(result.data as unknown as EncryptedFocusDay, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt focus day', error as Error)
        );
      }
    });
  }

  async saveFocusDay(vaultId: string, focusDay: FocusDay): Promise<StorageResult<FocusDay>> {
    return this.ensureUnlockedOrQueue(vaultId, 'saveFocusDay', async () => {
      const key = this.getKeyOrThrow(vaultId);

      try {
        const encrypted = await encryptFocusDay(focusDay, key);
        const result = await this.api.saveFocusDay(vaultId, encrypted as unknown as FocusDay);

        if (!result.success) {
          return result;
        }

        const decrypted = await decryptFocusDay(result.data as unknown as EncryptedFocusDay, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to encrypt focus day', error as Error)
        );
      }
    });
  }

  async getFocusHistory(
    vaultId: string,
    options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    // Focus history contains minimal sensitive data (dates, points)
    return this.ensureUnlockedOrQueue(vaultId, 'getFocusHistory', () =>
      this.api.getFocusHistory(vaultId, options)
    );
  }

  async getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>> {
    // Velocity is computed data, no sensitive content
    return this.ensureUnlockedOrQueue(vaultId, 'getFocusVelocity', () =>
      this.api.getFocusVelocity(vaultId)
    );
  }

  async completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    return this.ensureUnlockedOrQueue(vaultId, 'completeFocusItem', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.completeFocusItem(vaultId, date, itemSource);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptFocusDay(result.data as unknown as EncryptedFocusDay, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt focus day', error as Error)
        );
      }
    });
  }

  async deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    return this.ensureUnlockedOrQueue(vaultId, 'deferFocusItem', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.deferFocusItem(vaultId, date, itemSource, deferTo);

      if (!result.success) {
        return result;
      }

      try {
        const decrypted = await decryptFocusDay(result.data as unknown as EncryptedFocusDay, key);
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt focus day', error as Error)
        );
      }
    });
  }

  async gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    return this.ensureUnlockedOrQueue(vaultId, 'gatherFocusCandidates', async () => {
      const key = this.getKeyOrThrow(vaultId);
      const result = await this.api.gatherFocusCandidates(vaultId);

      if (!result.success || !result.data) {
        return result;
      }

      try {
        // Decrypt candidate titles
        const { decryptValue } = await import('./encryption');
        const decrypted = await Promise.all(
          result.data.map(async (candidate) => ({
            ...candidate,
            title: await decryptValue(candidate.title as unknown as import('./types').EncryptedString, key),
          }))
        );
        return wrapSuccess(decrypted);
      } catch (error) {
        return wrapError(
          createStorageError('ENCRYPTION_ERROR', 'Failed to decrypt focus candidates', error as Error)
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Search Operations (limited due to encryption)
  // -------------------------------------------------------------------------

  async search(
    vaultId: string,
    query: string,
    options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    // Note: Server-side search is limited because content is encrypted
    // Full-text search would need to be done client-side after decryption
    // For now, we can only search by metadata (IDs, dates, status)
    return this.ensureUnlockedOrQueue(vaultId, 'search', () =>
      this.api.search(vaultId, query, options)
    );
  }

  // -------------------------------------------------------------------------
  // Sync Operations (passthrough)
  // -------------------------------------------------------------------------

  async getSyncState(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.api.getSyncState(vaultId);
  }

  async syncVault(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return this.api.syncVault(vaultId);
  }
}
