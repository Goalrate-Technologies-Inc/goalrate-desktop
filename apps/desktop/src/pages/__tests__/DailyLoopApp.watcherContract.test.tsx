import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { DailyPlan } from "@goalrate-app/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../../test/utils/mockTauri";
import { DailyLoopApp } from "../DailyLoopApp";

vi.mock("../../context/VaultContext", () => ({
  useVault: () => ({
    currentVault: {
      id: "vault_test",
      name: "Test Vault",
      path: "/tmp/test-vault",
      vaultType: "private",
      created: "2026-04-26T00:00:00Z",
    },
    vaults: [],
    openVault: vi.fn().mockResolvedValue(undefined),
    closeVault: vi.fn().mockResolvedValue(undefined),
    refreshVaults: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../daily-loop/TodaysPlan", () => ({
  TodaysPlan: () => <div>Agenda panel</div>,
}));

vi.mock("../daily-loop/AiChatPanel", () => ({
  AiChatPanel: () => <div>Assistant panel</div>,
}));

vi.mock("../daily-loop/IntakeFlow", () => ({
  IntakeFlow: () => <div>Intake flow</div>,
}));

function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function planFor(date: string, taskId: string): DailyPlan {
  return {
    id: `plan_${date}`,
    date,
    top3OutcomeIds: [],
    taskOrder: [taskId],
    taskTitles: { [taskId]: taskId },
    completedTaskIds: [],
    scheduledTasks: [
      {
        id: `scheduled_${taskId}`,
        taskId,
        title: taskId,
        startTime: "9:00 AM",
        durationMinutes: 30,
      },
    ],
    lockedAt: null,
    createdAt: "2026-04-26T08:00:00Z",
    updatedAt: "2026-04-26T08:00:00Z",
  };
}

describe("DailyLoopApp vault watcher contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
  });

  it("lets one active-vault event refresh shell, agenda, roadmap, and recovery surfaces independently", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    const today = toLocalDateString();
    let listGoalsCalls = 0;
    let getPlanCalls = 0;
    let snapshotCalls = 0;
    let issueCalls = 0;

    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "list_goals") {
        listGoalsCalls += 1;
        return Promise.resolve(
          listGoalsCalls <= 2
            ? [
                {
                  id: "goal_before",
                  title: "Launch before",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ]
            : [
                {
                  id: "goal_after",
                  title: "Launch after",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ],
        );
      }
      if (command === "daily_loop_get_plan") {
        getPlanCalls += 1;
        const inputDate =
          typeof args === "object" &&
          args !== null &&
          "date" in args &&
          typeof args.date === "string"
            ? args.date
            : today;
        return Promise.resolve(planFor(inputDate, `task_${getPlanCalls}`));
      }
      if (command === "daily_loop_get_agenda_warnings") {
        return Promise.resolve([]);
      }
      if (command === "daily_loop_get_task_metadata") {
        return Promise.resolve({});
      }
      if (command === "daily_loop_get_outcomes") {
        return Promise.resolve([]);
      }
      if (command === "daily_loop_get_chat_history") {
        return Promise.resolve([]);
      }
      if (command === "daily_loop_get_check_in") {
        return Promise.resolve(null);
      }
      if (command === "daily_loop_get_recent_stats") {
        return Promise.resolve([]);
      }
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        snapshotCalls += 1;
        return Promise.resolve([]);
      }
      if (command === "list_vault_error_log_entries") {
        issueCalls += 1;
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    render(<DailyLoopApp />);

    expect(await screen.findByText("Launch before")).toBeInTheDocument();
    expect(await screen.findByText("Agenda panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Settings"));

    expect(await screen.findByText("Vault Recovery")).toBeInTheDocument();
    await waitFor(() => {
      expect(snapshotCalls).toBe(1);
      expect(issueCalls).toBe(1);
    });
    expect(getPlanCalls).toBe(1);
    expect(listGoalsCalls).toBe(2);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: [
          "goals/goal_after.md",
          `agenda/${today}.md`,
          "logs/errors.md",
          "system/mutations.md",
        ],
      });
    });

    expect(await screen.findByText("Launch after")).toBeInTheDocument();
    expect(screen.getByText("Vault refreshed")).toBeInTheDocument();
    await waitFor(() => {
      expect(getPlanCalls).toBe(2);
      expect(snapshotCalls).toBe(2);
      expect(issueCalls).toBe(2);
    });
    expect(listGoalsCalls).toBeGreaterThanOrEqual(3);
  });
});
