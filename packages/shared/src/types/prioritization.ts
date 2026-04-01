/**
 * Prioritization Types
 * Types for Eisenhower Matrix and task prioritization
 * Used by @goalrate-app/core prioritization module
 */

// ============================================================================
// EISENHOWER MATRIX TYPES
// ============================================================================

/**
 * Eisenhower Matrix Quadrants
 * Q1: URGENT + IMPORTANT - Do First (Crisis/Deadlines)
 * Q2: NOT URGENT + IMPORTANT - Schedule (Planning/Growth)
 * Q3: URGENT + NOT IMPORTANT - Delegate (Interruptions)
 * Q4: NOT URGENT + NOT IMPORTANT - Eliminate (Time-wasters)
 */
export type EisenhowerQuadrant =
  | 'do_first'    // Q1: Urgent + Important
  | 'schedule'    // Q2: Not Urgent + Important
  | 'delegate'    // Q3: Urgent + Not Important
  | 'eliminate';  // Q4: Not Urgent + Not Important

/**
 * Urgency level based on deadline proximity
 */
export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

/**
 * Importance level based on priority and impact
 */
export type ImportanceLevel = 'critical' | 'high' | 'medium' | 'low';

// ============================================================================
// PRIORITIZABLE ITEM TYPES
// ============================================================================

/**
 * Generic prioritizable item interface
 * Any entity that can be classified in the Eisenhower Matrix
 */
export interface PrioritizableItem {
  id: string;
  title: string;
  priority?: string | null;
  due_date?: string | null;
  deadline?: string | null;
  completed?: boolean;
  status?: string;
  story_points?: number | null;
  estimated_time?: number | null;
  estimated_hours?: number | null;
}

/**
 * Item with Eisenhower classification scores
 */
export interface ClassifiedItem<T extends PrioritizableItem> {
  item: T;
  quadrant: EisenhowerQuadrant;
  urgencyLevel: UrgencyLevel;
  importanceLevel: ImportanceLevel;
  urgencyScore: number;
  importanceScore: number;
  priorityScore: number;
  daysUntilDue: number | null;
}

// ============================================================================
// QUADRANT CONFIGURATION
// ============================================================================

/**
 * Quadrant metadata for display
 */
export interface QuadrantMetadata {
  id: EisenhowerQuadrant;
  name: string;
  description: string;
  action: string;
}

/**
 * Quadrant metadata configuration
 */
export const QUADRANT_METADATA: Record<EisenhowerQuadrant, QuadrantMetadata> = {
  do_first: {
    id: 'do_first',
    name: 'Do First',
    description: 'Urgent and Important',
    action: 'Handle these tasks immediately',
  },
  schedule: {
    id: 'schedule',
    name: 'Schedule',
    description: 'Important but Not Urgent',
    action: 'Plan time for these tasks',
  },
  delegate: {
    id: 'delegate',
    name: 'Delegate',
    description: 'Urgent but Not Important',
    action: 'Consider delegating or quick handling',
  },
  eliminate: {
    id: 'eliminate',
    name: 'Eliminate',
    description: 'Neither Urgent nor Important',
    action: 'Reconsider if needed or remove',
  },
};

// ============================================================================
// CLASSIFICATION OPTIONS
// ============================================================================

/**
 * Options for classification operations
 */
export interface ClassifyOptions {
  /** Exclude completed items (default: true) */
  excludeCompleted?: boolean;
  /** Exclude specific quadrants from results */
  excludeQuadrants?: EisenhowerQuadrant[];
  /** Reference date for calculations (default: now) */
  today?: Date;
}

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

/**
 * Urgency thresholds in days
 */
export interface UrgencyThresholds {
  /** Critical urgency threshold (default: 1 day) */
  critical: number;
  /** High urgency threshold (default: 3 days) */
  high: number;
  /** Medium urgency threshold (default: 7 days) */
  medium: number;
  /** Low urgency threshold (default: 14 days) */
  low: number;
}

/**
 * Default urgency thresholds
 */
export const DEFAULT_URGENCY_THRESHOLDS: UrgencyThresholds = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
};

/**
 * Priority to importance score mapping
 */
export const PRIORITY_IMPORTANCE_SCORES: Record<string, number> = {
  // Standard priority levels
  urgent: 100,
  critical: 100,
  highest: 90,
  high: 75,
  medium: 50,
  normal: 50,
  low: 25,
  lowest: 10,
  // Story/Task specific
  blocker: 100,
  major: 75,
  minor: 25,
  trivial: 10,
};
