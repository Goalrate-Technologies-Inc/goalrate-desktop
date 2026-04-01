import { useCallback, useEffect, useState } from 'react';
import type {
  DailyPlan,
  DailyStats,
  Outcome,
  ChatMessage,
  CheckIn,
} from '@goalrate-app/shared';
import * as dailyLoopIpc from '../lib/dailyLoopIpc';
import { DEFAULT_AI_MODEL } from '../lib/dailyLoopIpc';
import { useVault } from '../context/VaultContext';

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {return err.message;}
  if (typeof err === 'string') {return err;}
  if (err && typeof err === 'object') {
    // Tauri invoke errors are plain objects with a message field
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') {return obj.message;}
    if (typeof obj.error === 'string') {return obj.error;}
    try { return JSON.stringify(err); } catch { /* fall through */ }
  }
  return String(err);
}

function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface UseDailyLoopReturn {
  // State
  plan: DailyPlan | null;
  outcomes: Outcome[];
  chatHistory: ChatMessage[];
  checkIn: CheckIn | null;
  isLoading: boolean;
  error: string | null;
  date: string;
  /** Map of task_id → human-readable title */
  taskTitles: Record<string, string>;
  /** Map of task_id → { priority, deadline } from vault goal frontmatter */
  taskMetadata: Record<string, { priority: string; deadline: string }>;
  /** Merge AI-generated task titles into the map */
  mergeTaskTitles: (titles: Record<string, string>) => void;
  /** Recent daily stats for completion rate trends (last 7 days) */
  recentStats: DailyStats[];

  // Plan actions
  createPlan: () => Promise<void>;
  updatePlan: (top3OutcomeIds?: string[], taskOrder?: string[]) => Promise<void>;
  // Outcome actions
  addOutcome: (title: string, linkedTaskIds: string[], aiGenerated: boolean) => Promise<void>;
  updateOutcome: (outcomeId: string, title?: string, linkedTaskIds?: string[]) => Promise<void>;
  deleteOutcome: (outcomeId: string) => Promise<void>;

  // Task actions
  deferTask: (taskId: string, reason?: string) => Promise<void>;
  toggleTaskCompletion: (planId: string, taskId: string) => Promise<void>;

  // Chat actions
  sendChat: (content: string) => Promise<ChatMessage>;

  // Check-in actions
  createCheckIn: (
    completedTaskIds: string[],
    notes?: string,
    aiSummary?: string,
  ) => Promise<void>;

  // Navigation
  setDate: (date: string) => void;

  // Refresh
  refresh: () => Promise<void>;

  // Reactivity — increments on every data mutation so dependent components can re-fetch
  dataVersion: number;
}

export function useDailyLoop(): UseDailyLoopReturn {
  const { currentVault } = useVault();
  const vaultId = currentVault?.id ?? '';

  const [date, setDate] = useState(() => toLocalDateString());

  // Auto-detect date rollover when the window regains focus (e.g., app left open overnight)
  useEffect(() => {
    const handleFocus = (): void => {
      const today = toLocalDateString();
      setDate((prev) => {
        if (prev !== today) {
          return today;
        }
        return prev;
      });
    };
    window.addEventListener('focus', handleFocus);
    // Also check on visibility change (tab/window becomes visible)
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        handleFocus();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [checkIn, setCheckIn] = useState<CheckIn | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  const [taskMetadata, setTaskMetadata] = useState<Record<string, { priority: string; deadline: string }>>({});
  const [recentStats, setRecentStats] = useState<DailyStats[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const bumpVersion = useCallback(() => setDataVersion((v) => v + 1), []);
  const mergeTaskTitles = useCallback((titles: Record<string, string>) => {
    setTaskTitles((prev) => ({ ...prev, ...titles }));
  }, []);

  const loadData = useCallback(async (opts?: { silent?: boolean }) => {
    if (!vaultId) {return;}

    if (!opts?.silent) {
      setIsLoading(true);
    }
    setError(null);

    try {
      const fetchedPlan = await dailyLoopIpc.getPlan(vaultId, date);
      setPlan(fetchedPlan);

      // Fetch task metadata (priority/deadline) from vault goals
      try {
        const meta = await dailyLoopIpc.getTaskMetadata(vaultId);
        setTaskMetadata(meta);
      } catch {
        setTaskMetadata({});
      }

      if (fetchedPlan) {
        // Reset task titles from the plan (prevents stale data from other dates/vaults)
        const planTitles = fetchedPlan.taskTitles ?? {};
        setTaskTitles(planTitles);

        const [fetchedOutcomes, fetchedChat] = await Promise.all([
          dailyLoopIpc.getOutcomes(vaultId, fetchedPlan.id),
          dailyLoopIpc.getChatHistory(vaultId, fetchedPlan.id),
        ]);
        setOutcomes(fetchedOutcomes);
        setChatHistory(fetchedChat);
      } else {
        setOutcomes([]);
        setChatHistory([]);
      }

      const fetchedCheckIn = await dailyLoopIpc.getCheckIn(vaultId, date);
      setCheckIn(fetchedCheckIn);

      // Fetch recent stats for completion rate trend (non-blocking)
      try {
        const stats = await dailyLoopIpc.getRecentStats(vaultId, 7);
        setRecentStats(stats);
      } catch {
        setRecentStats([]);
      }

      bumpVersion(); // Notify dependent components (DomainSidebar, etc.) to refresh
    } catch (err) {
      const msg = extractErrorMessage(err);
      setError(msg);
    } finally {
      if (!opts?.silent) {
        setIsLoading(false);
      }
    }
  }, [vaultId, date, bumpVersion]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const createPlan = useCallback(async () => {
    if (!vaultId) {return;}
    try {
      const newPlan = await dailyLoopIpc.createPlan(vaultId, date);
      setPlan(newPlan);
      setOutcomes([]);
      setChatHistory([]);
      setError(null);
      bumpVersion();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  }, [vaultId, date, bumpVersion]);

  const updatePlan = useCallback(
    async (top3OutcomeIds?: string[], taskOrder?: string[]) => {
      if (!vaultId || !plan) {return;}
      try {
        const updated = await dailyLoopIpc.updatePlan({
          vaultId,
          planId: plan.id,
          top3OutcomeIds,
          taskOrder,
        });
        setPlan(updated);
        setError(null);
        bumpVersion();
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, plan, bumpVersion],
  );

  const addOutcome = useCallback(
    async (title: string, linkedTaskIds: string[], aiGenerated: boolean) => {
      if (!vaultId || !plan) {return;}
      try {
        const outcome = await dailyLoopIpc.createOutcome({
          vaultId,
          dailyPlanId: plan.id,
          title,
          linkedTaskIds,
          aiGenerated,
        });
        setOutcomes((prev) => [...prev, outcome]);
        setError(null);
        bumpVersion();
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, plan, bumpVersion],
  );

  const updateOutcomeAction = useCallback(
    async (outcomeId: string, title?: string, linkedTaskIds?: string[]) => {
      if (!vaultId) {return;}
      try {
        const updated = await dailyLoopIpc.updateOutcome({
          vaultId,
          outcomeId,
          title,
          linkedTaskIds,
        });
        setOutcomes((prev) => prev.map((o) => (o.id === outcomeId ? updated : o)));
        setError(null);
        bumpVersion();
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, bumpVersion],
  );

  const deleteOutcomeAction = useCallback(
    async (outcomeId: string) => {
      if (!vaultId) {return;}
      try {
        await dailyLoopIpc.deleteOutcome(vaultId, outcomeId);
        setOutcomes((prev) => prev.filter((o) => o.id !== outcomeId));
        setError(null);
        bumpVersion();
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, bumpVersion],
  );

  const deferTask = useCallback(
    async (taskId: string, reason?: string) => {
      if (!vaultId) {return;}
      try {
        await dailyLoopIpc.deferTask({ vaultId, taskId, date, reason });
        setError(null);
        bumpVersion();
        await loadData({ silent: true }); // Refresh plan to reflect deferred task
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, date, bumpVersion, loadData],
  );

  const toggleTaskCompletion = useCallback(
    async (planId: string, taskId: string) => {
      if (!vaultId) {
        console.warn('[useDailyLoop] toggleTaskCompletion: no vaultId');
        return;
      }
      if (!planId) {
        console.warn('[useDailyLoop] toggleTaskCompletion: no planId');
        return;
      }
      try {
        await dailyLoopIpc.toggleTaskCompletion(vaultId, planId, taskId);
        // Silent reload — don't flash loading spinner, just refresh plan from DB
        await loadData({ silent: true });
      } catch (err) {
        console.error('[useDailyLoop] toggleTaskCompletion FAILED:', err);
        setError(extractErrorMessage(err));
        // Reload anyway so UI re-syncs with DB state
        await loadData({ silent: true });
      }
    },
    [vaultId, loadData],
  );

  const sendChat = useCallback(
    async (content: string): Promise<ChatMessage> => {
      if (!vaultId || !plan) {throw new Error('No vault or plan');}

      // 1. Store user message and show it immediately
      const userMsg = await dailyLoopIpc.sendChat({ vaultId, dailyPlanId: plan.id, content });
      setChatHistory((prev) => [...prev, userMsg]);

      // 2. Call AI to get a response
      try {
        const aiResponse = await dailyLoopIpc.chatReprioritize(
          vaultId,
          plan.id,
          DEFAULT_AI_MODEL,
          content,
        );

        // 3. Reload chat history to include the AI response stored by the backend
        const updatedHistory = await dailyLoopIpc.getChatHistory(vaultId, plan.id);
        setChatHistory(updatedHistory);

        // 4. If plan was updated, merge task titles and refresh plan data
        if (aiResponse.taskTitles && Object.keys(aiResponse.taskTitles).length > 0) {
          mergeTaskTitles(aiResponse.taskTitles);
        }
        if (aiResponse.planUpdated) {
          await loadData();
        }
        bumpVersion();
      } catch (err) {
        // If AI call fails, add an error message to chat
        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          dailyPlanId: plan.id,
          role: 'ai',
          content: `Sorry, I encountered an error: ${extractErrorMessage(err)}`,
          timestamp: new Date().toISOString(),
        };
        setChatHistory((prev) => [...prev, errorMsg]);
      }

      return userMsg;
    },
    [vaultId, plan, loadData, bumpVersion, mergeTaskTitles],
  );

  const createCheckInAction = useCallback(
    async (completedTaskIds: string[], notes?: string, aiSummary?: string) => {
      if (!vaultId) {return;}
      try {
        const ci = await dailyLoopIpc.createCheckIn({
          vaultId,
          date,
          completedTaskIds,
          notes,
          aiSummary,
        });
        setCheckIn(ci);
        setError(null);
        bumpVersion();
      } catch (err) {
        setError(extractErrorMessage(err));
      }
    },
    [vaultId, date, bumpVersion],
  );

  return {
    plan,
    outcomes,
    chatHistory,
    checkIn,
    isLoading,
    error,
    date,
    taskTitles,
    taskMetadata,
    mergeTaskTitles,
    recentStats,
    createPlan,
    updatePlan,
    addOutcome,
    updateOutcome: updateOutcomeAction,
    deleteOutcome: deleteOutcomeAction,
    deferTask,
    toggleTaskCompletion,
    sendChat,
    createCheckIn: createCheckInAction,
    setDate,
    refresh: loadData,
    dataVersion,
  };
}
