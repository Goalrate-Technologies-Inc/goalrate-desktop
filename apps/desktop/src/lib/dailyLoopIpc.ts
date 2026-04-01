import { invoke } from '@tauri-apps/api/core';

/** Default AI model for daily loop features. Change here to switch all AI calls. */
export const DEFAULT_AI_MODEL = 'anthropic::claude-sonnet-4-5-20250929';
import {
  DAILY_LOOP_IPC_COMMANDS,
  DAILY_LOOP_AI_COMMANDS,
  type GeneratedPlanResponse,
  type ChatReprioritizeResponse,
  type DailyPlan,
  type Outcome,
  type Deferral,
  type CheckIn,
  type ChatMessage,
  type DailyStats,
  type PlanRevision,
  type UpdatePlanInput,
  type CreateOutcomeInput,
  type UpdateOutcomeInput,
  type DeferTaskInput,
  type CreateCheckInInput,
  type SendChatInput,
} from '@goalrate-app/shared';

// ── Plan ───────────────────────────────────────────────────────

export function getPlan(vaultId: string, date: string): Promise<DailyPlan | null> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_PLAN, { vaultId, date });
}

export function createPlan(vaultId: string, date: string): Promise<DailyPlan> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.CREATE_PLAN, { vaultId, date });
}

export function updatePlan(input: UpdatePlanInput): Promise<DailyPlan> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.UPDATE_PLAN, { input });
}

export function lockPlan(vaultId: string, planId: string): Promise<DailyPlan> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.LOCK_PLAN, { vaultId, planId });
}

// ── Outcomes ───────────────────────────────────────────────────

export function createOutcome(input: CreateOutcomeInput): Promise<Outcome> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.CREATE_OUTCOME, { input });
}

export function getOutcomes(vaultId: string, dailyPlanId: string): Promise<Outcome[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_OUTCOMES, { vaultId, dailyPlanId });
}

export function updateOutcome(input: UpdateOutcomeInput): Promise<Outcome> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.UPDATE_OUTCOME, { input });
}

export function deleteOutcome(vaultId: string, outcomeId: string): Promise<void> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.DELETE_OUTCOME, { vaultId, outcomeId });
}

// ── Deferrals ──────────────────────────────────────────────────

export function deferTask(input: DeferTaskInput): Promise<Deferral> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.DEFER_TASK, { input });
}

export function toggleTaskCompletion(vaultId: string, planId: string, taskId: string): Promise<DailyPlan> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.TOGGLE_TASK_COMPLETION, { vaultId, planId, taskId });
}

export interface TaskMetadata {
  priority: string;
  deadline: string;
}

export function getTaskMetadata(vaultId: string): Promise<Record<string, TaskMetadata>> {
  return invoke('daily_loop_get_task_metadata', { vaultId });
}

export function getDeferralCount(vaultId: string, taskId: string): Promise<number> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_DEFERRAL_COUNT, { vaultId, taskId });
}

export function getDeferrals(vaultId: string, taskId: string): Promise<Deferral[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_DEFERRALS, { vaultId, taskId });
}

// ── Check-Ins ──────────────────────────────────────────────────

export function createCheckIn(input: CreateCheckInInput): Promise<CheckIn> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.CREATE_CHECK_IN, { input });
}

export function getCheckIn(vaultId: string, date: string): Promise<CheckIn | null> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_CHECK_IN, { vaultId, date });
}

// ── Chat ───────────────────────────────────────────────────────

export function sendChat(input: SendChatInput): Promise<ChatMessage> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.SEND_CHAT, { input });
}

export function getChatHistory(vaultId: string, dailyPlanId: string): Promise<ChatMessage[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_CHAT_HISTORY, { vaultId, dailyPlanId });
}

export function getChatDates(vaultId: string, limit?: number): Promise<string[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_CHAT_DATES, { vaultId, limit });
}

// ── Stats & Revisions ──────────────────────────────────────────

export function getRecentStats(vaultId: string, days?: number): Promise<DailyStats[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_RECENT_STATS, { vaultId, days });
}

export function countCheckIns(vaultId: string): Promise<number> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.COUNT_CHECK_INS, { vaultId });
}

export function getRevisions(vaultId: string, dailyPlanId: string): Promise<PlanRevision[]> {
  return invoke(DAILY_LOOP_IPC_COMMANDS.GET_REVISIONS, { vaultId, dailyPlanId });
}

// ── AI Commands ────────────────────────────────────────────────

export function generatePlan(
  vaultId: string,
  modelId: string,
  date: string,
): Promise<GeneratedPlanResponse> {
  return invoke(DAILY_LOOP_AI_COMMANDS.GENERATE_PLAN, { vaultId, modelId, date });
}

export function chatReprioritize(
  vaultId: string,
  planId: string,
  modelId: string,
  message: string,
): Promise<ChatReprioritizeResponse> {
  return invoke(DAILY_LOOP_AI_COMMANDS.CHAT_REPRIORITIZE, { vaultId, planId, modelId, message });
}

export function generateSummary(
  vaultId: string,
  modelId: string,
  date: string,
): Promise<string> {
  return invoke(DAILY_LOOP_AI_COMMANDS.GENERATE_SUMMARY, { vaultId, modelId, date });
}
