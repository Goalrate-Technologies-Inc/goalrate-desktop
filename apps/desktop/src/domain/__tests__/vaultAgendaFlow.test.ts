import { describe, expect, it } from "vitest";
import { generateDailyAgenda } from "../agendaEngine";
import {
  loadVaultFiles,
  updateTaskInGoalMarkdown,
} from "../vaultMarkdown";

const goalPath = "goals/launch.md";
const initialGoal = `---
id: goal_launch
type: goal
title: Launch MVP
status: active
created: "2026-04-25T12:00:00Z"
eisenhower_quadrant: do
tasks:
  - id: task_finish_shell
    title: Finish desktop shell
    status: pending
    parent_goal_id: goal_launch
    due_date: "2026-04-26"
    eisenhower_quadrant: do
  - id: task_write_notes
    title: Write onboarding notes
    status: pending
    parent_goal_id: goal_launch
    due_date: "2026-04-27"
    eisenhower_quadrant: schedule
---

## Objective
Launch a local-first MVP.
`;

describe("task update to vault write to agenda refresh", () => {
  it("excludes a completed task after the goal markdown is rewritten and reloaded", () => {
    const before = loadVaultFiles([{ path: goalPath, raw: initialGoal }]);
    const beforeAgenda = generateDailyAgenda(before.goals, {
      date: "2026-04-26",
    });

    expect(beforeAgenda.scheduledTasks.map((task) => task.taskId)).toEqual([
      "task_finish_shell",
      "task_write_notes",
    ]);

    const rewrittenGoal = updateTaskInGoalMarkdown(
      initialGoal,
      goalPath,
      "task_finish_shell",
      { status: "completed", completedAt: "2026-04-26" },
    );
    const after = loadVaultFiles([{ path: goalPath, raw: rewrittenGoal }]);
    const refreshedAgenda = generateDailyAgenda(after.goals, {
      date: "2026-04-26",
    });

    expect(after.errors).toEqual([]);
    expect(refreshedAgenda.scheduledTasks.map((task) => task.taskId)).toEqual([
      "task_write_notes",
    ]);
  });
});
