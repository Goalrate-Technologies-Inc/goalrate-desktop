/**
 * Prioritization Module
 * Eisenhower Matrix classification and task prioritization
 */

// Re-export types from shared
export type {
  EisenhowerQuadrant,
  UrgencyLevel,
  ImportanceLevel,
  PrioritizableItem,
  ClassifiedItem,
  QuadrantMetadata,
  ClassifyOptions,
  UrgencyThresholds,
} from '@goalrate-app/shared';

export {
  QUADRANT_METADATA,
  DEFAULT_URGENCY_THRESHOLDS,
  PRIORITY_IMPORTANCE_SCORES,
} from '@goalrate-app/shared';

// Export scoring functions
export {
  calculateUrgencyScore,
  getUrgencyLevel,
  calculateImportanceScore,
  getImportanceLevel,
  calculatePriorityScore,
  calculateItemScores,
} from './scoring';

// Export classification functions
export {
  determineQuadrant,
  classifyItem,
  classifyAndSort,
  groupByQuadrant,
  getTodaysFocusItems,
  shouldBeInTodaysFocus,
  filterTodaysFocusItems,
} from './eisenhower';

// Export converters
export {
  goalsToPrioritizable,
  tasksToPrioritizable,
  dailyTasksToPrioritizable,
  combineEntities,
} from './converters';
