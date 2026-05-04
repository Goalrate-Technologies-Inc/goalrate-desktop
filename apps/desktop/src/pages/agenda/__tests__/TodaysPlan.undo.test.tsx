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
    agendaWarnings: [],
    isLoading: false,
    error: null,
    date: "2026-04-26",
    taskTitles: plan.taskTitles,
    taskMetadata: {},
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
    openAgendaErrorLog: vi.fn().mockResolvedValue(undefined),
    setDate: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    dataVersion: 0,
  };
}

describe("TodaysPlan Agenda undo", () => {
  it("undoes the latest manual Agenda edit by persisting the previous schedule", async () => {
    const originalSchedule = [
      scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30),
      scheduledTask("task_beta", "Beta task", "9:30 AM", 45),
      scheduledTask("task_gamma", "Gamma task", "10:15 AM", 15),
    ];
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const agenda = agendaWithSchedule(
      originalSchedule,
      updateScheduledTasks,
    );

    render(<TodaysPlan agenda={agenda} />);

    fireEvent.click(
      screen.getByRole("button", { name: 'Remove "Beta task" from Agenda' }),
    );

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenNthCalledWith(1, [
      expect.objectContaining({ taskId: "task_alpha", startTime: "9:00 AM" }),
      expect.objectContaining({ taskId: "task_gamma", startTime: "10:15 AM" }),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Undo last Agenda edit" }),
    );

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(2);
    });
    expect(updateScheduledTasks).toHaveBeenNthCalledWith(2, originalSchedule);
  });
});
