/**
 * Vault Types
 * Local-first vault management types for the Tauri desktop application
 * Based on PRD specification for Obsidian-style vault management
 */

// ============================================================================
// VAULT CONFIGURATION TYPES
// ============================================================================

/**
 * Vault type determines sync and visibility behavior
 */
export type VaultType = 'private' | 'public' | 'team';

/**
 * Key derivation algorithm identifier
 */
export type KeyDerivationAlgorithm = 'PBKDF2-SHA256';

/**
 * Encryption configuration for team vaults
 * Stores key derivation parameters needed to reconstruct the encryption key
 */
export interface VaultEncryptionConfig {
  /** Base64 encoded salt used for key derivation */
  salt: string;
  /** Number of PBKDF2 iterations (typically 100,000) */
  iterations: number;
  /** Key derivation algorithm identifier */
  algorithm: KeyDerivationAlgorithm;
  /** When encryption was first enabled (ISO date string) */
  createdAt: string;
}

/**
 * Vault configuration stored in .vault.json
 */
export interface VaultConfig {
  id: string; // Format: vault_UUID
  name: string;
  path: string; // Absolute path to vault directory
  type: VaultType;
  created: string; // ISO date
  lastOpened?: string; // ISO date
  // Optional sync configuration (Pro+ features)
  syncEnabled?: boolean;
  syncLastAt?: string;
  remoteId?: string; // Server-side vault ID for sync
  // Encryption configuration (Team+ features)
  /** Whether this vault is encrypted */
  encrypted?: boolean;
  /** Encryption parameters (required if encrypted is true) */
  encryptionConfig?: VaultEncryptionConfig;
}

/**
 * Full vault information including content references
 */
export interface Vault extends VaultConfig {
  goals: string[]; // Goal IDs in this vault
  projects: string[]; // Project IDs in this vault
  focusDays: string[]; // Focus day IDs in this vault
}

// ============================================================================
// VAULT SETTINGS TYPES
// ============================================================================

/**
 * Vault-level settings stored in vault config
 */
export interface VaultSettings {
  // Default columns for new goals
  defaultGoalColumns?: VaultColumn[];
  // Default columns for new projects
  defaultProjectColumns?: VaultColumn[];
  // Focus preferences
  defaultPointCapacity?: number;
  defaultAvailableHours?: number;
  // UI preferences
  defaultView?: 'list' | 'kanban' | 'calendar';
  showCompletedItems?: boolean;
  // Sync preferences (Pro+)
  autoSync?: boolean;
  syncInterval?: number; // minutes
}

/**
 * Column configuration for vault defaults
 */
export interface VaultColumn {
  id: string;
  name: string;
  wip?: number;
  color?: string;
}

// ============================================================================
// VAULT FILE STRUCTURE TYPES
// ============================================================================

/**
 * Vault directory structure metadata
 */
export interface VaultStructure {
  vaultId: string;
  path: string;
  directories: {
    goals: string; // Path to goals directory
    projects: string; // Path to projects directory
    focus: string; // Path to focus directory
  };
  indexPath: string; // Path to SQLite index (.goalrate/index.db)
  configPath: string; // Path to vault config (.vault.json)
}

/**
 * File metadata for vault items
 */
export interface VaultFileMetadata {
  path: string;
  relativePath: string;
  filename: string;
  type: 'goal' | 'goal_task' | 'project' | 'focus';
  lastModified: string;
  size: number;
}

// ============================================================================
// VAULT OPERATIONS TYPES
// ============================================================================

/**
 * Data for creating a new vault
 */
export interface VaultCreate {
  name: string;
  path: string;
  type: VaultType;
  settings?: Partial<VaultSettings>;
}

/**
 * Data for updating vault configuration
 */
export interface VaultUpdate {
  name?: string;
  type?: VaultType;
  settings?: Partial<VaultSettings>;
  syncEnabled?: boolean;
}

/**
 * Vault list item for the vault selector
 */
export interface VaultListItem {
  id: string;
  name: string;
  path: string;
  type: VaultType;
  lastOpened?: string;
  goalCount: number;
  projectCount: number;
  isSynced: boolean;
}

// ============================================================================
// VAULT SYNC TYPES (Pro+ features)
// ============================================================================

/**
 * Sync status for a vault
 */
export type SyncStatus = 'synced' | 'syncing' | 'pending' | 'error' | 'offline';

/**
 * Sync state information
 */
export interface VaultSyncState {
  vaultId: string;
  status: SyncStatus;
  lastSyncAt?: string;
  pendingChanges: number;
  error?: string;
  progress?: number; // 0-100 during sync
}

/**
 * Sync conflict for manual resolution
 */
export interface VaultSyncConflict {
  id: string;
  vaultId: string;
  filePath: string;
  localVersion: string;
  remoteVersion: string;
  localModified: string;
  remoteModified: string;
  resolution?: 'local' | 'remote' | 'merged';
}

// ============================================================================
// VAULT INDEX TYPES
// ============================================================================

/**
 * Search result from vault index
 */
export interface VaultSearchResult {
  id: string;
  type: 'goal' | 'goal_task' | 'project' | 'focus';
  title: string;
  snippet: string;
  path: string;
  relevanceScore: number;
}

/**
 * Vault statistics from index
 */
export interface VaultStats {
  vaultId: string;
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  totalProjects: number;
  activeProjects: number;
  totalTasks: number;
  completedTasks: number;
  totalStories: number;
  focusDaysTracked: number;
  averageCompletionRate: number;
  lastUpdated: string;
}
