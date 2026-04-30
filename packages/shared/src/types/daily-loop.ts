/**
 * Types for the Agenda and Assistant feature.
 * Mirrors Rust structs in crates/daily-loop/src/models.rs.
 */

// ── Core Entities ──────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  taskId: string;
  title: string;
  startTime: string;
  durationMinutes: number;
  estimateSource?: string | null;
  eisenhowerQuadrant?: string | null;
}

export interface DailyPlan {
  id: string;
  date: string; // YYYY-MM-DD
  top3OutcomeIds: string[];
  taskOrder: string[];
  /** Persisted map of task_id → human-readable title */
  taskTitles: Record<string, string>;
  /** Task IDs that have been checked off as completed */
  completedTaskIds: string[];
  /** Local timestamp used to generate the schedule */
  generatedAt?: string | null;
  /** Concrete chronological schedule from agenda markdown */
  scheduledTasks?: ScheduledTask[];
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Outcome {
  id: string;
  dailyPlanId: string;
  title: string;
  linkedTaskIds: string[];
  createdAt: string;
  aiGenerated: boolean;
}

export interface Deferral {
  id: string;
  taskId: string;
  date: string;
  reason: string | null;
  aiInterpretation: string | null;
  createdAt: string;
}

export interface CheckIn {
  id: string;
  date: string;
  completedTaskIds: string[];
  notes: string | null;
  aiSummary: string | null;
  createdAt: string;
}

export interface ContextSnapshot {
  id: string;
  date: string;
  summaryText: string;
  tokenCount: number;
  createdAt: string;
}

export type ChatRole = "user" | "ai";

export interface ChatMessage {
  id: string;
  dailyPlanId: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface DailyStats {
  date: string;
  domain: string;
  plannedCount: number;
  completedCount: number;
  deferredCount: number;
  avgTaskMinutes: number;
}

export type RevisionTrigger = "initial" | "chat" | "manual";

export interface PlanRevision {
  id: string;
  dailyPlanId: string;
  revisionNumber: number;
  top3: string[];
  taskOrder: string[];
  trigger: RevisionTrigger;
  timestamp: string;
}

// ── Input Types ────────────────────────────────────────────────

export interface UpdatePlanInput {
  vaultId: string;
  planId: string;
  top3OutcomeIds?: string[];
  taskOrder?: string[];
  scheduledTasks?: ScheduledTask[];
}

export interface ScheduleTaskForDateInput {
  vaultId: string;
  taskId: string;
  title: string;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  estimateSource?: string;
  eisenhowerQuadrant?: string | null;
}

export interface GenerateAlternativeSubtaskInput {
  vaultId: string;
  missedTaskId: string;
  parentTaskId?: string;
  missedTitle?: string;
  date: string;
}

export interface GenerateAlternativeSubtaskResult {
  taskId: string;
  title: string;
  plan: DailyPlan;
}

export interface ScheduleParentTaskForMissedSubtaskInput {
  vaultId: string;
  missedTaskId: string;
  parentTaskId?: string;
  date: string;
}

export interface GenerateAlternativeTaskInput {
  vaultId: string;
  missedTaskId: string;
  parentTaskId?: string;
  date: string;
}

export interface GenerateAlternativeTaskResult {
  taskId: string;
  title: string;
  plan: DailyPlan;
}

export interface ArchiveParentTaskForMissedSubtaskInput {
  vaultId: string;
  missedTaskId: string;
  parentTaskId?: string;
  date: string;
}

export interface ArchiveParentTaskForMissedSubtaskResult {
  goalId: string;
  archivedTaskId: string;
  archivedTaskIds: string[];
}

export interface ArchiveGoalForMissedSubtaskInput {
  vaultId: string;
  missedTaskId: string;
  parentTaskId?: string;
  date: string;
}

export interface ArchiveGoalForMissedSubtaskResult {
  goalId: string;
  status: "archived";
}

export interface CreateOutcomeInput {
  vaultId: string;
  dailyPlanId: string;
  title: string;
  linkedTaskIds: string[];
  aiGenerated: boolean;
}

export interface UpdateOutcomeInput {
  vaultId: string;
  outcomeId: string;
  title?: string;
  linkedTaskIds?: string[];
}

export interface DeferTaskInput {
  vaultId: string;
  taskId: string;
  date: string;
  reason?: string;
}

export interface CreateCheckInInput {
  vaultId: string;
  date: string;
  completedTaskIds: string[];
  notes?: string;
  aiSummary?: string;
}

export interface SendChatInput {
  vaultId: string;
  dailyPlanId: string;
  content: string;
}

// ── IPC Command Names ──────────────────────────────────────────

export const DAILY_LOOP_IPC_COMMANDS = {
  GET_PLAN: "daily_loop_get_plan",
  GET_AGENDA_WARNINGS: "daily_loop_get_agenda_warnings",
  OPEN_AGENDA_ERROR_LOG: "daily_loop_open_agenda_error_log",
  CREATE_PLAN: "daily_loop_create_plan",
  UPDATE_PLAN: "daily_loop_update_plan",
  SCHEDULE_TASK_FOR_DATE: "daily_loop_schedule_task_for_date",
  GENERATE_ALTERNATIVE_SUBTASK: "daily_loop_generate_alternative_subtask",
  SCHEDULE_PARENT_TASK_FOR_MISSED_SUBTASK:
    "daily_loop_schedule_parent_task_for_missed_subtask",
  GENERATE_ALTERNATIVE_TASK: "daily_loop_generate_alternative_task",
  ARCHIVE_PARENT_TASK_FOR_MISSED_SUBTASK:
    "daily_loop_archive_parent_task_for_missed_subtask",
  ARCHIVE_GOAL_FOR_MISSED_SUBTASK:
    "daily_loop_archive_goal_for_missed_subtask",
  LOCK_PLAN: "daily_loop_lock_plan",
  CREATE_OUTCOME: "daily_loop_create_outcome",
  GET_OUTCOMES: "daily_loop_get_outcomes",
  UPDATE_OUTCOME: "daily_loop_update_outcome",
  DELETE_OUTCOME: "daily_loop_delete_outcome",
  DEFER_TASK: "daily_loop_defer_task",
  TOGGLE_TASK_COMPLETION: "daily_loop_toggle_task_completion",
  GET_DEFERRAL_COUNT: "daily_loop_get_deferral_count",
  GET_DEFERRALS: "daily_loop_get_deferrals",
  CREATE_CHECK_IN: "daily_loop_create_check_in",
  GET_CHECK_IN: "daily_loop_get_check_in",
  SEND_CHAT: "daily_loop_send_chat",
  GET_CHAT_HISTORY: "daily_loop_get_chat_history",
  GET_CHAT_DATES: "daily_loop_get_chat_dates",
  GET_RECENT_STATS: "daily_loop_get_recent_stats",
  COUNT_CHECK_INS: "daily_loop_count_check_ins",
  GET_REVISIONS: "daily_loop_get_revisions",
} as const;

export type DailyLoopIpcCommandName =
  (typeof DAILY_LOOP_IPC_COMMANDS)[keyof typeof DAILY_LOOP_IPC_COMMANDS];

// ── AI Response Types ──────────────────────────────────────────

export interface DeferralConfrontation {
  taskId: string;
  deferralCount: number;
  reasoning: string;
}

export interface GeneratedPlanResponse {
  plan: DailyPlan;
  outcomes: Outcome[];
  dailyInsight: string | null;
  patternNote: string | null;
  deferralsConfrontation: DeferralConfrontation[];
  /** Map of task_id → human-readable title (for AI-generated tasks) */
  taskTitles: Record<string, string>;
}

export interface ChatReprioritizeResponse {
  aiMessage: ChatMessage;
  planUpdated: boolean;
  updatedPlan: DailyPlan | null;
  /** Task titles from AI-generated tasks in the plan update */
  taskTitles: Record<string, string>;
}

export const DAILY_LOOP_AI_COMMANDS = {
  GENERATE_PLAN: "daily_loop_generate_plan",
  CHAT_REPRIORITIZE: "daily_loop_chat_reprioritize",
  GENERATE_SUMMARY: "daily_loop_generate_summary",
} as const;
