import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { DailyPlan } from "@goalrate-app/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDailyLoopReturn } from "../../../hooks/useDailyLoop";
import { AssistantMissedWork } from "../AssistantMissedWork";

vi.mock("../../../context/VaultContext", () => ({
  useVault: () => ({
    currentVault: {
      id: "vault_test",
      name: "Test Vault",
      path: "/tmp/test-vault",
      vaultType: "private",
      created: "2026-04-26T00:00:00Z",
    },
  }),
}));

function dailyLoopForAssistant(
  sendChat = vi.fn().mockResolvedValue({
    id: "message_1",
    dailyPlanId: "plan_2026_04_26",
    role: "user",
    content: "Done.",
    timestamp: "2026-04-26T09:00:00Z",
  }),
): UseDailyLoopReturn {
  const plan: DailyPlan = {
    id: "plan_2026_04_26",
    date: "2026-04-26",
    top3OutcomeIds: [],
    taskOrder: [],
    taskTitles: {},
    completedTaskIds: [],
    generatedAt: "2026-04-26T09:00:00Z",
    scheduledTasks: [],
    lockedAt: null,
    createdAt: "2026-04-26T09:00:00Z",
    updatedAt: "2026-04-26T09:00:00Z",
  };

  return {
    plan,
    outcomes: [],
    chatHistory: [],
    checkIn: null,
    agendaWarnings: [],
    isLoading: false,
    error: null,
    date: "2026-04-26",
    taskTitles: {},
    taskMetadata: {},
    mergeTaskTitles: vi.fn(),
    recentStats: [],
    createPlan: vi.fn().mockResolvedValue(undefined),
    updatePlan: vi.fn().mockResolvedValue(undefined),
    updateScheduledTasks: vi.fn().mockResolvedValue(undefined),
    addOutcome: vi.fn().mockResolvedValue(undefined),
    updateOutcome: vi.fn().mockResolvedValue(undefined),
    deleteOutcome: vi.fn().mockResolvedValue(undefined),
    deferTask: vi.fn().mockResolvedValue(undefined),
    toggleTaskCompletion: vi.fn().mockResolvedValue(undefined),
    sendChat,
    createCheckIn: vi.fn().mockResolvedValue(undefined),
    openAgendaErrorLog: vi.fn().mockResolvedValue(undefined),
    setDate: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    dataVersion: 0,
  };
}

describe("AssistantMissedWork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays hidden during empty background checks", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
    const dailyLoop = dailyLoopForAssistant();

    const { rerender } = render(<AssistantMissedWork dailyLoop={dailyLoop} />);

    expect(
      screen.queryByText("Checking missed work..."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_goals", {
        vaultId: "vault_test",
      });
    });
    expect(
      screen.queryByText("Checking missed work..."),
    ).not.toBeInTheDocument();

    rerender(
      <AssistantMissedWork
        dailyLoop={{ ...dailyLoop, dataVersion: dailyLoop.dataVersion + 1 }}
      />,
    );

    expect(
      screen.queryByText("Checking missed work..."),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("surfaces missed Tasks and asks the Assistant to break them down", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(
      screen.getByText('Break "Draft proposal" into smaller steps.'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Ask Assistant to break down "Draft proposal"',
      }),
    );

    await waitFor(() => {
      expect(sendChat).toHaveBeenCalledWith(
        expect.stringContaining('Break down "Draft proposal" into subtasks'),
      );
    });
  });

  it("surfaces missed Subtasks with continuation choices", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_schedule_task_for_date") {
        return Promise.resolve({
          id: "plan_2026_04_27",
          date: "2026-04-27",
          top3OutcomeIds: [],
          taskOrder: ["subtask_outline"],
          taskTitles: { subtask_outline: "Outline the ask" },
          completedTaskIds: [],
          scheduledTasks: [
            {
              id: "scheduled_subtask_outline",
              taskId: "subtask_outline",
              title: "Outline the ask",
              startTime: "9:00 AM",
              durationMinutes: 30,
              estimateSource: "manual",
            },
          ],
          lockedAt: null,
          createdAt: "2026-04-26T09:00:00Z",
          updatedAt: "2026-04-26T09:00:00Z",
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();
    expect(
      screen.getByText('Decide whether to continue "Outline the ask".'),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Continue Subtask "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("daily_loop_schedule_task_for_date", {
        input: {
          vaultId: "vault_test",
          taskId: "subtask_outline",
          title: "Outline the ask",
          date: "2026-04-27",
          estimateSource: "manual",
        },
      });
    });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("persists a different missed Subtask choice without falling back to chat", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    const dailyLoop = dailyLoopForAssistant(sendChat);
    const refresh = vi.fn().mockResolvedValue(undefined);
    dailyLoop.refresh = refresh;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_generate_alternative_subtask") {
        return Promise.resolve({
          taskId: "subtask_task_proposal_alternative",
          title: "Write one rough sentence for Draft proposal",
          plan: {
            id: "plan_2026_04_27",
            date: "2026-04-27",
            top3OutcomeIds: [],
            taskOrder: ["subtask_task_proposal_alternative"],
            taskTitles: {
              subtask_task_proposal_alternative:
                "Write one rough sentence for Draft proposal",
            },
            completedTaskIds: [],
            scheduledTasks: [
              {
                id: "scheduled_subtask_task_proposal_alternative",
                taskId: "subtask_task_proposal_alternative",
                title: "Write one rough sentence for Draft proposal",
                startTime: "9:00 AM",
                durationMinutes: 45,
                estimateSource: "assistant",
              },
            ],
            lockedAt: null,
            createdAt: "2026-04-26T09:00:00Z",
            updatedAt: "2026-04-26T09:00:00Z",
          },
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoop} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Try a different Subtask for "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "daily_loop_generate_alternative_subtask",
        {
          input: {
            vaultId: "vault_test",
            missedTaskId: "subtask_outline",
            parentTaskId: "task_proposal",
            missedTitle: "Outline the ask",
            date: "2026-04-27",
          },
        },
      );
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("persists a parent Task continuation choice without falling back to chat", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_schedule_parent_task_for_missed_subtask") {
        return Promise.resolve({
          id: "plan_2026_04_27",
          date: "2026-04-27",
          top3OutcomeIds: [],
          taskOrder: ["task_proposal"],
          taskTitles: { task_proposal: "Draft proposal" },
          completedTaskIds: [],
          scheduledTasks: [
            {
              id: "scheduled_task_proposal",
              taskId: "task_proposal",
              title: "Draft proposal",
              startTime: "9:00 AM",
              durationMinutes: 45,
              estimateSource: "manual",
            },
          ],
          lockedAt: null,
          createdAt: "2026-04-26T09:00:00Z",
          updatedAt: "2026-04-26T09:00:00Z",
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Reconsider parent Task for "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "daily_loop_schedule_parent_task_for_missed_subtask",
        {
          input: {
            vaultId: "vault_test",
            missedTaskId: "subtask_outline",
            parentTaskId: "task_proposal",
            date: "2026-04-27",
          },
        },
      );
    });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("persists a different Task choice without falling back to chat", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_generate_alternative_task") {
        return Promise.resolve({
          taskId: "task_goal_launch_alternative",
          title: "Write a simpler next step for Launch",
          plan: {
            id: "plan_2026_04_27",
            date: "2026-04-27",
            top3OutcomeIds: [],
            taskOrder: ["task_goal_launch_alternative"],
            taskTitles: {
              task_goal_launch_alternative:
                "Write a simpler next step for Launch",
            },
            completedTaskIds: [],
            scheduledTasks: [
              {
                id: "scheduled_task_goal_launch_alternative",
                taskId: "task_goal_launch_alternative",
                title: "Write a simpler next step for Launch",
                startTime: "9:00 AM",
                durationMinutes: 45,
                estimateSource: "assistant",
              },
            ],
            lockedAt: null,
            createdAt: "2026-04-26T09:00:00Z",
            updatedAt: "2026-04-26T09:00:00Z",
          },
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Try a different Task for "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "daily_loop_generate_alternative_task",
        {
          input: {
            vaultId: "vault_test",
            missedTaskId: "subtask_outline",
            parentTaskId: "task_proposal",
            date: "2026-04-27",
          },
        },
      );
    });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("requires confirmation before continuing the Goal by archiving the parent Task", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_archive_parent_task_for_missed_subtask") {
        return Promise.resolve({
          goalId: "goal_launch",
          archivedTaskId: "task_proposal",
          archivedTaskIds: ["task_proposal", "subtask_outline"],
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Continue Goal for "Outline the ask"',
      }),
    );

    expect(
      screen.getByText("Archive this Task branch and keep the Goal active?"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Confirm archiving parent Task for "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "daily_loop_archive_parent_task_for_missed_subtask",
        {
          input: {
            vaultId: "vault_test",
            missedTaskId: "subtask_outline",
            parentTaskId: "task_proposal",
            date: "2026-04-27",
          },
        },
      );
    });
    expect(sendChat).not.toHaveBeenCalled();
  });

  it("requires confirmation before archiving the Goal from a missed Subtask", async () => {
    const sendChat = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch",
            status: "active",
            created: "2026-04-01",
            priority: "high",
          },
        ]);
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([
          {
            id: "task_proposal",
            title: "Draft proposal",
            status: "todo",
          },
          {
            id: "subtask_outline",
            title: "Outline the ask",
            status: "todo",
            parentId: "task_proposal",
            firstSeenOnAgenda: "2026-04-24",
          },
        ]);
      }
      if (command === "daily_loop_archive_goal_for_missed_subtask") {
        return Promise.resolve({
          goalId: "goal_launch",
          status: "archived",
        });
      }
      return Promise.resolve(undefined);
    });

    render(<AssistantMissedWork dailyLoop={dailyLoopForAssistant(sendChat)} />);

    expect(await screen.findByText("Needs attention")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Archive Goal for "Outline the ask"',
      }),
    );

    expect(
      screen.getByText("Archive this Goal and stop planning it?"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Confirm archiving Goal for "Outline the ask"',
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "daily_loop_archive_goal_for_missed_subtask",
        {
          input: {
            vaultId: "vault_test",
            missedTaskId: "subtask_outline",
            parentTaskId: "task_proposal",
            date: "2026-04-27",
          },
        },
      );
    });
    expect(sendChat).not.toHaveBeenCalled();
  });
});
