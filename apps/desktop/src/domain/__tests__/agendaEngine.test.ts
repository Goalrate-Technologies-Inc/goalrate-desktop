import { describe, expect, it } from "vitest";
import type { Goal } from "../models";
import {
  generateDailyAgenda,
  loadPendingTasks,
  scoreTaskForAgenda,
} from "../agendaEngine";

const goals: Goal[] = [
  {
    id: "goal_launch",
    title: "Launch MVP",
    status: "active",
    createdAt: "2026-04-25T12:00:00Z",
    priority: "high",
    eisenhowerQuadrant: "do",
    tasks: [
      {
        id: "task_due_today",
        goalId: "goal_launch",
        title: "Fix release blocker",
        status: "pending",
        dueDate: "2026-04-26",
        eisenhowerQuadrant: "do",
      },
      {
        id: "task_completed",
        goalId: "goal_launch",
        title: "Already done",
        status: "completed",
      },
    ],
  },
  {
    id: "goal_archive",
    title: "Archived goal",
    status: "archived",
    createdAt: "2026-04-25T12:00:00Z",
    tasks: [
      {
        id: "task_archived_goal",
        goalId: "goal_archive",
        title: "Should not appear",
        status: "pending",
      },
    ],
  },
  {
    id: "goal_research",
    title: "Research",
    status: "active",
    createdAt: "2026-04-25T12:00:00Z",
    priority: "medium",
    eisenhowerQuadrant: "schedule",
    tasks: [
      {
        id: "task_future",
        goalId: "goal_research",
        title: "Future scheduled task",
        status: "pending",
        scheduledFor: "2026-04-27",
      },
      {
        id: "task_research",
        goalId: "goal_research",
        title: "Read user notes",
        status: "todo",
        dueDate: "2026-05-01",
      },
    ],
  },
];

describe("agenda engine", () => {
  it("loads only active-goal pending tasks due for today or earlier", () => {
    const tasks = loadPendingTasks(goals, "2026-04-26").map(
      ({ task }) => task.id,
    );

    expect(tasks).toEqual(["task_due_today", "task_research"]);
  });

  it("loads specific-day tasks only on their scheduled day", () => {
    expect(
      loadPendingTasks(goals, "2026-04-27").map(({ task }) => task.id),
    ).toContain("task_future");
    expect(
      loadPendingTasks(goals, "2026-04-28").map(({ task }) => task.id),
    ).not.toContain("task_future");
  });

  it("scores urgent and important tasks higher", () => {
    const urgent = scoreTaskForAgenda(
      goals[0].tasks[0],
      goals[0],
      "2026-04-26",
    );
    const later = scoreTaskForAgenda(goals[2].tasks[1], goals[2], "2026-04-26");

    expect(urgent.score).toBeGreaterThan(later.score);
    expect(urgent.urgency).toBe(1);
    expect(urgent.importance).toBe(0.9);
  });

  it("derives delegate from an urgent task under a low-priority goal", () => {
    const agenda = generateDailyAgenda(
      [
        {
          id: "goal_low",
          title: "Low-priority admin",
          status: "active",
          createdAt: "2026-04-25T12:00:00Z",
          priority: "low",
          tasks: [
            {
              id: "task_delegate",
              goalId: "goal_low",
              title: "Send vendor reminder",
              status: "todo",
              dueDate: "2026-04-26",
            },
          ],
        },
      ],
      { date: "2026-04-26" },
    );

    expect(agenda.scheduledTasks[0]).toMatchObject({
      taskId: "task_delegate",
      eisenhowerQuadrant: "delegate",
    });
  });

  it("generates a deterministic daily plan with concrete start times", () => {
    const agenda = generateDailyAgenda(goals, {
      date: "2026-04-26",
      startMinutes: 9 * 60,
    });

    expect(agenda.scheduledTasks.map((task) => task.taskId)).toEqual([
      "task_due_today",
      "task_research",
    ]);
    expect(agenda.id).toBe("agenda_2026_04_26");
    expect(agenda.scheduledTasks[0]).toMatchObject({
      startTime: "9:00 AM",
      durationMinutes: 45,
      estimateSource: "inferred",
    });
    expect(agenda.scheduledTasks[1].startTime).toBe("9:45 AM");
  });

  it("keeps exact-day tasks on the Agenda even when flexible tasks hit the cap", () => {
    const agenda = generateDailyAgenda(goals, {
      date: "2026-04-27",
      startMinutes: 9 * 60,
      maxTasks: 1,
    });

    expect(agenda.scheduledTasks.map((task) => task.taskId)).toEqual([
      "task_future",
    ]);
  });

  it("schedules active subtasks instead of duplicating their parent task", () => {
    const agenda = generateDailyAgenda(
      [
        {
          id: "goal_subtasks",
          title: "Ship onboarding",
          status: "active",
          createdAt: "2026-04-25T12:00:00Z",
          eisenhowerQuadrant: "do",
          tasks: [
            {
              id: "task_parent",
              goalId: "goal_subtasks",
              title: "Build onboarding flow",
              status: "pending",
              dueDate: "2026-04-26",
              eisenhowerQuadrant: "do",
              subtasks: [
                {
                  id: "subtask_wire_copy",
                  goalId: "goal_subtasks",
                  parentTaskId: "task_parent",
                  title: "Write the first welcome screen copy",
                  status: "todo",
                  dueDate: "2026-04-26",
                  eisenhowerQuadrant: "do",
                },
                {
                  id: "subtask_done",
                  goalId: "goal_subtasks",
                  parentTaskId: "task_parent",
                  title: "Already handled",
                  status: "completed",
                  dueDate: "2026-04-26",
                  eisenhowerQuadrant: "do",
                },
              ],
            },
          ],
        },
      ],
      {
        date: "2026-04-26",
        startMinutes: 10 * 60,
      },
    );

    expect(agenda.scheduledTasks.map((task) => task.taskId)).toEqual([
      "subtask_wire_copy",
    ]);
    expect(agenda.scheduledTasks[0]).toMatchObject({
      id: "scheduled_subtask_wire_copy",
      title: "Write the first welcome screen copy",
      startTime: "10:00 AM",
    });
  });
});
