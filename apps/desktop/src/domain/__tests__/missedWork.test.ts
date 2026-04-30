import { describe, expect, it } from "vitest";
import type { Goal } from "../models";
import { evaluateMissedWork } from "../missedWork";

const goals: Goal[] = [
  {
    id: "goal_launch",
    title: "Launch MVP",
    status: "active",
    createdAt: "2026-04-24T09:00:00Z",
    tasks: [
      {
        id: "task_missed_parent",
        goalId: "goal_launch",
        title: "Write launch notes",
        status: "pending",
        firstSeenOnAgenda: "2026-04-24",
      },
      {
        id: "task_with_subtasks",
        goalId: "goal_launch",
        title: "Prepare demo",
        status: "pending",
        firstSeenOnAgenda: "2026-04-24",
        subtasks: [
          {
            id: "subtask_missed",
            goalId: "goal_launch",
            parentTaskId: "task_with_subtasks",
            title: "Open the demo branch",
            status: "pending",
            firstSeenOnAgenda: "2026-04-24",
          },
          {
            id: "subtask_recent",
            goalId: "goal_launch",
            parentTaskId: "task_with_subtasks",
            title: "Record walkthrough",
            status: "pending",
            firstSeenOnAgenda: "2026-04-25",
          },
        ],
      },
      {
        id: "task_completed",
        goalId: "goal_launch",
        title: "Already done",
        status: "completed",
        firstSeenOnAgenda: "2026-04-24",
      },
    ],
  },
  {
    id: "goal_archived",
    title: "Archived",
    status: "archived",
    createdAt: "2026-04-24T09:00:00Z",
    tasks: [
      {
        id: "task_archived_goal",
        goalId: "goal_archived",
        title: "Ignore me",
        status: "pending",
        firstSeenOnAgenda: "2026-04-24",
      },
    ],
  },
];

describe("missed work decisions", () => {
  it("flags missed parent tasks without subtasks for breakdown", () => {
    const decisions = evaluateMissedWork(goals, { today: "2026-04-26" });

    expect(decisions).toContainEqual({
      type: "break_down_task",
      goalId: "goal_launch",
      taskId: "task_missed_parent",
      title: "Write launch notes",
      firstSeenOnAgenda: "2026-04-24",
      daysOnAgenda: 2,
    });
  });

  it("flags missed subtasks for continuation decisions", () => {
    const decisions = evaluateMissedWork(goals, { today: "2026-04-26" });

    expect(decisions).toContainEqual({
      type: "continue_subtask_decision",
      goalId: "goal_launch",
      taskId: "subtask_missed",
      parentTaskId: "task_with_subtasks",
      title: "Open the demo branch",
      firstSeenOnAgenda: "2026-04-24",
      daysOnAgenda: 2,
    });
  });

  it("does not flag completed, archived-goal, recent, or already-broken-down parent work", () => {
    const decisionIds = evaluateMissedWork(goals, { today: "2026-04-26" }).map(
      (decision) => decision.taskId,
    );

    expect(decisionIds).not.toContain("task_completed");
    expect(decisionIds).not.toContain("task_archived_goal");
    expect(decisionIds).not.toContain("subtask_recent");
    expect(decisionIds).not.toContain("task_with_subtasks");
  });

  it("uses the latest Agenda seen date to avoid immediate continuation loops", () => {
    const decisions = evaluateMissedWork(
      [
        {
          id: "goal_active",
          title: "Active Goal",
          status: "active",
          createdAt: "2026-04-01",
          tasks: [
            {
              id: "task_parent",
              goalId: "goal_active",
              title: "Parent",
              status: "todo",
              subtasks: [
                {
                  id: "subtask_rescheduled",
                  goalId: "goal_active",
                  parentTaskId: "task_parent",
                  title: "Recently rescheduled",
                  status: "todo",
                  firstSeenOnAgenda: "2026-04-20",
                  lastSeenOnAgenda: "2026-04-26",
                },
              ],
            },
          ],
        },
      ],
      { today: "2026-04-26" },
    );

    expect(decisions).toEqual([]);
  });

  it("uses the latest missed-work decision date to avoid immediate choice loops", () => {
    const decisions = evaluateMissedWork(
      [
        {
          id: "goal_active",
          title: "Active Goal",
          status: "active",
          createdAt: "2026-04-01",
          tasks: [
            {
              id: "task_parent",
              goalId: "goal_active",
              title: "Parent",
              status: "todo",
              subtasks: [
                {
                  id: "subtask_reviewed",
                  goalId: "goal_active",
                  parentTaskId: "task_parent",
                  title: "Recently reviewed",
                  status: "todo",
                  firstSeenOnAgenda: "2026-04-20",
                  lastMissedDecisionOn: "2026-04-26",
                },
              ],
            },
          ],
        },
      ],
      { today: "2026-04-26" },
    );

    expect(decisions).toEqual([]);
  });
});
