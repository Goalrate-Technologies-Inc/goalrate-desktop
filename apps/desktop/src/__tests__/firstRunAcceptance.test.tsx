import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyPlan, ScheduledTask } from "@goalrate-app/shared";
import App from "../App";
import { setupTauriEventMock, type TauriEventMock } from "../test/utils/mockTauri";

interface AcceptanceVault {
  id: string;
  name: string;
  path: string;
  vaultType: string;
  created: string;
  lastOpened?: string;
}

interface AcceptanceTask {
  id: string;
  title: string;
  status: string;
  parentGoalId: string;
}

interface AcceptanceGoal {
  id: string;
  title: string;
  domain: string;
  goalType: string;
  type: string;
  status: string;
  priority: string;
  tasks: AcceptanceTask[];
}

interface AcceptanceMemory {
  userName: string;
  taskCapacityHoursPerDay: number | null;
  sleepHoursNeeded: number | null;
  consent: {
    useForPlanning: boolean;
    allowRemoteAiContext: boolean;
  };
}

interface AcceptanceState {
  vaults: AcceptanceVault[];
  goalsByVault: Map<string, AcceptanceGoal[]>;
  memoryByVault: Map<string, AcceptanceMemory>;
  plansByKey: Map<string, DailyPlan>;
  nextVault: number;
  nextGoal: number;
  nextTick: number;
}

function installTauriRuntime(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: vi.fn() },
  });
}

function uninstallTauriRuntime(): void {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

function slug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "item"
  );
}

function planKey(vaultId: string, date: string): string {
  return `${vaultId}:${date}`;
}

function touchVault(state: AcceptanceState, vault: AcceptanceVault): void {
  state.nextTick += 1;
  vault.lastOpened = new Date(Date.UTC(2026, 3, 29, 16, state.nextTick)).toISOString();
}

function clonePlan(plan: DailyPlan): DailyPlan {
  return {
    ...plan,
    top3OutcomeIds: [...plan.top3OutcomeIds],
    taskOrder: [...plan.taskOrder],
    taskTitles: { ...plan.taskTitles },
    completedTaskIds: [...plan.completedTaskIds],
    scheduledTasks: plan.scheduledTasks?.map((task) => ({ ...task })),
  };
}

function createAcceptanceState(): AcceptanceState {
  return {
    vaults: [],
    goalsByVault: new Map(),
    memoryByVault: new Map(),
    plansByKey: new Map(),
    nextVault: 0,
    nextGoal: 0,
    nextTick: 0,
  };
}

function createPlanFromGoals(
  state: AcceptanceState,
  vaultId: string,
  date: string,
): DailyPlan {
  const goals = state.goalsByVault.get(vaultId) ?? [];
  const tasks = goals.flatMap((goal) => goal.tasks);
  const taskTitles = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
  const scheduledTasks: ScheduledTask[] = tasks.map((task, index) => ({
    id: `scheduled_${task.id}`,
    taskId: task.id,
    title: task.title,
    startTime: index === 0 ? "9:00 AM" : "9:45 AM",
    durationMinutes: 45,
    estimateSource: "manual",
    eisenhowerQuadrant: "do",
  }));
  const now = new Date(Date.UTC(2026, 3, 29, 16, 30)).toISOString();
  return {
    id: `plan_${vaultId}_${date}`,
    date,
    top3OutcomeIds: [],
    taskOrder: tasks.map((task) => task.id),
    taskTitles,
    completedTaskIds: [],
    generatedAt: now,
    scheduledTasks,
    lockedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function installAcceptanceInvokeMock(state: AcceptanceState): void {
  vi.mocked(invoke).mockImplementation(async (command, args?: unknown) => {
    const input = (args ?? {}) as Record<string, unknown>;

    switch (command) {
      case "get_tokens":
      case "get_stored_user":
        return null;
      case "list_vaults":
        return state.vaults.map((vault) => ({ ...vault }));
      case "create_vault": {
        const data = input.data as { name: string; vaultType?: string; type?: string };
        state.nextVault += 1;
        const vault: AcceptanceVault = {
          id: `vault_acceptance_${state.nextVault}`,
          name: data.name,
          path: `/tmp/goalrate-acceptance-${slug(data.name)}`,
          vaultType: data.vaultType ?? data.type ?? "private",
          created: new Date(Date.UTC(2026, 3, 29, 16, state.nextVault)).toISOString(),
        };
        touchVault(state, vault);
        state.vaults.push(vault);
        state.goalsByVault.set(vault.id, []);
        return { ...vault };
      }
      case "open_vault": {
        const path = input.path as string;
        const vault = state.vaults.find((candidate) => candidate.path === path);
        if (!vault) {
          throw new Error(`Unknown vault path: ${path}`);
        }
        touchVault(state, vault);
        return { ...vault };
      }
      case "close_vault":
        return undefined;
      case "delete_vault":
        state.vaults = state.vaults.filter((vault) => vault.id !== input.vaultId);
        return undefined;
      case "list_goals":
        return (state.goalsByVault.get(input.vaultId as string) ?? []).map((goal) => ({
          id: goal.id,
          title: goal.title,
          domain: goal.domain,
          goalType: goal.goalType,
          type: goal.type,
          status: goal.status,
          priority: goal.priority,
        }));
      case "create_goal": {
        const vaultId = input.vaultId as string;
        const data = input.data as {
          title: string;
          goalType?: string;
          tags?: string[];
          tasks?: Array<{ title: string }>;
        };
        state.nextGoal += 1;
        const goalId = `goal_${slug(data.title)}_${state.nextGoal}`;
        const domain = data.goalType ?? data.tags?.[0] ?? "Personal";
        const goal: AcceptanceGoal = {
          id: goalId,
          title: data.title,
          domain,
          goalType: domain,
          type: domain,
          status: "active",
          priority: "medium",
          tasks: (data.tasks ?? []).map((task, index) => ({
            id: `task_${slug(task.title)}_${index + 1}`,
            title: task.title,
            status: "todo",
            parentGoalId: goalId,
          })),
        };
        state.goalsByVault.set(vaultId, [
          ...(state.goalsByVault.get(vaultId) ?? []),
          goal,
        ]);
        return { id: goal.id, title: goal.title };
      }
      case "list_goal_frontmatter_tasks": {
        const goals = state.goalsByVault.get(input.vaultId as string) ?? [];
        const goal = goals.find((candidate) => candidate.id === input.goalId);
        return (
          goal?.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            parentGoalId: task.parentGoalId,
          })) ?? []
        );
      }
      case "save_memory":
        state.memoryByVault.set(input.vaultId as string, input.input as AcceptanceMemory);
        return undefined;
      case "agenda_get_plan":
        return state.plansByKey.get(planKey(input.vaultId as string, input.date as string)) ?? null;
      case "agenda_get_agenda_warnings":
      case "agenda_get_outcomes":
      case "agenda_get_chat_history":
      case "agenda_get_chat_dates":
      case "agenda_get_recent_stats":
        return [];
      case "agenda_get_check_in":
        return null;
      case "agenda_get_task_metadata": {
        const goals = state.goalsByVault.get(input.vaultId as string) ?? [];
        return Object.fromEntries(
          goals.flatMap((goal) =>
            goal.tasks.map((task) => [
              task.id,
              {
                goalId: goal.id,
                goalTitle: goal.title,
                priority: goal.priority,
                eisenhowerQuadrant: "do",
                deadline: "",
              },
            ]),
          ),
        );
      }
      case "agenda_create_plan": {
        const vaultId = input.vaultId as string;
        const date = input.date as string;
        const plan = createPlanFromGoals(state, vaultId, date);
        state.plansByKey.set(planKey(vaultId, date), plan);
        return clonePlan(plan);
      }
      case "agenda_update_plan": {
        const update = input.input as {
          vaultId: string;
          planId: string;
          scheduledTasks?: ScheduledTask[];
          taskOrder?: string[];
        };
        const key = [...state.plansByKey.entries()].find(
          ([, plan]) => plan.id === update.planId,
        )?.[0];
        if (!key) {
          throw new Error(`Unknown plan: ${update.planId}`);
        }
        const plan = state.plansByKey.get(key)!;
        const scheduledTasks = update.scheduledTasks ?? plan.scheduledTasks ?? [];
        const taskOrder = update.taskOrder ?? scheduledTasks.map((task) => task.taskId);
        const updated: DailyPlan = {
          ...plan,
          taskOrder,
          scheduledTasks,
          taskTitles: {
            ...plan.taskTitles,
            ...Object.fromEntries(scheduledTasks.map((task) => [task.taskId, task.title])),
          },
          updatedAt: new Date(Date.UTC(2026, 3, 29, 17, state.nextTick)).toISOString(),
        };
        state.plansByKey.set(key, updated);
        return clonePlan(updated);
      }
      case "agenda_toggle_task_completion": {
        const key = [...state.plansByKey.entries()].find(
          ([, plan]) => plan.id === input.planId,
        )?.[0];
        if (!key) {
          throw new Error(`Unknown plan: ${input.planId}`);
        }
        const plan = state.plansByKey.get(key)!;
        const taskId = input.taskId as string;
        const completed = plan.completedTaskIds.includes(taskId)
          ? plan.completedTaskIds.filter((id) => id !== taskId)
          : [...plan.completedTaskIds, taskId];
        const updated = { ...plan, completedTaskIds: completed };
        state.plansByKey.set(key, updated);
        return clonePlan(updated);
      }
      case "agenda_defer_task": {
        const deferInput = input.input as { vaultId: string; taskId: string; date: string };
        const key = planKey(deferInput.vaultId, deferInput.date);
        const plan = state.plansByKey.get(key);
        if (plan) {
          const updated = {
            ...plan,
            taskOrder: plan.taskOrder.filter((id) => id !== deferInput.taskId),
            scheduledTasks: plan.scheduledTasks?.filter(
              (task) => task.taskId !== deferInput.taskId,
            ),
          };
          state.plansByKey.set(key, updated);
        }
        return {
          id: `deferral_${deferInput.taskId}`,
          taskId: deferInput.taskId,
          date: deferInput.date,
          reason: null,
          aiInterpretation: null,
          createdAt: new Date(Date.UTC(2026, 3, 29, 18)).toISOString(),
        };
      }
      default:
        return undefined;
    }
  });
}

async function completeOnboarding(input: {
  vaultName: string;
  domain: string;
  goal: string;
  task: string;
  userName: string;
}): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText("Vault name"), {
    target: { value: input.vaultName },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create Vault/i }));

  const domainInputs = await screen.findAllByPlaceholderText("e.g., Startup");
  fireEvent.change(domainInputs[0], {
    target: { value: input.domain },
  });
  fireEvent.click(screen.getByRole("button", { name: /Next: Set Goals/i }));

  fireEvent.change(await screen.findByPlaceholderText("e.g., Launch MVP by April 1"), {
    target: { value: input.goal },
  });
  fireEvent.click(screen.getByRole("button", { name: /Next: Add Tasks/i }));

  fireEvent.change(await screen.findByPlaceholderText("e.g., Write API endpoint"), {
    target: { value: input.task },
  });
  fireEvent.click(screen.getByRole("button", { name: /Next: Add Memory/i }));

  fireEvent.change(await screen.findByPlaceholderText("Name"), {
    target: { value: input.userName },
  });
  fireEvent.change(screen.getByPlaceholderText("Task hrs/day"), {
    target: { value: "4" },
  });
  fireEvent.change(screen.getByPlaceholderText("Sleep hrs"), {
    target: { value: "7.5" },
  });
  fireEvent.click(screen.getByLabelText("Allow Memory context in remote AI requests"));
  fireEvent.click(screen.getByRole("button", { name: /Start Planning/i }));

  expect(await screen.findByRole("heading", { name: "Agenda" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Assistant" })).toBeInTheDocument();
}

describe("first-run acceptance path", () => {
  let state: AcceptanceState;
  let eventMock: TauriEventMock;

  beforeEach(() => {
    vi.clearAllMocks();
    installTauriRuntime();
    Element.prototype.scrollIntoView = vi.fn();
    state = createAcceptanceState();
    eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    installAcceptanceInvokeMock(state);
  });

  afterEach(() => {
    uninstallTauriRuntime();
  });

  it("creates, plans, edits, completes, defers, switches, and reloads a vault", async () => {
    const { unmount } = render(<App />);

    await completeOnboarding({
      vaultName: "Acceptance Alpha",
      domain: "Startup",
      goal: "Launch acceptance QA",
      task: "Ship launch QA",
      userName: "Avery",
    });
    expect(state.memoryByVault.get("vault_acceptance_1")).toMatchObject({
      userName: "Avery",
      taskCapacityHoursPerDay: 4,
      sleepHoursNeeded: 7.5,
      consent: {
        useForPlanning: true,
        allowRemoteAiContext: true,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Create Agenda/i }));
    const agenda = screen.getByRole("main");
    expect(await within(agenda).findByText("Ship launch QA")).toBeInTheDocument();

    fireEvent.click(within(agenda).getByRole("button", { name: 'Edit "Ship launch QA"' }));
    fireEvent.change(within(agenda).getByLabelText("Agenda item title"), {
      target: { value: "Ship launch QA edited" },
    });
    fireEvent.change(within(agenda).getByLabelText("Agenda item start time"), {
      target: { value: "10:00" },
    });
    fireEvent.change(within(agenda).getByLabelText("Agenda item duration minutes"), {
      target: { value: "50" },
    });
    fireEvent.click(within(agenda).getByRole("button", { name: "Save Agenda item" }));
    expect(await within(agenda).findByText("Ship launch QA edited")).toBeInTheDocument();

    fireEvent.click(
      within(agenda).getByRole("checkbox", {
        name: 'Mark "Ship launch QA edited" complete',
      }),
    );
    await waitFor(() => {
      expect(within(agenda).getByText(/1 of 1 done/)).toBeInTheDocument();
    });

    fireEvent.click(within(agenda).getByRole("button", { name: "Add Agenda item" }));
    fireEvent.change(within(agenda).getByLabelText("New Agenda item title"), {
      target: { value: "Manual agenda buffer" },
    });
    fireEvent.click(within(agenda).getByRole("button", { name: "Save new Agenda item" }));
    expect(await within(agenda).findByText("Manual agenda buffer")).toBeInTheDocument();

    const deferButtons = within(agenda).getAllByTitle("Defer to tomorrow");
    fireEvent.click(deferButtons[deferButtons.length - 1]);
    await waitFor(() => {
      expect(within(agenda).queryByText("Manual agenda buffer")).not.toBeInTheDocument();
    });

    await act(async () => {
      eventMock.simulateEvent("menu-action", "file:close-vault");
    });
    expect(await screen.findByText("Welcome to GoalRate")).toBeInTheDocument();

    await completeOnboarding({
      vaultName: "Acceptance Beta",
      domain: "Health",
      goal: "Build recovery habit",
      task: "Plan recovery walk",
      userName: "Avery",
    });

    fireEvent.click(screen.getByRole("button", { name: /Acceptance Beta/i }));
    fireEvent.click(screen.getByRole("button", { name: "Acceptance Alpha" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Acceptance Alpha/i })).toBeInTheDocument();
    });
    expect(await within(await screen.findByRole("main")).findByText("Ship launch QA edited")).toBeInTheDocument();

    unmount();
    render(<App />);

    expect(await screen.findByRole("button", { name: /Acceptance Alpha/i })).toBeInTheDocument();
    const reloadedAgenda = await screen.findByRole("main");
    expect(await within(reloadedAgenda).findByText("Ship launch QA edited")).toBeInTheDocument();
    expect(within(reloadedAgenda).queryByText("Manual agenda buffer")).not.toBeInTheDocument();
  });
});
