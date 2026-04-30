import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DailyPlan, ScheduledTask } from "@goalrate-app/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDailyLoopReturn } from "../../../hooks/useDailyLoop";
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

function dailyLoopWithSchedule(
  scheduledTasks: ScheduledTask[],
  updateScheduledTasks = vi.fn().mockResolvedValue(undefined),
): UseDailyLoopReturn {
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

describe("TodaysPlan drag reorder interaction", () => {
  const originalGetBoundingClientRect =
    HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = function () {
      const text = this.textContent ?? "";
      let top = 0;
      if (text.includes("Beta task") && !text.includes("Alpha task")) {
        top = 44;
      }
      if (text.includes("Gamma task") && !text.includes("Alpha task")) {
        top = 88;
      }
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        bottom: top + 40,
        right: 400,
        width: 400,
        height: 40,
        toJSON: () => ({}),
      };
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("persists a keyboard drag reorder using the existing time slots", async () => {
    const updateScheduledTasks = vi.fn().mockResolvedValue(undefined);
    const dailyLoop = dailyLoopWithSchedule(
      [
        scheduledTask("task_alpha", "Alpha task", "9:00 AM", 30),
        scheduledTask("task_beta", "Beta task", "9:30 AM", 45),
        scheduledTask("task_gamma", "Gamma task", "10:15 AM", 15),
      ],
      updateScheduledTasks,
    );

    render(<TodaysPlan dailyLoop={dailyLoop} />);

    const betaHandle = screen.getByRole("button", {
      name: 'Drag "Beta task" to reorder',
    });
    betaHandle.focus();

    fireEvent.keyDown(betaHandle, { key: "Space", code: "Space" });
    fireEvent.keyDown(betaHandle, { key: "ArrowUp", code: "ArrowUp" });
    fireEvent.keyDown(betaHandle, { key: "Space", code: "Space" });

    await waitFor(() => {
      expect(updateScheduledTasks).toHaveBeenCalledTimes(1);
    });
    expect(updateScheduledTasks).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task_beta",
        title: "Beta task",
        startTime: "9:00 AM",
      }),
      expect.objectContaining({
        taskId: "task_alpha",
        title: "Alpha task",
        startTime: "9:30 AM",
      }),
      expect.objectContaining({
        taskId: "task_gamma",
        title: "Gamma task",
        startTime: "10:15 AM",
      }),
    ]);
  });
});
