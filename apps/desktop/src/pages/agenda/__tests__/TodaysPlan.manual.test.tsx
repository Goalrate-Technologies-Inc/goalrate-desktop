import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DailyPlan, ScheduledTask } from "@goalrate-app/shared";
import { describe, expect, it, vi } from "vitest";
import type { UseAgendaReturn } from "../../../hooks/useAgenda";
import { TodaysPlan } from "../TodaysPlan";

function scheduledTask(
  taskId: string,
  title: string,
  startTime: string,
  durationMinutes: number,
): ScheduledTask {
  return {
    id: `scheduled_${taskId}`,
    taskId,
    title,
    startTime,
    durationMinutes,
    estimateSource: "manual",
    eisenhowerQuadrant: null,
  };
}

function agendaWithSchedule(
  scheduledTasks: ScheduledTask[],
  updateScheduledTasks = vi.fn().mockResolvedValue(undefined),
  agendaWarnings: string[] = [],
  openAgendaErrorLog = vi.fn().mockResolvedValue(undefined),
  taskMetadata: UseAgendaReturn["taskMetadata"] = {},
): UseAgendaReturn {
  const plan: DailyPlan = {
    id: "plan_2026_04_26",
    date: "2026-04-26",
    top3OutcomeIds: [],
    taskOrder: scheduledTasks.map((task) => task.taskId),
    taskTitles: Object.fromEntries(
      scheduledTasks.map((task) => [task.taskId, task.title]),
    ),
    completedTaskIds: [],
    generatedAt: "2026-04-26T09:00:00Z",
    scheduledTasks,
    lockedAt: null,
    createdAt: "2026-04-26T09:00:00Z",
    updatedAt: "2026-04-26T09:00:00Z",
  };

  return {
    plan,
    outcomes: [],
    chatHistory: [],
    checkIn: null,
    agendaWarnings,
    isLoading: false,
    error: null,
    date: "2026-04-26",
    taskTitles: plan.taskTitles,
    taskMetadata,
    mergeTaskTitles: vi.fn(),
    recentStats: [],
    createPlan: vi.fn().mockResolvedValue(undefined),
    updatePlan: vi.fn().mockResolvedValue(undefined),
    updateScheduledTasks,
    addOutcome: vi.fn().mockResolvedValue(undefined),
    updateOutcome: vi.fn().mockResolvedValue(undefined),
    deleteOutcome: vi.fn().mockResolvedValue(undefined),
    deferTask: vi.fn().mockResolvedValue(undefined),
    toggleTaskCompletion: vi.fn().mockResolvedValue(undefined),
    sendChat: vi.fn().mockResolvedValue({
      id: "message_1",
      dailyPlanId: plan.id,
      role: "ai",
      content: "Done.",
      timestamp: "2026-04-26T09:00:00Z",
    }),
    createCheckIn: vi.fn().mockResolvedValue(undefined),
    openAgendaErrorLog,
    setDate: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    dataVersion: 0,
  } as UseAgendaReturn & {
    openAgendaErrorLog: () => Promise<void>;
  };
}

describe("TodaysPlan manual Agenda editing", () => {
  it("opens the parent goal notes when an Agenda task title is clicked", () => {
    const onOpenGoalNotes = vi.fn();
    const agenda = agendaWithSchedule(
      [scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30)],
      vi.fn().mockResolvedValue(undefined),
      [],
      vi.fn().mockResolvedValue(undefined),
      {
        task_alpha: {
          goalId: "goal_launch",
          goalTitle: "Launch Goal",
          priority: "medium",
          eisenhowerQuadrant: "do",
          deadline: "",
        },
      },
    );

    render(
      <TodaysPlan
        agenda={agenda}
        onOpenGoalNotes={onOpenGoalNotes}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Open goal notes for "Alpha task"',
      }),
    );

    expect(onOpenGoalNotes).toHaveBeenCalledWith(
      "goal_launch",
      "Launch Goal",
    );
  });

  it("removes a Goal-backed task from the Agenda without deleting it from the Roadmap", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = {
      ...agendaWithSchedule(
        [
          scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30),
          scheduledTask("subtask_alpha_child", "Alpha child", "9:30 AM", 15),
          scheduledTask("task_beta", "Beta task", "9:45 AM", 30),
        ],
        updateScheduledTasks,
        [],
        vi.fn().mockResolvedValue(undefined),
        {
          task_alpha: {
            goalId: "goal_launch",
            goalTitle: "Launch Goal",
            priority: "medium",
            eisenhowerQuadrant: "do",
            deadline: "",
          },
        },
      ),
    } satisfies UseAgendaReturn;

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: 'Remove "Alpha task" from Agenda',
      }),
    );

    expect(
      screen.queryByRole("heading", { name: "Delete Task" }),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({ taskId: "subtask_alpha_child" }),
      expect.objectContaining({ taskId: "task_beta" }),
    ]);
  });

  it("adds a manual Agenda item with a concrete scheduled task", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule(
      [scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30)],
      updateScheduledTasks,
    );

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Agenda item" }));
    expect(screen.getByLabelText("New Agenda item start time")).toHaveAttribute(
      "type",
      "time",
    );
    expect(screen.getByLabelText("New Agenda item start time")).toHaveValue(
      "09:30",
    );
    fireEvent.change(screen.getByLabelText("New Agenda item title"), {
      target: { value: "Review launch notes" },
    });
    fireEvent.change(screen.getByLabelText("New Agenda item duration minutes"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new Agenda item" }));

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task_alpha",
        title: "Alpha task",
        startTime: "9:00 AM",
      }),
      expect.objectContaining({
        taskId: "task_manual_review_launch_notes",
        title: "Review launch notes",
        startTime: "9:30 AM",
        durationMinutes: 20,
        estimateSource: "manual",
      }),
    ]);
  });

  it("adds the first manual Agenda item to an empty local Agenda", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule([], updateScheduledTasks);

    render(<TodaysPlan agenda={agenda} />);

    expect(
      screen.getByText(
        "No tasks in the Agenda yet. Use the add button to create your first item.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Agenda item" }));
    expect(screen.getByLabelText("New Agenda item start time")).toHaveValue(
      "09:00",
    );
    fireEvent.change(screen.getByLabelText("New Agenda item title"), {
      target: { value: "Plan the day" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save new Agenda item" }));

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task_manual_plan_the_day",
        title: "Plan the day",
        startTime: "9:00 AM",
        durationMinutes: 30,
        estimateSource: "manual",
      }),
    ]);
  });

  it("persists manual row edits through scheduled tasks", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule(
      [scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30)],
      updateScheduledTasks,
    );

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(screen.getByRole("button", { name: 'Edit "Alpha task"' }));
    fireEvent.change(screen.getByLabelText("Agenda item title"), {
      target: { value: "Updated alpha task" },
    });
    fireEvent.change(screen.getByLabelText("Agenda item start time"), {
      target: { value: "10:15" },
    });
    fireEvent.change(screen.getByLabelText("Agenda item duration minutes"), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Agenda item" }));

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task_alpha",
        title: "Updated alpha task",
        startTime: "10:15 AM",
        durationMinutes: 45,
        estimateSource: "manual",
      }),
    ]);
  });

  it("cascades later Agenda start times after a row time edit", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule(
      [
        scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30),
        scheduledTask("task_beta", "Beta task", "9:30 AM", 45),
        scheduledTask("task_gamma", "Gamma task", "10:15 AM", 15),
      ],
      updateScheduledTasks,
    );

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(screen.getByRole("button", { name: 'Edit "Beta task"' }));
    fireEvent.change(screen.getByLabelText("Agenda item start time"), {
      target: { value: "10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Agenda item" }));

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task_alpha",
        startTime: "9:00 AM",
      }),
      expect.objectContaining({
        taskId: "task_beta",
        startTime: "10:00 AM",
        durationMinutes: 45,
      }),
      expect.objectContaining({
        taskId: "task_gamma",
        startTime: "10:45 AM",
      }),
    ]);
  });

  it("shows Agenda reconciliation warnings without blocking the schedule", () => {
    const agenda = agendaWithSchedule(
      [scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30)],
      vi.fn().mockResolvedValue(undefined),
      [
        "Agenda marked 'task_alpha' complete, but GoalRate could not update Goal 'goal_launch'. Check logs/errors.md.",
      ],
    );

    render(<TodaysPlan agenda={agenda} />);

    expect(screen.getByText("Agenda needs a small vault repair")).toBeTruthy();
    expect(screen.getAllByText(/logs\/errors\.md/).length).toBeGreaterThan(0);
    expect(screen.getByText("Alpha task")).toBeTruthy();
  });

  it("opens the Agenda error log from reconciliation warnings", async () => {
    const openAgendaErrorLog = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule(
      [scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30)],
      vi.fn().mockResolvedValue(undefined),
      [
        "Agenda marked 'task_alpha' complete, but GoalRate could not update Goal 'goal_launch'. Check logs/errors.md.",
      ],
      openAgendaErrorLog,
    );

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open logs/errors.md" }),
    );

    await waitFor(() => {
      expect(openAgendaErrorLog).toHaveBeenCalledTimes(1);
    });
  });
});
