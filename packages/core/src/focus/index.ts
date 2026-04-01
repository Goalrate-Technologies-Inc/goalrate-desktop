/**
 * Focus Module
 * Today's Focus generation and management
 */

// Re-export types from shared
export type {
  FocusItemType,
  FocusCandidate,
  FocusItemStatus,
  FocusItem,
  FocusDay,
  FocusGeneratorOptions,
  FocusHistory,
  FocusVelocity,
  FocusScoringResult,
  FocusMood,
  EndOfDaySummaryData,
  SummaryInsight,
} from '@goalrate-app/shared';

// Re-export constants from shared
// Note: calculatePriorityScore is renamed to avoid conflict with prioritization module
export {
  FOCUS_SCORING,
  DEADLINE_THRESHOLDS,
  CAPACITY_DEFAULTS,
  calculateDeadlineScore,
  calculateBlockingScore,
  calculatePriorityScore as calculateFocusPriorityScore,
  calculateStreakScore,
  calculateSprintScore,
  calculateTotalFocusScore,
  calculatePointCapacity,
} from '@goalrate-app/shared/constants';

// Export scoring types and functions
export type { FocusScoringBreakdown } from './scoring';
export {
  scoreFocusCandidate,
  scoreAllCandidates,
  getTopCandidates,
} from './scoring';

// Export reason generation
export {
  generateFocusReason,
  generateShortReason,
  generateDetailedReason,
} from './reasons';

// Export generator types and functions
export type { FocusGeneratorResult, GatherCandidatesOptions } from './generator';
export {
  gatherCandidatesFromGoals,
  gatherFocusCandidates,
  generateFocusList,
  generateFocusDay,
  completeFocusItem,
  deferFocusItem,
} from './generator';

// Export focus list filtering functions
export type {
  FocusListTaskStatus,
  FocusListTask,
  FilterFocusListTasksInput,
} from './listFilter';
export {
  DEFAULT_FOCUS_LIST_ELIGIBLE_STATUSES,
  filterFocusListTasks,
} from './listFilter';

// Export vault task source adapter contracts
export type {
  VaultTaskSourceRequest,
  VaultTaskSourceAdapter,
  LoadTasksFromVaultAdapterInput,
} from './vaultAdapter';
export { loadTasksFromVaultAdapter } from './vaultAdapter';

// Export focus list sorting functions
export {
  compareFocusListTasks,
  sortFocusListTasks,
} from './listSorter';

// Export focus list packing functions
export type {
  PackFocusListTasksInput,
  PackFocusListTasksResult,
} from './listPacker';
export { packFocusListTasks } from './listPacker';

// Export focus list aggregation service
export type {
  FocusServiceAggregateInput,
  FocusServiceAggregateFromVaultsInput,
  FocusServiceAggregateResult,
  FocusServiceCloseDayInput,
} from './focusService';
export { FocusService, focusService } from './focusService';

// Export adaptive capacity engine functions
export type {
  CapacityEngineInput,
  CapacityDebugInput,
  CapacityEngineDebugControlsInput,
  CapacityEngineConfig,
} from './capacityEngine';
export {
  roundToIncrement,
  clampCapacity,
  normalizeCapacityEngineConfig,
  resetCapacityToBaseline,
  calculateNextCapacitySP,
  calculateNextCapacitySPWithDebug,
} from './capacityEngine';

// Export summary functions
export {
  calculateCompletionPercentage,
  countDeferredItems,
  getCompletedItems,
  getTopCompletedItems,
  calculateComparisonToAverage,
  getComparisonInsight,
  generateEncouragement,
  generateSummaryInsights,
  generateEndOfDaySummary,
  updateFocusDayReflection,
  isSummaryReady,
  suggestMood,
} from './summary';

// Export velocity calculation functions
export type { VelocityTrendDirection, VelocityCalculationOptions } from './velocity';
export {
  calculateVelocity,
  calculateAveragePointsPerDay,
  calculateAverageCompletionRate,
  calculateCurrentStreak,
  calculateLongestStreak,
  calculateWeeklyTrend,
  calculateMonthlyTrend,
  determineTrendDirection,
  createEmptyVelocity,
  isHealthyVelocity,
  getTrendDescription,
} from './velocity';
