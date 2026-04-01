/**
 * Prioritization Scoring
 * Urgency and importance scoring for Eisenhower Matrix classification
 */

import type {
  PrioritizableItem,
  UrgencyLevel,
  ImportanceLevel,
  UrgencyThresholds,
} from '@goalrate-app/shared';
import {
  DEFAULT_URGENCY_THRESHOLDS,
  PRIORITY_IMPORTANCE_SCORES,
} from '@goalrate-app/shared';
import { calculateDaysUntilDue } from '../utils/dates';

// ============================================================================
// URGENCY SCORING
// ============================================================================

/**
 * Calculate urgency score (0-100) based on days until due
 * Uses exponential decay - closer deadlines have exponentially higher scores
 *
 * @param daysUntilDue - Days until due date (negative if overdue)
 * @param thresholds - Urgency thresholds configuration
 * @returns Urgency score 0-100
 */
export function calculateUrgencyScore(
  daysUntilDue: number | null,
  thresholds: UrgencyThresholds = DEFAULT_URGENCY_THRESHOLDS
): number {
  if (daysUntilDue === null) {
    return 0;
  }

  // Overdue items are maximum urgency
  if (daysUntilDue < 0) {
    return 100;
  }

  // Due today
  if (daysUntilDue === 0) {
    return 95;
  }

  // Calculate score based on days remaining
  if (daysUntilDue <= thresholds.critical) {
    return 90;
  }
  if (daysUntilDue <= thresholds.high) {
    return 75;
  }
  if (daysUntilDue <= thresholds.medium) {
    return 50;
  }
  if (daysUntilDue <= thresholds.low) {
    return 25;
  }

  // More than the low threshold away - gradual decay
  return Math.max(0, 20 - (daysUntilDue - thresholds.low));
}

/**
 * Get urgency level from urgency score
 *
 * @param score - Urgency score 0-100
 * @returns UrgencyLevel
 */
export function getUrgencyLevel(score: number): UrgencyLevel {
  if (score >= 90) {
    return 'critical';
  }
  if (score >= 70) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  if (score > 0) {
    return 'low';
  }
  return 'none';
}

// ============================================================================
// IMPORTANCE SCORING
// ============================================================================

/**
 * Calculate importance score (0-100) based on priority and other factors
 *
 * Factors considered:
 * - Priority level (primary factor)
 * - Story points (larger tasks often more important)
 * - Estimated time (longer tasks get slight boost)
 *
 * @param item - Prioritizable item
 * @returns Importance score 0-100
 */
export function calculateImportanceScore(item: PrioritizableItem): number {
  // Start with priority-based score
  const priority = item.priority?.toLowerCase() ?? 'medium';
  let score = PRIORITY_IMPORTANCE_SCORES[priority] ?? 50;

  // Story points boost (higher points = more important)
  // Fibonacci sequence points: 1, 2, 3, 5, 8, 13, 21
  // Normalize to 0-20 bonus
  if (item.story_points) {
    const pointsBonus = Math.min(20, item.story_points * 1.5);
    score = Math.min(100, score + pointsBonus);
  }

  // Estimated time boost (longer tasks often more important)
  const estimatedMinutes =
    item.estimated_time ?? (item.estimated_hours ? item.estimated_hours * 60 : 0);
  if (estimatedMinutes > 120) {
    // Tasks > 2 hours get a small boost
    score = Math.min(100, score + 5);
  }

  return score;
}

/**
 * Get importance level from importance score
 *
 * @param score - Importance score 0-100
 * @returns ImportanceLevel
 */
export function getImportanceLevel(score: number): ImportanceLevel {
  if (score >= 80) {
    return 'critical';
  }
  if (score >= 60) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}

// ============================================================================
// COMBINED SCORING
// ============================================================================

/**
 * Calculate combined priority score for sorting
 * Weights: Urgency 40%, Importance 60%
 * (Importance matters more for long-term focus)
 *
 * @param urgencyScore - Urgency score 0-100
 * @param importanceScore - Importance score 0-100
 * @returns Combined priority score 0-100
 */
export function calculatePriorityScore(
  urgencyScore: number,
  importanceScore: number
): number {
  return urgencyScore * 0.4 + importanceScore * 0.6;
}

/**
 * Calculate all scores for an item
 *
 * @param item - Prioritizable item
 * @param today - Reference date for calculations
 * @returns Object with all scores and levels
 */
export function calculateItemScores(
  item: PrioritizableItem,
  today: Date = new Date()
): {
  daysUntilDue: number | null;
  urgencyScore: number;
  importanceScore: number;
  priorityScore: number;
  urgencyLevel: UrgencyLevel;
  importanceLevel: ImportanceLevel;
} {
  // Get due date (support both due_date and deadline fields)
  const dueDate = item.due_date ?? item.deadline ?? null;
  const daysUntilDue = calculateDaysUntilDue(dueDate, today);

  // Calculate scores
  const urgencyScore = calculateUrgencyScore(daysUntilDue);
  const importanceScore = calculateImportanceScore(item);
  const priorityScore = calculatePriorityScore(urgencyScore, importanceScore);

  return {
    daysUntilDue,
    urgencyScore,
    importanceScore,
    priorityScore,
    urgencyLevel: getUrgencyLevel(urgencyScore),
    importanceLevel: getImportanceLevel(importanceScore),
  };
}
