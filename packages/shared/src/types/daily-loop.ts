/**
 * Types for the Daily Loop (AI Chief of Staff) feature.
 * Mirrors Rust structs in crates/daily-loop/src/models.rs.
 */

// ── Core Entities ──────────────────────────────────────────────

export interface DailyPlan {
  id: string;
  date: string; // YYYY-MM-DD
  top3OutcomeIds: string[];
  taskOrder: string[];
  /** Persisted map of task_id → human-readable title */
  taskTitles: Record<string, string>;
  /** Task IDs that have been checked off as completed */
  completedTaskIds: string[];
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

export type ChatRole = 'user' | 'ai';

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

export type RevisionTrigger = 'initial' | 'chat' | 'manual';

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
  GET_PLAN: 'daily_loop_get_plan',
  CREATE_PLAN: 'daily_loop_create_plan',
  UPDATE_PLAN: 'daily_loop_update_plan',
  LOCK_PLAN: 'daily_loop_lock_plan',
  CREATE_OUTCOME: 'daily_loop_create_outcome',
  GET_OUTCOMES: 'daily_loop_get_outcomes',
  UPDATE_OUTCOME: 'daily_loop_update_outcome',
  DELETE_OUTCOME: 'daily_loop_delete_outcome',
  DEFER_TASK: 'daily_loop_defer_task',
  TOGGLE_TASK_COMPLETION: 'daily_loop_toggle_task_completion',
  GET_DEFERRAL_COUNT: 'daily_loop_get_deferral_count',
  GET_DEFERRALS: 'daily_loop_get_deferrals',
  CREATE_CHECK_IN: 'daily_loop_create_check_in',
  GET_CHECK_IN: 'daily_loop_get_check_in',
  SEND_CHAT: 'daily_loop_send_chat',
  GET_CHAT_HISTORY: 'daily_loop_get_chat_history',
  GET_CHAT_DATES: 'daily_loop_get_chat_dates',
  GET_RECENT_STATS: 'daily_loop_get_recent_stats',
  COUNT_CHECK_INS: 'daily_loop_count_check_ins',
  GET_REVISIONS: 'daily_loop_get_revisions',
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
  GENERATE_PLAN: 'daily_loop_generate_plan',
  CHAT_REPRIORITIZE: 'daily_loop_chat_reprioritize',
  GENERATE_SUMMARY: 'daily_loop_generate_summary',
} as const;
