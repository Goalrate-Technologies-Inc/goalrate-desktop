/**
 * Eisenhower Matrix Classification
 * Core classification and grouping functions for the Eisenhower Matrix
 */

import type {
  EisenhowerQuadrant,
  PrioritizableItem,
  ClassifiedItem,
  ClassifyOptions,
} from '@goalrate-app/shared';
import {
  calculateUrgencyScore,
  calculateImportanceScore,
  calculatePriorityScore,
  getUrgencyLevel,
  getImportanceLevel,
} from './scoring';
import { calculateDaysUntilDue } from '../utils/dates';

// ============================================================================
// QUADRANT DETERMINATION
// ============================================================================

/**
 * Determine Eisenhower quadrant based on urgency and importance scores
 *
 * Quadrant mapping:
 * - Q1 (do_first): urgency >= 50 AND importance >= 50
 * - Q2 (schedule): urgency < 50 AND importance >= 50
 * - Q3 (delegate): urgency >= 50 AND importance < 50
 * - Q4 (eliminate): urgency < 50 AND importance < 50
 *
 * @param urgencyScore - Urgency score 0-100
 * @param importanceScore - Importance score 0-100
 * @returns EisenhowerQuadrant
 */
export function determineQuadrant(
  urgencyScore: number,
  importanceScore: number
): EisenhowerQuadrant {
  const isUrgent = urgencyScore >= 50;
  const isImportant = importanceScore >= 50;

  if (isUrgent && isImportant) {
    return 'do_first';
  }
  if (!isUrgent && isImportant) {
    return 'schedule';
  }
  if (isUrgent && !isImportant) {
    return 'delegate';
  }
  return 'eliminate';
}

// ============================================================================
// ITEM CLASSIFICATION
// ============================================================================

/**
 * Classify a single item into the Eisenhower Matrix
 *
 * @param item - Item to classify
 * @param today - Reference date for calculations
 * @returns ClassifiedItem with all scores and quadrant
 */
export function classifyItem<T extends PrioritizableItem>(
  item: T,
  today: Date = new Date()
): ClassifiedItem<T> {
  // Get due date (support both due_date and deadline fields)
  const dueDate = item.due_date ?? item.deadline ?? null;
  const daysUntilDue = calculateDaysUntilDue(dueDate, today);

  // Calculate scores
  const urgencyScore = calculateUrgencyScore(daysUntilDue);
  const importanceScore = calculateImportanceScore(item);
  const priorityScore = calculatePriorityScore(urgencyScore, importanceScore);

  // Determine quadrant
  const quadrant = determineQuadrant(urgencyScore, importanceScore);

  return {
    item,
    quadrant,
    urgencyLevel: getUrgencyLevel(urgencyScore),
    importanceLevel: getImportanceLevel(importanceScore),
    urgencyScore,
    importanceScore,
    priorityScore,
    daysUntilDue,
  };
}

/**
 * Check if an item is completed based on its properties
 *
 * @param item - Item to check
 * @returns True if item is completed
 */
function isItemCompleted(item: PrioritizableItem): boolean {
  if (item.completed === true) {
    return true;
  }
  const status = item.status as string | undefined;
  return status === 'done' || status === 'completed' || status === 'cancelled';
}

/**
 * Classify multiple items and sort by priority score
 *
 * @param items - Items to classify
 * @param options - Classification options
 * @returns Sorted array of ClassifiedItems
 */
export function classifyAndSort<T extends PrioritizableItem>(
  items: T[],
  options: ClassifyOptions = {}
): ClassifiedItem<T>[] {
  const {
    excludeCompleted = true,
    excludeQuadrants = [],
    today = new Date(),
  } = options;

  // Filter items
  let filteredItems = items;
  if (excludeCompleted) {
    filteredItems = items.filter((item) => !isItemCompleted(item));
  }

  // Classify all items
  let classified = filteredItems.map((item) => classifyItem(item, today));

  // Exclude specified quadrants
  if (excludeQuadrants.length > 0) {
    classified = classified.filter(
      (c) => !excludeQuadrants.includes(c.quadrant)
    );
  }

  // Sort by priority score (highest first)
  return classified.sort((a, b) => b.priorityScore - a.priorityScore);
}

// ============================================================================
// GROUPING
// ============================================================================

/**
 * Group classified items by quadrant
 *
 * @param classifiedItems - Items to group
 * @returns Record of quadrants to items, sorted by priority within each
 */
export function groupByQuadrant<T extends PrioritizableItem>(
  classifiedItems: ClassifiedItem<T>[]
): Record<EisenhowerQuadrant, ClassifiedItem<T>[]> {
  const groups: Record<EisenhowerQuadrant, ClassifiedItem<T>[]> = {
    do_first: [],
    schedule: [],
    delegate: [],
    eliminate: [],
  };

  for (const item of classifiedItems) {
    groups[item.quadrant].push(item);
  }

  // Sort each group by priority score
  const quadrants: EisenhowerQuadrant[] = [
    'do_first',
    'schedule',
    'delegate',
    'eliminate',
  ];
  for (const quadrant of quadrants) {
    groups[quadrant].sort((a, b) => b.priorityScore - a.priorityScore);
  }

  return groups;
}

// ============================================================================
// TODAY'S FOCUS SELECTION
// ============================================================================

/**
 * Get items for Today's Focus section
 *
 * Prioritizes Q1 (Do First) items, then Q2 (Schedule) items
 * Excludes Q4 (Eliminate) items entirely
 *
 * @param items - Items to prioritize
 * @param limit - Maximum items to return (default: 6)
 * @param today - Reference date for calculations
 * @returns Prioritized items for today's focus
 */
export function getTodaysFocusItems<T extends PrioritizableItem>(
  items: T[],
  limit: number = 6,
  today: Date = new Date()
): ClassifiedItem<T>[] {
  const classified = classifyAndSort(items, {
    excludeCompleted: true,
    excludeQuadrants: ['eliminate'], // Don't show Q4 items in Today's Focus
    today,
  });

  return classified.slice(0, limit);
}

/**
 * Check if an item should be in Today's Focus
 *
 * Items qualify if they are:
 * - In Q1 (Do First) quadrant
 * - In Q2 (Schedule) with due date within 3 days
 * - Critical importance regardless of due date
 * - In Q3 (Delegate) if overdue
 *
 * @param classified - Classified item
 * @returns True if should be in Today's Focus
 */
export function shouldBeInTodaysFocus(
  classified: ClassifiedItem<PrioritizableItem>
): boolean {
  // Always include Q1 items
  if (classified.quadrant === 'do_first') {
    return true;
  }

  // Include high-importance Q2 items due soon
  if (classified.quadrant === 'schedule') {
    if (classified.daysUntilDue !== null && classified.daysUntilDue <= 3) {
      return true;
    }
    if (classified.importanceLevel === 'critical') {
      return true;
    }
  }

  // Include Q3 items only if overdue
  if (classified.quadrant === 'delegate') {
    if (classified.daysUntilDue !== null && classified.daysUntilDue < 0) {
      return true;
    }
  }

  return false;
}

/**
 * Filter items that should be in Today's Focus
 *
 * @param classifiedItems - Classified items
 * @param limit - Maximum items to return
 * @returns Items that qualify for Today's Focus
 */
export function filterTodaysFocusItems<T extends PrioritizableItem>(
  classifiedItems: ClassifiedItem<T>[],
  limit?: number
): ClassifiedItem<T>[] {
  const focusItems = classifiedItems.filter(shouldBeInTodaysFocus);
  return limit ? focusItems.slice(0, limit) : focusItems;
}
