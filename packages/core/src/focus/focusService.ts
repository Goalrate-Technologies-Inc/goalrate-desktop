/**
 * Desktop Focus List aggregation service.
 *
 * Aggregation flow:
 * 1) Filter eligible tasks for the current user and open vaults
 * 2) Sort deterministically by due/deadline and priority
 * 3) Greedily pack within capacity
 * 4) Materialize a FocusListDay payload
 */

import type {
  FocusDayStats,
  FocusListDay,
  FocusListCloseDayResult,
  FocusListEntry,
  FocusListEntryStatus,
} from '@goalrate-app/shared';
import {
  filterFocusListTasks,
  type FocusListTask,
  type FocusListTaskStatus,
} from './listFilter';
import { sortFocusListTasks } from './listSorter';
import { packFocusListTasks } from './listPacker';
import {
  calculateNextCapacitySPWithDebug,
  type CapacityEngineDebugControlsInput,
} from './capacityEngine';
import {
  loadTasksFromVaultAdapter,
  type VaultTaskSourceAdapter,
} from './vaultAdapter';

/**
 * Input payload for FocusService.aggregate.
 */
export interface FocusServiceAggregateInput {
  userId: string;
  openVaultIds: string[];
  tasks: FocusListTask[];
  date: string;
  capacitySP: number;
  generatedAt?: string;
  eligibleStatuses?: FocusListTaskStatus[];
}

/**
 * Input payload for FocusService.aggregateFromVaults.
 */
export interface FocusServiceAggregateFromVaultsInput {
  userId: string;
  openVaultIds: string[];
  date: string;
  capacitySP: number;
  generatedAt?: string;
  eligibleStatuses?: FocusListTaskStatus[];
}

/**
 * Output payload for FocusService.aggregate.
 */
export interface FocusServiceAggregateResult {
  focusListDay: FocusListDay;
  overflowTasks: FocusListTask[];
}

/**
 * Input payload for FocusService.closeDay.
 */
export interface FocusServiceCloseDayInput
  extends Pick<
    CapacityEngineDebugControlsInput,
    'currentCapacitySP' | 'profile' | 'debug'
  > {
  date: string;
  stats: FocusDayStats;
}

function toFocusListEntryStatus(status: FocusListTaskStatus): FocusListEntryStatus {
  if (status === 'in_progress') {
    return 'in_progress';
  }

  if (status === 'done') {
    return 'done';
  }

  return 'todo';
}

function buildFocusListEntryId(date: string, taskId: string): string {
  return `focus_${date}_${taskId}`;
}

function toFocusListEntry(date: string, task: FocusListTask): FocusListEntry {
  return {
    id: buildFocusListEntryId(date, task.id),
    taskId: task.id,
    vaultId: task.vaultId,
    title: task.title,
    dueAt: task.deadlineAt ?? task.dueAt,
    priority: task.priority,
    storyPoints: task.storyPoints,
    status: toFocusListEntryStatus(task.status),
  };
}

/**
 * Core Desktop Focus List aggregation service.
 */
export class FocusService {
  constructor(private readonly vaultAdapter?: VaultTaskSourceAdapter) {}

  closeDay(input: FocusServiceCloseDayInput): FocusListCloseDayResult {
    return {
      nextCapacitySP: calculateNextCapacitySPWithDebug({
        currentCapacitySP: input.currentCapacitySP,
        stats: { allDone: input.stats.allDone },
        profile: input.profile,
        debug: input.debug,
      }),
    };
  }

  async aggregateFromVaults(
    input: FocusServiceAggregateFromVaultsInput
  ): Promise<FocusServiceAggregateResult> {
    if (!this.vaultAdapter) {
      throw new Error(
        'FocusService.aggregateFromVaults requires a VaultTaskSourceAdapter.'
      );
    }

    const tasks = await loadTasksFromVaultAdapter({
      adapter: this.vaultAdapter,
      userId: input.userId,
      openVaultIds: input.openVaultIds,
    });

    return this.aggregate({
      ...input,
      tasks,
    });
  }

  aggregate(input: FocusServiceAggregateInput): FocusServiceAggregateResult {
    const filteredTasks = filterFocusListTasks({
      tasks: input.tasks,
      userId: input.userId,
      openVaultIds: input.openVaultIds,
      eligibleStatuses: input.eligibleStatuses,
    });

    const sortedTasks = sortFocusListTasks(filteredTasks);
    const packed = packFocusListTasks({
      tasks: sortedTasks,
      capacitySP: input.capacitySP,
    });

    const entries = packed.packedTasks.map((task) =>
      toFocusListEntry(input.date, task)
    );
    const generatedAt = input.generatedAt ?? new Date().toISOString();

    return {
      focusListDay: {
        date: input.date,
        capacitySP: input.capacitySP,
        packedSP: packed.packedSP,
        plannedCount: entries.length,
        completedCount: 0,
        completedSP: 0,
        entries,
        generatedAt,
      },
      overflowTasks: packed.overflowTasks,
    };
  }
}

/**
 * Default service instance for direct use.
 */
export const focusService = new FocusService();
