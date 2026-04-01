/**
 * Focus Types
 * Today's Focus feature types for daily task prioritization
 * Based on PRD specification for the focus algorithm
 */

import type { Priority } from './common';

// ============================================================================
// FOCUS CANDIDATE TYPES
// ============================================================================

/**
 * Source type for focus items
 */
export type FocusItemType = 'goal_task' | 'project_task';

/**
 * Focus candidate - a task eligible for today's focus
 * Used as input to the focus scoring algorithm
 */
export interface FocusCandidate {
  id: string;
  type: FocusItemType;
  title: string;
  points: number;
  priority: Priority;
  dueDate?: string;
  blocks: string[]; // IDs of items this blocks
  blocksPeople: boolean; // True if blocking teammates
  inCurrentSprint: boolean;
  lastActivity?: string; // ISO date of last activity
  // Source context
  goalId?: string;
  goalTitle?: string;
  goalObjective?: string;
  projectId?: string;
  projectTitle?: string;
  epicTitle?: string;
  sprintId?: string;
  boardColumn?: string;
  vaultId?: string;
  vaultName?: string;
  workspaceId?: string;
  workspaceName?: string;
}

// ============================================================================
// FOCUS ITEM TYPES
// ============================================================================

/**
 * Focus item status
 */
export type FocusItemStatus = 'pending' | 'in_progress' | 'done' | 'deferred';

/**
 * Focus item - a scored and selected task for today
 */
export interface FocusItem {
  source: string; // ID of the source task
  type: FocusItemType;
  title: string;
  points: number;
  score: number; // Calculated priority score (0-100)
  reason: string; // Human-readable explanation of why it was selected
  status: FocusItemStatus;
  // Optional context
  goalId?: string;
  goalTitle?: string;
  projectId?: string;
  projectTitle?: string;
  deferredTo?: string; // Date if deferred
  completedAt?: string;
}

// ============================================================================
// FOCUS DAY TYPES
// ============================================================================

/**
 * Focus day - the daily focus configuration and items
 */
export interface FocusDay {
  id: string; // Format: focus_YYYY-MM-DD
  date: string; // ISO date
  availableHours: number; // User's available hours for the day
  pointCapacity: number; // Total points to aim for
  items: FocusItem[];
  plannedPoints: number; // Sum of all item points
  completedPoints: number; // Sum of completed item points
  completedItems: number; // Count of completed items
  // Optional metadata
  notes?: string;
  mood?: 'great' | 'good' | 'okay' | 'low'; // End of day reflection
  reflection?: string;
}

// ============================================================================
// FOCUS GENERATOR OPTIONS
// ============================================================================

/**
 * Options for the focus generation algorithm
 */
export interface FocusGeneratorOptions {
  pointCapacity: number;
  today: Date;
  // Optional filters
  excludeGoals?: string[];
  excludeProjects?: string[];
  prioritizeGoalId?: string;
  prioritizeProjectId?: string;
  prioritizeSprintId?: string;
}

// ============================================================================
// FOCUS HISTORY TYPES
// ============================================================================

/**
 * Historical focus summary for analytics
 */
export interface FocusHistory {
  date: string;
  plannedPoints: number;
  completedPoints: number;
  completedItems: number;
  totalItems: number;
  completionRate: number; // 0-100 percentage
}

/**
 * Velocity data for focus tracking
 */
export interface FocusVelocity {
  averagePointsPerDay: number;
  averageCompletionRate: number;
  totalDaysTracked: number;
  currentStreak: number; // Consecutive days with activity
  longestStreak: number;
  weeklyTrend: number[]; // Points per day for last 7 days
}

// ============================================================================
// FOCUS SCORING RESULT
// ============================================================================

/**
 * Detailed scoring breakdown for a focus candidate
 */
export interface FocusScoringResult {
  candidateId: string;
  totalScore: number;
  breakdown: {
    deadline: number;
    blocking: number;
    priority: number;
    streak: number;
    sprint: number;
  };
  reason: string;
}

// ============================================================================
// END-OF-DAY SUMMARY TYPES
// ============================================================================

/**
 * Mood options for end-of-day reflection
 */
export type FocusMood = 'great' | 'good' | 'okay' | 'low';

/**
 * End-of-day summary data for review and reflection
 */
export interface EndOfDaySummaryData {
  date: string;
  plannedPoints: number;
  completedPoints: number;
  completionPercentage: number;
  completedItems: number;
  totalItems: number;
  deferredCount: number;
  mood?: FocusMood;
  reflection?: string;
  topCompletedItems: FocusItem[];
  streakDays?: number;
  comparisonToAverage?: number; // Percentage difference from average (e.g., +15 or -10)
}

/**
 * Insights generated for the end-of-day summary
 */
export interface SummaryInsight {
  type: 'streak' | 'comparison' | 'achievement' | 'encouragement';
  message: string;
  icon?: 'fire' | 'trophy' | 'chart' | 'star';
}

// ============================================================================
// VELOCITY EXTENDED TYPES
// ============================================================================

/**
 * Time period for velocity analysis
 */
export type VelocityPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

/**
 * Velocity trend direction
 */
export type VelocityTrendDirection = 'up' | 'down' | 'stable';

/**
 * Point-in-time velocity snapshot (matches backend VelocitySnapshot)
 */
export interface VelocitySnapshot {
  id: string;
  userId: string;
  period: VelocityPeriod;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  velocityScore: number;
  goalsCompleted: number;
  tasksCompleted: number;
  storyPointsCompleted: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Velocity target configuration
 */
export interface VelocityTarget {
  id: string;
  userId: string;
  period: VelocityPeriod;
  startDate: string;
  endDate?: string;
  targetGoals: number;
  targetTasks: number;
  targetStoryPoints: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Aggregated velocity summary for a period
 */
export interface VelocitySummary {
  period: VelocityPeriod;
  snapshotCount: number;
  avgVelocity: number;
  maxVelocity: number;
  minVelocity: number;
  avgGoals: number;
  avgTasks: number;
  trend: VelocityTrendDirection;
  latestSnapshot?: string; // ISO date
}

/**
 * Extended velocity data including trends and comparisons
 */
export interface VelocityExtended extends FocusVelocity {
  trend: VelocityTrendDirection;
  monthlyTrend?: number[]; // Points per day for last 30 days
  comparisonToPrevious?: number; // Percentage change from previous period
  projectedCompletion?: number; // Estimated points at current pace
}

// ============================================================================
// DESKTOP FOCUS LIST TYPES
// ============================================================================

/**
 * Focus task status values used by Desktop Focus List generation.
 */
export type FocusTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

/**
 * Focus list entry status excludes blocked tasks by design.
 */
export type FocusListEntryStatus = Exclude<FocusTaskStatus, 'blocked'>;

/**
 * Priority rank where 1 is highest and 5 is lowest.
 */
export type FocusTaskPriority = 1 | 2 | 3 | 4 | 5;

/**
 * Canonical task shape consumed by the Desktop Focus List domain.
 */
export interface FocusTask {
  id: string;
  vaultId: string;
  title: string;
  dueAt: string | null;
  deadlineAt: string | null;
  priority: FocusTaskPriority;
  storyPoints: number;
  status: FocusTaskStatus;
  assignedToUserId: string;
  createdAt: string;
}

/**
 * Open vault metadata used by cross-vault aggregation.
 */
export interface FocusVault {
  id: string;
  name: string;
  isOpen: boolean;
}

/**
 * Planned focus entry for a given day.
 */
export interface FocusListEntry {
  id: string;
  taskId: string;
  vaultId: string;
  title: string;
  dueAt: string | null;
  priority: FocusTaskPriority;
  storyPoints: number;
  status: FocusListEntryStatus;
}

/**
 * Persisted focus list for a specific day.
 */
export interface FocusListDay {
  date: string;
  capacitySP: number;
  packedSP: number;
  plannedCount: number;
  completedCount: number;
  completedSP: number;
  entries: FocusListEntry[];
  generatedAt: string;
}

/**
 * User-specific adaptive capacity settings.
 */
export interface CapacityProfile {
  userId: string;
  baselineSP: number;
  minSP: number;
  maxSP: number;
  stepUpPct: number;
  stepDownPct: number;
  rounding: number;
  lastComputedForDate: string;
}

/**
 * Computed day-close stats used for capacity adjustment.
 */
export interface FocusDayStats {
  date: string;
  plannedCount: number;
  plannedSP: number;
  completedCount: number;
  completedSP: number;
  allDone: boolean;
}

/**
 * Payload for generating today's focus list.
 */
export interface FocusListGenerateInput {
  userId: string;
  openVaultIds: string[];
  date: string;
}

/**
 * Payload for end-of-day close and capacity adjustment.
 */
export interface FocusListCloseDayInput {
  userId: string;
  stats: FocusDayStats;
}

/**
 * Payload for handling click-through navigation to a task.
 */
export interface FocusListNavigationClickInput {
  taskId: string;
  vaultId: string;
}

/**
 * Close-day response shape.
 */
export interface FocusListCloseDayResult {
  nextCapacitySP: number;
}

/**
 * Navigation response shape.
 */
export interface FocusListNavigationResult {
  ok: boolean;
}

/**
 * Default adaptive capacity values defined by the Focus List spec.
 */
export const DEFAULT_FOCUS_CAPACITY_PROFILE = {
  baselineSP: 13,
  minSP: 3,
  maxSP: 40,
  stepUpPct: 0.1,
  stepDownPct: 0.1,
  rounding: 0.5,
} as const;

/**
 * Statuses eligible for Focus List candidate filtering.
 */
export const FOCUS_ELIGIBLE_TASK_STATUSES = ['todo', 'in_progress'] as const;

/**
 * Payload for retrieving the current focus list day for a user/date.
 */
export interface FocusListGetCurrentInput {
  userId: string;
  date: string;
}

/**
 * Canonical IPC command names for Desktop Focus List operations.
 */
export const FOCUS_IPC_COMMANDS = {
  GENERATE: 'focus_list_generate',
  CLOSE_DAY: 'focus_list_close_day',
  GET_CURRENT: 'focus_list_get_current',
  NAVIGATE_TO_TASK: 'focus_list_navigate_to_task',
} as const;

/**
 * Union of allowed Focus List IPC command names.
 */
export type FocusIpcCommandName =
  (typeof FOCUS_IPC_COMMANDS)[keyof typeof FOCUS_IPC_COMMANDS];

/**
 * IPC payload contracts keyed by command name.
 */
export interface FocusIpcPayloadByCommand {
  focus_list_generate: FocusListGenerateInput;
  focus_list_close_day: FocusListCloseDayInput;
  focus_list_get_current: FocusListGetCurrentInput;
  focus_list_navigate_to_task: FocusListNavigationClickInput;
}

/**
 * IPC response contracts keyed by command name.
 */
export interface FocusIpcResultByCommand {
  focus_list_generate: FocusListDay;
  focus_list_close_day: FocusListCloseDayResult;
  focus_list_get_current: FocusListDay | null;
  focus_list_navigate_to_task: FocusListNavigationResult;
}
