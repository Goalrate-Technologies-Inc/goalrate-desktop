/**
 * Vaults Client
 * Handles vault CRUD operations and vault statistics
 */

import type { HttpClient } from '../http';
import type { PaginatedResponse, ListParams } from '../types';
import type { VaultConfig, VaultSettings } from '@goalrate-app/shared';

/**
 * Vault list item
 */
export interface VaultListItem {
  id: string;
  name: string;
  path?: string;
  type: 'private' | 'public' | 'team';
  createdAt: string;
  updatedAt?: string;
  syncEnabled?: boolean;
  encrypted?: boolean;
}

/**
 * Vault creation data
 */
export interface VaultCreate {
  name: string;
  type: 'private' | 'public' | 'team';
  path?: string;
  workspaceId?: string;
  encrypted?: boolean;
}

/**
 * Vault update data
 */
export interface VaultUpdate {
  name?: string;
  settings?: Partial<VaultSettings>;
  syncEnabled?: boolean;
}

/**
 * Vault statistics
 */
export interface VaultStats {
  goalCount: number;
  projectCount: number;
  taskCount: number;
  completedTaskCount: number;
  totalPoints: number;
  completedPoints: number;
  syncStatus?: 'synced' | 'syncing' | 'pending' | 'error';
  lastSyncAt?: string;
}

/**
 * Vaults client for vault operations
 */
export class VaultClient {
  constructor(private http: HttpClient) {}

  /**
   * List all vaults accessible to the current user
   */
  async list(params?: ListParams): Promise<PaginatedResponse<VaultListItem>> {
    const response = await this.http.get<PaginatedResponse<VaultListItem>>(
      '/api/vaults',
      params
    );
    return response.data;
  }

  /**
   * Get a specific vault by ID
   */
  async get(vaultId: string): Promise<VaultConfig> {
    const response = await this.http.get<VaultConfig>(`/api/vaults/${vaultId}`);
    return response.data;
  }

  /**
   * Create a new vault
   */
  async create(data: VaultCreate): Promise<VaultConfig> {
    const response = await this.http.post<VaultConfig>('/api/vaults', data);
    return response.data;
  }

  /**
   * Update a vault
   */
  async update(vaultId: string, data: VaultUpdate): Promise<VaultConfig> {
    const response = await this.http.patch<VaultConfig>(
      `/api/vaults/${vaultId}`,
      data
    );
    return response.data;
  }

  /**
   * Delete a vault
   */
  async delete(vaultId: string): Promise<void> {
    await this.http.delete<void>(`/api/vaults/${vaultId}`);
  }

  /**
   * Get vault statistics
   */
  async getStats(vaultId: string): Promise<VaultStats> {
    const response = await this.http.get<VaultStats>(
      `/api/vaults/${vaultId}/stats`
    );
    return response.data;
  }

  /**
   * Enable sync for a vault (Pro and higher)
   */
  async enableSync(vaultId: string): Promise<VaultConfig> {
    const response = await this.http.post<VaultConfig>(
      `/api/vaults/${vaultId}/sync/enable`
    );
    return response.data;
  }

  /**
   * Disable sync for a vault
   */
  async disableSync(vaultId: string): Promise<VaultConfig> {
    const response = await this.http.post<VaultConfig>(
      `/api/vaults/${vaultId}/sync/disable`
    );
    return response.data;
  }

  /**
   * Trigger manual sync for a vault
   */
  async triggerSync(vaultId: string): Promise<void> {
    await this.http.post<void>(`/api/vaults/${vaultId}/sync`);
  }

  /**
   * Get sync status for a vault
   */
  async getSyncStatus(vaultId: string): Promise<{
    status: 'synced' | 'syncing' | 'pending' | 'error';
    lastSyncAt?: string;
    pendingChanges: number;
    error?: string;
  }> {
    const response = await this.http.get<{
      status: 'synced' | 'syncing' | 'pending' | 'error';
      lastSyncAt?: string;
      pendingChanges: number;
      error?: string;
    }>(`/api/vaults/${vaultId}/sync/status`);
    return response.data;
  }
}
