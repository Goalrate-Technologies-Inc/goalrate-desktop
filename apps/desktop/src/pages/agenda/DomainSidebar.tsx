import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Target,
  FolderKanban,
  Rocket,
  Heart,
  Dumbbell,
  GraduationCap,
  Briefcase,
  Home,
  Palette,
  Plus,
  Pencil,
  Archive,
  Trash2,
  FileText,
  X,
  ArrowUp,
  ArrowRight,
  ArrowDown,
  Check,
  Repeat,
  CircleDot,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { useVault } from "../../context/VaultContext";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../../components/ContextMenu";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  pathsAffectRoadmap,
  vaultUpdatePaths,
  type VaultLibraryUpdatedPayload,
} from "../../lib/vaultWatcherEvents";
import { useSubscription } from "../../context/SubscriptionContext";
import { attachTauriEventListener } from "../../lib/tauriEvents";

// ── Icon mapping ────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  health: Dumbbell,
  fitness: Dumbbell,
  wellness: Heart,
  family: Home,
  personal: Heart,
  relationships: Heart,
  career: Briefcase,
  work: Briefcase,
  startup: Rocket,
  business: Briefcase,
  education: GraduationCap,
  learning: GraduationCap,
  creative: Palette,
  finance: Briefcase,
  wealth: Briefcase,
  home: Home,
};

function iconForDomain(domain: string): LucideIcon {
  const lower = domain.toLowerCase();
  for (const [keyword, icon] of Object.entries(DOMAIN_ICONS)) {
    if (lower.includes(keyword)) {
      return icon;
    }
  }
  return Target;
}

// ── Types ───────────────────────────────────────────────────

interface GoalSummary {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: string;
}

const GOAL_PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--semantic-error)",
  high: "var(--progress-low)",
  medium: "var(--progress-mid)",
  low: "var(--accent-projects)",
};

const GOAL_PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const GOAL_PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
] as const;

const GOAL_PRIORITY_ICONS: Record<string, LucideIcon> = {
  low: ArrowDown,
  medium: CircleDot,
  high: ArrowRight,
  critical: ArrowUp,
};

const GOAL_PRIORITY_VALUES = new Set<string>(
  GOAL_PRIORITY_OPTIONS.map((option) => option.value),
);

const RECURRENCE_OPTIONS = [
  { value: "", label: "No repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

const RECURRENCE_LABELS = RECURRENCE_OPTIONS.reduce<Record<string, string>>(
  (labels, option) => {
    labels[option.value] = option.label;
    return labels;
  },
  {},
);

function normalizeGoalPriority(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized && GOAL_PRIORITY_VALUES.has(normalized) ? normalized : "medium";
}

function goalPriorityLabel(priority: string): string {
  return GOAL_PRIORITY_LABELS[normalizeGoalPriority(priority)];
}

function goalPriorityColor(priority: string): string {
  return GOAL_PRIORITY_COLORS[normalizeGoalPriority(priority)];
}

function normalizeTaskRecurrence(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ["none", "false", "no"].includes(normalized) ? "" : normalized;
}

function normalizeTaskScheduledDate(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (["none", "false", "no"].includes(trimmed.toLowerCase())) {
    return "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function taskScheduledDate(task: GoalFrontmatterTask): string {
  return normalizeTaskScheduledDate(
    task.scheduledDate ?? task.scheduled_date,
  );
}

function recurrenceLabel(value: string): string {
  return (
    RECURRENCE_LABELS[value] ??
    value
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

interface ContextMenuState {
  x: number;
  y: number;
  type: "domain" | "goal";
  domain?: string;
  goalId?: string;
  goalTitle?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

interface GoalFrontmatterTask {
  id: string;
  title: string;
  status: string;
  parentId?: string | null;
  recurring?: string | null;
  scheduledDate?: string | null;
  scheduled_date?: string | null;
  completedAt?: string | null;
}

interface GoalPreview extends GoalSummary {
  goalId: string;
  notes: string;
  tasks: GoalFrontmatterTask[];
}

function isGoalFrontmatterTaskDone(task: GoalFrontmatterTask): boolean {
  return task.status === "completed" || task.status === "done" || !!task.completedAt;
}

interface DomainSidebarProps {
  dataVersion?: number;
  onMutation?: () => void;
  openGoalRequest?: {
    requestId: number;
    goalId: string;
    title: string;
  } | null;
}

// ── Component ───────────────────────────────────────────────

export function DomainSidebar({
  dataVersion = 0,
  onMutation,
  openGoalRequest = null,
}: DomainSidebarProps): React.ReactElement {
  const { currentVault } = useVault();
  const { allowsAi } = useSubscription();
  const vaultId = currentVault?.id;

  // Data
  const [goals, setGoals] = useState<GoalSummary[]>([]);

  // UI state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [newGoalDomain, setNewGoalDomain] = useState("");
  const [newDomainName, setNewDomainName] = useState("");
  const [newGoalDeadline, setNewGoalDeadline] = useState("");

  const [viewingNotes, setViewingNotes] = useState<GoalPreview | null>(null);
  const [isEditingViewedNotes, setIsEditingViewedNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesSaveError, setNotesSaveError] = useState<string | null>(null);
  const [isSavingPriority, setIsSavingPriority] = useState(false);
  const [prioritySaveError, setPrioritySaveError] = useState<string | null>(
    null,
  );
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [editingTaskRecurrence, setEditingTaskRecurrence] = useState("");
  const [editingTaskScheduledDate, setEditingTaskScheduledDate] = useState("");

  const editInputRef = useRef<HTMLInputElement>(null);
  const addTitleRef = useRef<HTMLInputElement>(null);
  const taskEditInputRef = useRef<HTMLInputElement>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null);
  const vaultEventGoalRefreshInFlightRef = useRef(false);
  const vaultEventGoalRefreshQueuedRef = useRef(false);

  // ── Fetch goals ─────────────────────────────────────────

  const loadGoals = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!vaultId) {
        return;
      }

      try {
        const raw = await invoke<
          Array<{
            id: string;
            title: string;
            status?: string;
            priority?: string;
            type?: string;
            goalType?: string;
            domain?: string;
            description?: string;
          }>
        >("list_goals", { vaultId });
        if (!isCancelled?.()) {
          setGoals(
            raw
              .map((g) => ({
                id: g.id,
                title: g.title || g.id,
                domain:
                  g.domain ||
                  g.type ||
                  g.goalType ||
                  g.description ||
                  "Uncategorized",
                status: g.status || "active",
                priority: normalizeGoalPriority(g.priority),
              }))
              .filter((g) => g.status !== "archived"),
          );
        }
      } catch {
        if (!isCancelled?.()) {
          setGoals([]);
        }
      }
    },
    [vaultId],
  );

  useEffect(() => {
    if (!vaultId) {
      return;
    }
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        void loadGoals(() => cancelled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [vaultId, dataVersion, loadGoals]);

  const refreshGoalsFromVaultEvent = useCallback(() => {
    if (vaultEventGoalRefreshInFlightRef.current) {
      vaultEventGoalRefreshQueuedRef.current = true;
      return;
    }

    vaultEventGoalRefreshInFlightRef.current = true;
    void (async () => {
      try {
        do {
          vaultEventGoalRefreshQueuedRef.current = false;
          await loadGoals();
        } while (vaultEventGoalRefreshQueuedRef.current);
      } finally {
        vaultEventGoalRefreshInFlightRef.current = false;
      }
    })();
  }, [loadGoals]);

  useEffect(() => {
    if (!vaultId) {
      return;
    }

    return attachTauriEventListener<VaultLibraryUpdatedPayload>(
      "vault-library-updated",
      (event) => {
        const paths = vaultUpdatePaths(event.payload ?? {});
        if (event.payload?.vaultId === vaultId && pathsAffectRoadmap(paths)) {
          refreshGoalsFromVaultEvent();
        }
      },
      {
        onError: (err) => {
          console.error(
            "[DomainSidebar] Failed to listen for vault changes:",
            err,
          );
        },
      },
    );
  }, [vaultId, refreshGoalsFromVaultEvent]);

  // Auto-focus edit inputs
  useEffect(() => {
    if (editingGoalId || editingDomain) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingGoalId, editingDomain]);

  useEffect(() => {
    if (showAddGoal) {
      addTitleRef.current?.focus();
    }
  }, [showAddGoal]);

  useEffect(() => {
    if (editingTaskId) {
      taskEditInputRef.current?.focus();
      taskEditInputRef.current?.select();
    }
  }, [editingTaskId]);

  // ── Group by domain ─────────────────────────────────────

  const byDomain = goals.reduce<Record<string, GoalSummary[]>>((acc, g) => {
    const d = g.domain || "Uncategorized";
    if (!acc[d]) {
      acc[d] = [];
    }
    acc[d].push(g);
    return acc;
  }, {});

  const domainNames = Object.keys(byDomain);

  // ── Mutations ───────────────────────────────────────────

  const mutate = useCallback(() => {
    onMutation?.();
  }, [onMutation]);

  const handleSaveGoalTitle = useCallback(async () => {
    if (!vaultId || !editingGoalId || !editValue.trim()) {
      setEditingGoalId(null);
      return;
    }
    try {
      await invoke("update_goal", {
        vaultId,
        goalId: editingGoalId,
        data: { title: editValue.trim() },
      });
      mutate();
    } catch (err) {
      console.error("Failed to update goal title:", err);
    }
    setEditingGoalId(null);
  }, [vaultId, editingGoalId, editValue, mutate]);

  const handleSaveDomainRename = useCallback(async () => {
    if (
      !vaultId ||
      !editingDomain ||
      !editValue.trim() ||
      editValue.trim() === editingDomain
    ) {
      setEditingDomain(null);
      return;
    }
    try {
      await invoke("rename_domain", {
        vaultId,
        oldType: editingDomain,
        newType: editValue.trim(),
      });
      mutate();
    } catch (err) {
      console.error("Failed to rename domain:", err);
    }
    setEditingDomain(null);
  }, [vaultId, editingDomain, editValue, mutate]);

  const handleDeleteGoal = useCallback(
    async (goalId: string) => {
      if (!vaultId) {
        return;
      }
      try {
        await invoke("delete_goal", { vaultId, goalId, confirmed: true });
        mutate();
      } catch (err) {
        console.error("Failed to delete goal:", err);
      }
    },
    [vaultId, mutate],
  );

  const handleArchiveGoal = useCallback(
    async (goalId: string) => {
      if (!vaultId) {
        return;
      }
      try {
        await invoke("archive_goal", { vaultId, goalId });
        mutate();
      } catch (err) {
        console.error("Failed to archive goal:", err);
      }
    },
    [vaultId, mutate],
  );

  const handleChangeGoalPriority = useCallback(
    async (goalId: string, newPriority: string) => {
      if (!vaultId) {
        return;
      }
      const priority = normalizeGoalPriority(newPriority);
      const isViewingGoal = viewingNotes?.id === goalId;
      if (isViewingGoal) {
        setIsSavingPriority(true);
        setPrioritySaveError(null);
      }
      try {
        await invoke("update_goal", {
          vaultId,
          goalId,
          data: { priority },
        });
        setGoals((currentGoals) =>
          currentGoals.map((goal) =>
            goal.id === goalId
              ? { ...goal, priority }
              : goal,
          ),
        );
        setViewingNotes((current) =>
          current?.id === goalId
            ? { ...current, priority }
            : current,
        );
        mutate();
      } catch (err) {
        console.error("Failed to change goal priority:", err);
        if (isViewingGoal) {
          setPrioritySaveError(
            err instanceof Error ? err.message : "Failed to save priority",
          );
        }
      } finally {
        if (isViewingGoal) {
          setIsSavingPriority(false);
        }
      }
    },
    [vaultId, viewingNotes, mutate],
  );

  const handleChangeGoalDomain = useCallback(
    async (goalId: string, newType: string) => {
      if (!vaultId) {
        return;
      }
      try {
        await invoke("update_goal", {
          vaultId,
          goalId,
          data: { goalType: newType },
        });
        mutate();
      } catch (err) {
        console.error("Failed to change goal domain:", err);
      }
    },
    [vaultId, mutate],
  );

  const handleAddGoal = useCallback(async () => {
    if (!vaultId || !newGoalTitle.trim()) {
      return;
    }
    const domain =
      newGoalDomain === "__other__" ? newDomainName.trim() : newGoalDomain;
    if (!domain) {
      return;
    }
    try {
      const created = await invoke<{ id: string }>("create_goal", {
        vaultId,
        data: {
          title: newGoalTitle.trim(),
          goalType: domain,
          deadline: newGoalDeadline || undefined,
          priority: "medium",
          tags: [domain],
        },
      });
      setShowAddGoal(false);
      setNewGoalTitle("");
      setNewGoalDomain("");
      setNewDomainName("");
      setNewGoalDeadline("");
      mutate();

      // AI enrichment in the background — don't block the UI
      if (created?.id && allowsAi) {
        const goalTitle = newGoalTitle.trim();
        const goalDeadline = newGoalDeadline || null;
        const goalId = created.id;
        const aiModel = "anthropic::claude-sonnet-4-5-20250929";

        // Run priority assessment and task generation concurrently
        Promise.allSettled([
          // Assess priority
          invoke<string>("assess_goal_priority", {
            modelId: aiModel,
            title: goalTitle,
            domain,
            deadline: goalDeadline,
          }).then(async (priority) => {
            if (priority && priority !== "medium") {
              await invoke("update_goal", {
                vaultId,
                goalId,
                data: { priority: normalizeGoalPriority(priority) },
              });
            }
          }),
          // Generate initial tasks
          invoke<string[]>("generate_goal_tasks", {
            vaultId,
            goalId,
            modelId: aiModel,
            title: goalTitle,
            domain,
            deadline: goalDeadline,
          }),
        ]).then((results) => {
          for (const result of results) {
            if (result.status === "rejected") {
              console.warn("AI goal enrichment failed:", result.reason);
            }
          }
          mutate();
        });
      }
    } catch (err) {
      console.error("Failed to create goal:", err);
    }
  }, [
    vaultId,
    allowsAi,
    newGoalTitle,
    newGoalDomain,
    newDomainName,
    newGoalDeadline,
    mutate,
  ]);

  const handleViewGoal = useCallback(
    async (
      goalId: string,
      title: string,
      options?: { editNotes?: boolean },
    ) => {
      if (!vaultId) {
        return;
      }
      try {
        const summary = goals.find((goal) => goal.id === goalId);
        const [goal, tasks] = await Promise.all([
          invoke<{
            title?: string;
            notes?: string;
            priority?: string;
            status?: string;
            domain?: string;
            type?: string;
            goalType?: string;
          }>("get_goal", { vaultId, goalId }),
          invoke<GoalFrontmatterTask[]>("list_goal_frontmatter_tasks", {
            vaultId,
            goalId,
          }),
        ]);
        setViewingNotes({
          id: goalId,
          goalId,
          title: goal.title || title,
          domain:
            goal.domain ||
            goal.type ||
            goal.goalType ||
            summary?.domain ||
            "Uncategorized",
          status: goal.status || summary?.status || "active",
          priority: normalizeGoalPriority(goal.priority || summary?.priority),
          notes: goal.notes ?? "",
          tasks: tasks ?? [],
        });
        setNotesDraft(goal.notes ?? "");
        setNotesSaveError(null);
        setPrioritySaveError(null);
        setIsEditingViewedNotes(options?.editNotes ?? false);
      } catch (err) {
        console.error("Failed to load goal:", err);
      }
    },
    [vaultId, goals],
  );

  const openGoalRequestId = openGoalRequest?.requestId;
  const openGoalId = openGoalRequest?.goalId;
  const openGoalTitle = openGoalRequest?.title;

  useEffect(() => {
    if (!openGoalId || !openGoalTitle) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void handleViewGoal(openGoalId, openGoalTitle);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [handleViewGoal, openGoalId, openGoalRequestId, openGoalTitle]);

  const handleOpenNotes = useCallback(
    (goalId: string, title: string) => {
      void handleViewGoal(goalId, title, { editNotes: true });
    },
    [handleViewGoal],
  );

  useEffect(() => {
    if (isEditingViewedNotes) {
      notesTextareaRef.current?.focus();
    }
  }, [isEditingViewedNotes]);

  const handleEditViewedNotes = useCallback(() => {
    if (!viewingNotes) {
      return;
    }
    setNotesDraft(viewingNotes.notes);
    setNotesSaveError(null);
    setIsEditingViewedNotes(true);
  }, [viewingNotes]);

  const handleSaveNotes = useCallback(
    async () => {
      if (!vaultId || !viewingNotes) {
        return;
      }
      const goalId = viewingNotes.goalId;
      const content = notesDraft;
      setIsSavingNotes(true);
      setNotesSaveError(null);
      try {
        await invoke("update_goal", {
          vaultId,
          goalId,
          data: { notes: content },
        });
        setViewingNotes((current) =>
          current?.goalId === goalId
            ? { ...current, notes: content }
            : current,
        );
        setIsEditingViewedNotes(false);
        mutate();
      } catch (err) {
        console.error("Failed to save goal notes:", err);
        setNotesSaveError(
          err instanceof Error ? err.message : "Failed to save notes",
        );
      } finally {
        setIsSavingNotes(false);
      }
    },
    [vaultId, viewingNotes, notesDraft, mutate],
  );

  const handleCancelNotesEdit = useCallback(() => {
    setNotesDraft(viewingNotes?.notes ?? "");
    setNotesSaveError(null);
    setIsEditingViewedNotes(false);
  }, [viewingNotes]);

  const handleNotesKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        void handleSaveNotes();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelNotesEdit();
      }
    },
    [handleCancelNotesEdit, handleSaveNotes],
  );

  // ── Task CRUD helpers (operate on viewingNotes state) ──

  const refreshViewingTasks = useCallback(
    async (goalId: string) => {
      if (!vaultId) {
        return;
      }
      const tasks = await invoke<GoalFrontmatterTask[]>(
        "list_goal_frontmatter_tasks",
        { vaultId, goalId },
      );
      setViewingNotes((prev) =>
        prev ? { ...prev, tasks: tasks ?? [] } : prev,
      );
    },
    [vaultId],
  );

  const handleAddTask = useCallback(async () => {
    if (!vaultId || !viewingNotes || !newTaskTitle.trim()) {
      return;
    }
    try {
      await invoke("add_goal_frontmatter_task", {
        vaultId,
        goalId: viewingNotes.goalId,
        title: newTaskTitle.trim(),
      });
      setNewTaskTitle("");
      await refreshViewingTasks(viewingNotes.goalId);
    } catch (err) {
      console.error("Failed to add task:", err);
    }
  }, [vaultId, viewingNotes, newTaskTitle, refreshViewingTasks]);

  const handleSaveTaskEdit = useCallback(
    async (task: GoalFrontmatterTask) => {
      if (!vaultId || !viewingNotes || !editingTaskTitle.trim()) {
        return;
      }
      const title = editingTaskTitle.trim();
      const recurrence = normalizeTaskRecurrence(editingTaskRecurrence);
      const currentRecurrence = normalizeTaskRecurrence(task.recurring);
      const scheduledDate = normalizeTaskScheduledDate(editingTaskScheduledDate);
      const currentScheduledDate = taskScheduledDate(task);
      try {
        await invoke("update_goal_frontmatter_task", {
          vaultId,
          goalId: viewingNotes.goalId,
          taskId: task.id,
          title,
        });
        if (recurrence !== currentRecurrence) {
          await invoke("update_goal_frontmatter_task_recurrence", {
            vaultId,
            goalId: viewingNotes.goalId,
            taskId: task.id,
            recurrence: recurrence || null,
          });
        }
        if (scheduledDate !== currentScheduledDate) {
          await invoke("update_goal_frontmatter_task_scheduled_date", {
            vaultId,
            goalId: viewingNotes.goalId,
            taskId: task.id,
            scheduledDate: scheduledDate || null,
          });
        }
        setEditingTaskId(null);
        setEditingTaskTitle("");
        setEditingTaskRecurrence("");
        setEditingTaskScheduledDate("");
        await refreshViewingTasks(viewingNotes.goalId);
      } catch (err) {
        console.error("Failed to update task:", err);
      }
    },
    [
      vaultId,
      viewingNotes,
      editingTaskTitle,
      editingTaskRecurrence,
      editingTaskScheduledDate,
      refreshViewingTasks,
    ],
  );

  const handleToggleTaskStatus = useCallback(
    async (task: GoalFrontmatterTask) => {
      if (!vaultId || !viewingNotes) {
        return;
      }
      try {
        await invoke("update_goal_frontmatter_task_status", {
          vaultId,
          goalId: viewingNotes.goalId,
          taskId: task.id,
          status: isGoalFrontmatterTaskDone(task) ? "todo" : "completed",
        });
        await refreshViewingTasks(viewingNotes.goalId);
      } catch (err) {
        console.error("Failed to update task status:", err);
      }
    },
    [vaultId, viewingNotes, refreshViewingTasks],
  );

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      if (!vaultId || !viewingNotes) {
        return;
      }
      try {
        await invoke("delete_goal_frontmatter_task", {
          vaultId,
          goalId: viewingNotes.goalId,
          taskId,
          confirmed: true,
        });
        await refreshViewingTasks(viewingNotes.goalId);
      } catch (err) {
        console.error("Failed to delete task:", err);
      }
    },
    [vaultId, viewingNotes, refreshViewingTasks],
  );

  // ── Context menu builders ───────────────────────────────

  const buildDomainMenuItems = (domain: string): ContextMenuItem[] => [
    {
      label: "Rename Domain",
      icon: Pencil,
      onClick: () => {
        setEditingDomain(domain);
        setEditValue(domain);
      },
    },
  ];

  const buildGoalMenuItems = (goal: GoalSummary): ContextMenuItem[] => [
    {
      label: "Rename",
      icon: Pencil,
      onClick: () => {
        setEditingGoalId(goal.id);
        setEditValue(goal.title);
      },
    },
    {
      label: "Edit Notes",
      icon: FileText,
      onClick: () => handleOpenNotes(goal.id, goal.title),
    },
    {
      label: "Change Domain",
      icon: FolderKanban,
      onClick: () => {
        // Show a simple prompt-style domain picker via the add-goal domain select
        const newDomain = window.prompt("Move to domain:", goal.domain);
        if (newDomain && newDomain !== goal.domain) {
          handleChangeGoalDomain(goal.id, newDomain);
        }
      },
    },
    { label: "", onClick: () => {}, separator: true },
    ...GOAL_PRIORITY_OPTIONS.filter(
      (option) => option.value !== normalizeGoalPriority(goal.priority),
    ).map(
      (option): ContextMenuItem => ({
        label: `Priority: ${option.label}`,
        icon: GOAL_PRIORITY_ICONS[option.value],
        onClick: () => handleChangeGoalPriority(goal.id, option.value),
      }),
    ),
    { label: "", onClick: () => {}, separator: true },
    {
      label: "Archive",
      icon: Archive,
      onClick: () => handleArchiveGoal(goal.id),
    },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      onClick: () => {
        setConfirmAction({
          title: "Delete Goal",
          message: `Are you sure you want to delete "${goal.title}"? This cannot be undone.`,
          confirmLabel: "Delete",
          danger: true,
          onConfirm: () => {
            handleDeleteGoal(goal.id);
            setConfirmAction(null);
          },
        });
      },
    },
  ];

  // ── Key handlers ────────────────────────────────────────

  const handleEditKeyDown = (
    e: React.KeyboardEvent,
    save: () => void,
  ): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      setEditingGoalId(null);
      setEditingDomain(null);
    }
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r p-4"
      style={{
        borderColor: "var(--border-light)",
        backgroundColor: "var(--bg-subtle)",
      }}
    >
      <h2
        className="mb-4 font-serif text-lg font-normal"
        style={{ color: "var(--text-secondary)" }}
      >
        Roadmap
      </h2>

      <div className="flex-1">
        {Object.entries(byDomain).map(([domain, domainGoals]) => {
          const DomainIcon = iconForDomain(domain);
          const isEditingThisDomain = editingDomain === domain;

          return (
            <div key={domain} className="mb-4">
              {/* Domain header */}
              <div
                className="mb-1 flex items-center gap-1.5"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    type: "domain",
                    domain,
                  });
                }}
              >
                <DomainIcon
                  className="h-3.5 w-3.5"
                  style={{ color: "var(--text-muted)" }}
                />
                {isEditingThisDomain ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleSaveDomainRename}
                    onKeyDown={(e) =>
                      handleEditKeyDown(e, handleSaveDomainRename)
                    }
                    className="w-full rounded border border-border bg-surface px-1 font-mono text-xs font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  />
                ) : (
                  <span
                    className="cursor-default font-mono text-xs font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {domain}
                  </span>
                )}
              </div>

              {/* Goals list */}
              <ul className="space-y-0.5 pl-5">
                {domainGoals.map((g) => {
                  const isEditing = editingGoalId === g.id;
                  const priorityLabel = goalPriorityLabel(g.priority);
                  return (
                    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
                    <li
                      key={g.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded py-0.5 hover:bg-surface-warm"
                      onMouseUp={(e) => {
                        if (e.button === 0 && !contextMenu) {
                          handleViewGoal(g.id, g.title);
                        }
                      }}
                      onDoubleClick={() => {
                        setEditingGoalId(g.id);
                        setEditValue(g.title);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          type: "goal",
                          goalId: g.id,
                          goalTitle: g.title,
                          domain: g.domain,
                        });
                      }}
                    >
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: goalPriorityColor(g.priority) }}
                        title={`${priorityLabel} priority`}
                        aria-label={`${priorityLabel} priority`}
                      />
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleSaveGoalTitle}
                          onKeyDown={(e) =>
                            handleEditKeyDown(e, handleSaveGoalTitle)
                          }
                          className="w-full rounded border border-border bg-surface px-1 text-sm"
                          style={{ color: "var(--text-primary)" }}
                        />
                      ) : (
                        <span
                          className="truncate text-sm"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {g.title}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {goals.length === 0 && !showAddGoal && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No goals yet. Add a goal to get started.
          </p>
        )}
      </div>

      {/* Add Goal form */}
      {showAddGoal ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border-light bg-surface p-3">
          <input
            ref={addTitleRef}
            type="text"
            placeholder="Goal title"
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleAddGoal();
              }
              if (e.key === "Escape") {
                setShowAddGoal(false);
              }
            }}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: "var(--text-primary)" }}
          />
          <select
            value={newGoalDomain}
            onChange={(e) => setNewGoalDomain(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: "var(--text-primary)" }}
          >
            <option value="">Select domain...</option>
            {domainNames.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            <option value="__other__">Other...</option>
          </select>
          {newGoalDomain === "__other__" && (
            <input
              type="text"
              placeholder="New domain name"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
              style={{ color: "var(--text-primary)" }}
            />
          )}
          <input
            type="date"
            placeholder="Deadline"
            value={newGoalDeadline}
            onChange={(e) => setNewGoalDeadline(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: "var(--text-primary)" }}
          />

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddGoal(false);
                setNewGoalTitle("");
                setNewGoalDomain("");
                setNewDomainName("");
                setNewGoalDeadline("");
              }}
              className="rounded-md border border-border px-2 py-1 text-sm transition-colors hover:bg-surface-warm"
              style={{ color: "var(--text-secondary)" }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddGoal}
              disabled={
                !newGoalTitle.trim() ||
                !newGoalDomain ||
                (newGoalDomain === "__other__" && !newDomainName.trim())
              }
              className="flex-1 rounded-md bg-text-primary px-2 py-1 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Add Goal
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddGoal(true)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-sm transition-colors hover:bg-surface-warm"
          style={{ color: "var(--text-muted)" }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Goal
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            contextMenu.type === "domain"
              ? buildDomainMenuItems(contextMenu.domain!)
              : buildGoalMenuItems(
                  goals.find((g) => g.id === contextMenu.goalId) ?? {
                    id: contextMenu.goalId!,
                    title: contextMenu.goalTitle!,
                    domain: contextMenu.domain!,
                    status: "active",
                    priority: "medium",
                  },
                )
          }
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Goal preview modal */}
      {viewingNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            role="button"
            tabIndex={0}
            aria-label="Close"
            onClick={() => setViewingNotes(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setViewingNotes(null);
              }
            }}
          />
          <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border-light bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-serif text-lg text-text-primary">
                  {viewingNotes.title}
                </h3>
                {(() => {
                  const selectedPriority = normalizeGoalPriority(
                    viewingNotes.priority,
                  );
                  const prioritySelectId = `goal-priority-${viewingNotes.goalId}`;

                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <label
                        htmlFor={prioritySelectId}
                        className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted"
                      >
                        Priority
                      </label>
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: goalPriorityColor(selectedPriority),
                        }}
                        aria-hidden="true"
                      />
                      <select
                        id={prioritySelectId}
                        value={selectedPriority}
                        aria-label={`Priority for ${viewingNotes.title}`}
                        disabled={isSavingPriority}
                        onChange={(e) => {
                          void handleChangeGoalPriority(
                            viewingNotes.goalId,
                            e.target.value,
                          );
                        }}
                        className="rounded border border-border bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-warm focus:border-accent-goals focus:outline-none focus:ring-2 focus:ring-accent-goals/20 disabled:opacity-60"
                      >
                        {GOAL_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {isSavingPriority && (
                        <span className="text-xs text-text-muted">Saving</span>
                      )}
                      {prioritySaveError && (
                        <span className="text-xs text-semantic-error">
                          {prioritySaveError}
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setViewingNotes(null)}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* Notes section */}
              {isEditingViewedNotes ? (
                <div className="-m-3 rounded-md border border-border-light bg-surface-warm/40 p-3">
                  <textarea
                    ref={notesTextareaRef}
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    onKeyDown={handleNotesKeyDown}
                    placeholder="Write notes about this goal..."
                    className="min-h-[180px] w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent-goals focus:outline-none focus:ring-2 focus:ring-accent-goals/20"
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    {notesSaveError && (
                      <span className="mr-auto text-xs text-semantic-error">
                        {notesSaveError}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleCancelNotesEdit}
                      disabled={isSavingNotes}
                      className="rounded px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSaveNotes();
                      }}
                      disabled={isSavingNotes}
                      className="inline-flex items-center gap-1 rounded bg-text-primary px-2 py-1 text-xs font-medium text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      <Check className="h-3 w-3" />
                      {isSavingNotes ? "Saving" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Edit notes for ${viewingNotes.title}`}
                  title="Edit notes"
                  onClick={handleEditViewedNotes}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleEditViewedNotes();
                    }
                  }}
                  className="-m-3 cursor-text rounded-md border border-transparent p-3 transition-colors hover:border-border-light hover:bg-surface-warm/60 focus:outline-none focus:ring-2 focus:ring-accent-goals/30"
                >
                  {viewingNotes.notes ? (
                    <div className="prose max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {viewingNotes.notes}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="italic text-text-muted">
                      No notes yet. Click here to add notes.
                    </p>
                  )}
                </div>
              )}

              {/* Tasks section */}
              {(() => {
                const parentTasks = viewingNotes.tasks.filter(
                  (t) => !t.parentId,
                );
                const childrenOf = (parentId: string): GoalFrontmatterTask[] =>
                  viewingNotes.tasks.filter((t) => t.parentId === parentId);

                const renderTaskRow = (
                  task: GoalFrontmatterTask,
                  isSubtask: boolean,
                ): React.ReactNode => {
                  const isDone = isGoalFrontmatterTaskDone(task);
                  const isEditing = editingTaskId === task.id;
                  const recurrenceValue = normalizeTaskRecurrence(task.recurring);
                  const scheduledDateValue = taskScheduledDate(task);
                  const hasKnownDraftRecurrenceOption =
                    RECURRENCE_OPTIONS.some(
                      (option) => option.value === editingTaskRecurrence,
                    );

                  if (isEditing) {
                    return (
                      <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <input
                            type="text"
                            value={editingTaskTitle}
                            onChange={(e) => setEditingTaskTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleSaveTaskEdit(task);
                              }
                              if (e.key === "Escape") {
                                setEditingTaskId(null);
                                setEditingTaskTitle("");
                                setEditingTaskRecurrence("");
                                setEditingTaskScheduledDate("");
                              }
                            }}
                            className="min-w-[12rem] flex-1 rounded border border-border bg-transparent px-2 py-0.5 text-sm focus:border-accent-goals focus:outline-none"
                            ref={taskEditInputRef}
                          />
                          <div className="flex shrink-0 items-center gap-1 text-text-muted">
                            <CalendarDays
                              className="h-3 w-3"
                              title={
                                editingTaskScheduledDate
                                  ? `Scheduled for ${editingTaskScheduledDate}`
                                  : "No scheduled date"
                              }
                            />
                            <input
                              type="date"
                              aria-label={`Scheduled date for "${task.title}"`}
                              value={editingTaskScheduledDate}
                              onChange={(e) =>
                                setEditingTaskScheduledDate(e.target.value)
                              }
                              className="w-[8.75rem] rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-surface-warm focus:border-accent-goals focus:outline-none focus:ring-2 focus:ring-accent-goals/20"
                            />
                          </div>
                          {!isSubtask && (
                            <div className="flex shrink-0 items-center gap-1 text-text-muted">
                              <Repeat
                                className="h-3 w-3"
                                title={
                                  editingTaskRecurrence
                                    ? `Repeats ${recurrenceLabel(editingTaskRecurrence).toLowerCase()}`
                                    : "Does not repeat"
                                }
                              />
                              <select
                                aria-label={`Recurrence for "${task.title}"`}
                                value={editingTaskRecurrence}
                                onChange={(e) =>
                                  setEditingTaskRecurrence(e.target.value)
                                }
                                className="w-[7.25rem] rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-surface-warm focus:border-accent-goals focus:outline-none focus:ring-2 focus:ring-accent-goals/20"
                              >
                                {RECURRENCE_OPTIONS.map((option) => (
                                  <option
                                    key={option.value || "none"}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                                {!hasKnownDraftRecurrenceOption &&
                                  editingTaskRecurrence && (
                                    <option value={editingTaskRecurrence}>
                                      {recurrenceLabel(editingTaskRecurrence)}
                                    </option>
                                  )}
                              </select>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSaveTaskEdit(task)}
                          className="rounded p-1 text-progress-high transition-colors hover:bg-surface-warm"
                          title="Save"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTaskId(null);
                            setEditingTaskTitle("");
                            setEditingTaskRecurrence("");
                            setEditingTaskScheduledDate("");
                          }}
                          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-warm"
                          title="Cancel"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          void handleToggleTaskStatus(task);
                        }}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-warm hover:text-progress-high focus:outline-none focus:ring-2 focus:ring-accent-goals/30"
                        title={isDone ? "Mark task incomplete" : "Mark task complete"}
                        aria-label={isDone ? "Mark task incomplete" : "Mark task complete"}
                        aria-pressed={isDone}
                      >
                        {isSubtask ? (
                          <CircleDot
                            className={`h-3 w-3 ${isDone ? "text-progress-high" : "text-border"}`}
                          />
                        ) : (
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              isDone
                                ? "border-progress-high bg-progress-high text-white"
                                : "border-border"
                            }`}
                          >
                            {isDone && <Check className="h-3 w-3" />}
                          </span>
                        )}
                      </button>
                      <span
                        className={`flex-1 text-sm ${isDone ? "text-text-muted line-through" : isSubtask ? "text-text-secondary" : "text-text-primary"}`}
                      >
                        {task.title}
                      </span>
                      {!isSubtask && recurrenceValue && (
                        <Repeat
                          className="h-3 w-3 shrink-0 text-text-muted"
                          title={`Repeats ${recurrenceLabel(recurrenceValue).toLowerCase()}`}
                        />
                      )}
                      {scheduledDateValue && (
                        <span
                          className="flex shrink-0 items-center gap-1 text-xs text-text-muted"
                          title={`Scheduled for ${scheduledDateValue}`}
                        >
                          <CalendarDays className="h-3 w-3" aria-hidden="true" />
                          {scheduledDateValue}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTaskId(task.id);
                          setEditingTaskTitle(task.title);
                          setEditingTaskRecurrence(recurrenceValue);
                          setEditingTaskScheduledDate(scheduledDateValue);
                        }}
                        className="invisible rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary group-hover:visible"
                        title="Edit task"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmAction({
                            title: isSubtask ? "Delete Subtask" : "Delete Task",
                            message: `Delete "${task.title}" from this Goal? This removes it from the Goal markdown.`,
                            confirmLabel: "Delete",
                            danger: true,
                            onConfirm: () => {
                              void handleDeleteTask(task.id);
                              setConfirmAction(null);
                            },
                          });
                        }}
                        className="invisible rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-red-500 group-hover:visible"
                        title="Delete task"
                        aria-label={`Delete "${task.title}"`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  );
                };

                return (
                  <div
                    className={
                      isEditingViewedNotes ||
                      viewingNotes.notes ||
                      viewingNotes.tasks.length > 0
                        ? "mt-6 border-t border-border-light pt-6"
                        : ""
                    }
                  >
                    <h4 className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                      Tasks{" "}
                      {viewingNotes.tasks.length > 0 &&
                        `(${viewingNotes.tasks.length})`}
                    </h4>
                    {parentTasks.length > 0 && (
                      <ul className="space-y-1">
                        {parentTasks.map((task) => {
                          const subtasks = childrenOf(task.id);
                          return (
                            <li key={task.id}>
                              {renderTaskRow(task, false)}
                              {subtasks.length > 0 && (
                                <ul className="ml-6 space-y-0.5">
                                  {subtasks.map((sub) => (
                                    <li key={sub.id}>
                                      {renderTaskRow(sub, true)}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="mt-2 flex items-center gap-2 px-2">
                      <Plus className="h-4 w-4 shrink-0 text-text-muted" />
                      <input
                        type="text"
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleAddTask();
                          }
                        }}
                        placeholder="Add a task..."
                        className="flex-1 bg-transparent py-1 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                      />
                      {newTaskTitle.trim() && (
                        <button
                          type="button"
                          onClick={handleAddTask}
                          className="rounded px-2 py-0.5 text-xs font-medium text-text-inverse bg-text-primary hover:opacity-90"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </aside>
  );
}
