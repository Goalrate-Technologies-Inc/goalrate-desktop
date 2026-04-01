/**
 * Focus Generator
 * Generate Today's Focus list from candidates with capacity constraints
 */

import type {
  FocusCandidate,
  FocusItem,
  FocusDay,
  FocusGeneratorOptions,
  Goal,
  GoalTask,
} from '@goalrate-app/shared';
import { calculatePointCapacity } from '@goalrate-app/shared/constants';
import { scoreFocusCandidate } from './scoring';
import { generateFocusReason } from './reasons';
import { toISODateString } from '../utils/dates';

/**
 * Result of focus generation
 */
export interface FocusGeneratorResult {
  /** Selected items that fit within capacity */
  items: FocusItem[];
  /** Total points of selected items */
  totalPoints: number;
  /** Percentage of capacity used */
  capacityUsed: number;
  /** Items that didn't fit within capacity (sorted by score) */
  overflow: FocusItem[];
}

/**
 * Options for gathering candidates
 */
export interface GatherCandidatesOptions {
  /** Exclude tasks from these goals */
  excludeGoalIds?: string[];
}

/**
 * Gather focus candidates from goals
 *
 * @param goals - Array of goals with their tasks
 * @param options - Gathering options
 * @returns Array of focus candidates
 */
export function gatherCandidatesFromGoals(
  goals: Array<Goal & { tasks?: GoalTask[] }>,
  options: GatherCandidatesOptions = {}
): FocusCandidate[] {
  const candidates: FocusCandidate[] = [];

  for (const goal of goals) {
    // Skip excluded goals
    if (options.excludeGoalIds?.includes(goal.id)) {
      continue;
    }

    // Process tasks
    const tasks = goal.tasks ?? [];
    for (const task of tasks) {
      // Skip completed tasks (GoalTask uses camelCase: completedAt)
      if (task.column === 'done' || task.completedAt) {
        continue;
      }

      candidates.push({
        id: task.id,
        type: 'goal_task',
        title: task.title,
        points: task.points || 1,
        priority: task.priority || 'medium',
        dueDate: task.dueDate, // GoalTask uses camelCase
        blocks: [], // Goal tasks don't typically have blocking info
        blocksPeople: false,
        inCurrentSprint: false,
        lastActivity: undefined,
        goalId: goal.id,
        goalTitle: goal.title,
      });
    }
  }

  return candidates;
}

/**
 * Gather all focus candidates from goals
 *
 * @param goals - Array of goals with tasks
 * @param options - Gathering options
 * @returns Combined array of focus candidates
 */
export function gatherFocusCandidates(
  goals: Array<Goal & { tasks?: GoalTask[] }>,
  options: GatherCandidatesOptions = {}
): FocusCandidate[] {
  return gatherCandidatesFromGoals(goals, options);
}

/**
 * Generate Today's Focus list from candidates
 *
 * Algorithm:
 * 1. Score all candidates
 * 2. Add reason for each score
 * 3. Sort by score descending
 * 4. Fill up to point capacity (knapsack-like)
 * 5. Return selected items and overflow
 *
 * @param candidates - Focus candidates
 * @param options - Generation options
 * @returns FocusGeneratorResult with selected items and overflow
 */
export function generateFocusList(
  candidates: FocusCandidate[],
  options: FocusGeneratorOptions
): FocusGeneratorResult {
  const { pointCapacity, today } = options;

  // Filter based on options
  let filteredCandidates = candidates;

  if (options.excludeGoals?.length) {
    filteredCandidates = filteredCandidates.filter(
      (c) => !c.goalId || !options.excludeGoals?.includes(c.goalId)
    );
  }

  if (options.excludeProjects?.length) {
    filteredCandidates = filteredCandidates.filter(
      (c) => !c.projectId || !options.excludeProjects?.includes(c.projectId)
    );
  }

  // Score and sort candidates
  const scored = filteredCandidates.map((candidate) => {
    const result = scoreFocusCandidate(candidate, today);
    const reason = generateFocusReason(candidate, result.breakdown, today);
    return {
      candidate,
      score: result.totalScore,
      reason,
    };
  });

  // Sort by score, with priority boost for specific goals/projects
  scored.sort((a, b) => {
    let aBoost = 0;
    let bBoost = 0;

    if (
      options.prioritizeGoalId &&
      a.candidate.goalId === options.prioritizeGoalId
    ) {
      aBoost = 10;
    }
    if (
      options.prioritizeGoalId &&
      b.candidate.goalId === options.prioritizeGoalId
    ) {
      bBoost = 10;
    }
    if (
      options.prioritizeProjectId &&
      a.candidate.projectId === options.prioritizeProjectId
    ) {
      aBoost = 10;
    }
    if (
      options.prioritizeProjectId &&
      b.candidate.projectId === options.prioritizeProjectId
    ) {
      bBoost = 10;
    }
    if (
      options.prioritizeSprintId &&
      a.candidate.sprintId === options.prioritizeSprintId
    ) {
      aBoost = 5;
    }
    if (
      options.prioritizeSprintId &&
      b.candidate.sprintId === options.prioritizeSprintId
    ) {
      bBoost = 5;
    }

    return b.score + bBoost - (a.score + aBoost);
  });

  // Fill capacity
  const selected: FocusItem[] = [];
  const overflow: FocusItem[] = [];
  let pointsUsed = 0;

  for (const item of scored) {
    const focusItem: FocusItem = {
      source: item.candidate.id,
      type: item.candidate.type,
      title: item.candidate.title,
      points: item.candidate.points,
      score: item.score,
      reason: item.reason,
      status: 'pending',
      goalId: item.candidate.goalId,
      goalTitle: item.candidate.goalTitle,
      projectId: item.candidate.projectId,
      projectTitle: item.candidate.projectTitle,
    };

    if (pointsUsed + item.candidate.points <= pointCapacity) {
      selected.push(focusItem);
      pointsUsed += item.candidate.points;
    } else {
      overflow.push(focusItem);
    }
  }

  return {
    items: selected,
    totalPoints: pointsUsed,
    capacityUsed: pointCapacity > 0 ? (pointsUsed / pointCapacity) * 100 : 0,
    overflow,
  };
}

/**
 * Generate a complete FocusDay from candidates
 *
 * @param candidates - Focus candidates
 * @param availableHours - Hours available for focus today
 * @param today - Reference date
 * @returns FocusDay with all metadata
 */
export function generateFocusDay(
  candidates: FocusCandidate[],
  availableHours: number = 6,
  today: Date = new Date()
): FocusDay {
  const pointCapacity = calculatePointCapacity(availableHours);
  const dateString = toISODateString(today);

  const result = generateFocusList(candidates, {
    pointCapacity,
    today,
  });

  return {
    id: `focus_${dateString}`,
    date: dateString,
    availableHours,
    pointCapacity,
    items: result.items,
    plannedPoints: result.totalPoints,
    completedPoints: 0,
    completedItems: 0,
  };
}

/**
 * Update a FocusDay when an item is completed
 *
 * @param focusDay - Current focus day
 * @param itemSource - Source ID of completed item
 * @returns Updated FocusDay
 */
export function completeFocusItem(
  focusDay: FocusDay,
  itemSource: string
): FocusDay {
  const updatedItems = focusDay.items.map((item) =>
    item.source === itemSource
      ? { ...item, status: 'done' as const, completedAt: new Date().toISOString() }
      : item
  );

  const completedItems = updatedItems.filter((i) => i.status === 'done');
  const completedPoints = completedItems.reduce((sum, i) => sum + i.points, 0);

  return {
    ...focusDay,
    items: updatedItems,
    completedItems: completedItems.length,
    completedPoints,
  };
}

/**
 * Update a FocusDay when an item is deferred
 *
 * @param focusDay - Current focus day
 * @param itemSource - Source ID of deferred item
 * @param deferToDate - Date to defer to
 * @returns Updated FocusDay
 */
export function deferFocusItem(
  focusDay: FocusDay,
  itemSource: string,
  deferToDate: string
): FocusDay {
  const updatedItems = focusDay.items.map((item) =>
    item.source === itemSource
      ? { ...item, status: 'deferred' as const, deferredTo: deferToDate }
      : item
  );

  // Recalculate planned points (excluding deferred)
  const activeItems = updatedItems.filter(
    (i) => i.status === 'pending' || i.status === 'in_progress'
  );
  const plannedPoints = activeItems.reduce((sum, i) => sum + i.points, 0);

  return {
    ...focusDay,
    items: updatedItems,
    plannedPoints,
  };
}
