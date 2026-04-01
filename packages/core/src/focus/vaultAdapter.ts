/**
 * Vault task source adapter contract for Desktop Focus List aggregation.
 *
 * The adapter abstracts how raw tasks are loaded from vault-backed sources.
 */

import type { FocusListTask } from './listFilter';

/**
 * Request shape used by vault task source adapters.
 */
export interface VaultTaskSourceRequest {
  userId: string;
  openVaultIds: string[];
}

/**
 * Adapter interface for retrieving candidate tasks from vault sources.
 */
export interface VaultTaskSourceAdapter {
  listTasksForUser(
    request: VaultTaskSourceRequest
  ): FocusListTask[] | Promise<FocusListTask[]>;
}

/**
 * Input for loading tasks from a VaultTaskSourceAdapter.
 */
export interface LoadTasksFromVaultAdapterInput extends VaultTaskSourceRequest {
  adapter: VaultTaskSourceAdapter;
}

/**
 * Loads tasks through the adapter and enforces open-vault scoping.
 */
export async function loadTasksFromVaultAdapter({
  adapter,
  userId,
  openVaultIds,
}: LoadTasksFromVaultAdapterInput): Promise<FocusListTask[]> {
  const normalizedOpenVaultIds = [...new Set(openVaultIds.filter(Boolean))];
  if (normalizedOpenVaultIds.length === 0) {
    return [];
  }

  const tasks = await adapter.listTasksForUser({
    userId,
    openVaultIds: normalizedOpenVaultIds,
  });

  const openVaultIdSet = new Set(normalizedOpenVaultIds);
  return tasks.filter((task) => openVaultIdSet.has(task.vaultId));
}
