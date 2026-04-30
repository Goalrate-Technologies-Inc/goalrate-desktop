import { describe, expect, it } from "vitest";
import {
  FrontmatterParseError,
  buildVaultErrorLogEntry,
  goalFromVaultFile,
  loadVaultFiles,
  parseMarkdownFrontmatter,
  serializeVaultFile,
  updateTaskInGoalMarkdown,
  validateVaultFile,
} from "../vaultMarkdown";
import { evaluateMissedWork } from "../missedWork";

const goalMarkdown = `---
id: goal_launch
type: goal
title: Launch MVP
status: active
domain: Startup
created: "2026-04-25T12:00:00Z"
custom_rank: 7
tasks:
  - id: task_onboarding
    title: Implement onboarding
    status: pending
    parent_goal_id: goal_launch
    due_date: "2026-04-27"
    recurring: weekly
    eisenhower_quadrant: do
---

## Notes
Ship the smallest usable version.
`;

describe("vault markdown parsing", () => {
  it("parses goal frontmatter, embedded tasks, and body", () => {
    const file = parseMarkdownFrontmatter(goalMarkdown, "goals/launch.md");
    const goal = goalFromVaultFile(file);

    expect(goal.id).toBe("goal_launch");
    expect(goal.title).toBe("Launch MVP");
    expect(goal.tasks).toHaveLength(1);
    expect(goal.tasks[0]).toMatchObject({
      id: "task_onboarding",
      title: "Implement onboarding",
      status: "pending",
      goalId: "goal_launch",
      dueDate: "2026-04-27",
      recurring: "weekly",
      eisenhowerQuadrant: "do",
    });
    expect(file.body).toContain("Ship the smallest usable version.");
  });

  it("preserves unknown frontmatter fields when serializing", () => {
    const file = parseMarkdownFrontmatter(goalMarkdown, "goals/launch.md");
    const serialized = serializeVaultFile(file);

    expect(serialized).toContain("custom_rank: 7");
    expect(serialized).toContain("tasks:");
  });

  it("surfaces validation errors instead of silently accepting invalid files", () => {
    const invalid = parseMarkdownFrontmatter(
      `---
id: goal_invalid
type: goal
status: active
---
`,
      "goals/invalid.md",
    );

    const errors = validateVaultFile(invalid);
    expect(errors).toContainEqual({
      path: "goals/invalid.md",
      field: "title",
      message: "Missing title",
    });
    expect(buildVaultErrorLogEntry(errors[0])).toContain("goals/invalid.md");
  });

  it("keeps invalid files out of typed goal loading while reporting errors", () => {
    const result = loadVaultFiles([
      {
        path: "goals/missing-status.md",
        raw: `---
id: goal_missing_status
type: goal
title: Missing Status
created: "2026-04-25T12:00:00Z"
---
`,
      },
    ]);

    expect(result.files).toHaveLength(1);
    expect(result.goals).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
    expect(result.errors).toContainEqual({
      path: "goals/missing-status.md",
      field: "status",
      message: "Missing status",
    });
  });

  it("keeps goals with invalid embedded task rows out of typed loading", () => {
    const result = loadVaultFiles([
      {
        path: "goals/invalid-task.md",
        raw: `---
id: goal_invalid_task
type: goal
title: Invalid Task Goal
status: active
created: "2026-04-25T12:00:00Z"
tasks:
  - id: task_missing_title
    status: todo
    parent_goal_id: goal_invalid_task
---
`,
      },
    ]);

    expect(result.files).toHaveLength(1);
    expect(result.goals).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
    expect(result.errors).toContainEqual({
      path: "goals/invalid-task.md",
      field: "tasks[0].title",
      message: "Missing title",
    });
  });

  it("reports invalid nested subtask rows with field paths", () => {
    const result = loadVaultFiles([
      {
        path: "goals/invalid-subtask.md",
        raw: `---
id: goal_invalid_subtask
type: goal
title: Invalid Subtask Goal
status: active
created: "2026-04-25T12:00:00Z"
tasks:
  - id: task_parent
    title: Parent task
    status: todo
    parent_goal_id: goal_invalid_subtask
    subtasks:
      - title: Child without id
        status: todo
        generated_from_task_id: task_parent
---
`,
      },
    ]);

    expect(result.goals).toHaveLength(0);
    expect(result.tasks).toHaveLength(0);
    expect(result.errors).toContainEqual({
      path: "goals/invalid-subtask.md",
      field: "tasks[0].subtasks[0].id",
      message: "Missing id",
    });
  });

  it("keeps agenda files with invalid scheduled rows out of typed loading", () => {
    const result = loadVaultFiles([
      {
        path: "agenda/2026-04-26.md",
        raw: `---
id: agenda_2026_04_26
type: agenda
date: "2026-04-26"
status: active
created: "2026-04-26T09:00:00Z"
generated_at: "2026-04-26T09:00:00Z"
scheduled_tasks:
  - id: scheduled_task_one
    task_id: task_one
    title: Task one
    start_time: "9:00 AM"
    duration_minutes: 0
---
`,
      },
    ]);

    expect(result.agendas).toEqual([]);
    expect(result.errors).toContainEqual({
      path: "agenda/2026-04-26.md",
      field: "scheduled_tasks[0].duration_minutes",
      message: "Invalid duration_minutes",
    });
  });

  it("throws for markdown without frontmatter", () => {
    expect(() => parseMarkdownFrontmatter("No YAML", "goals/plain.md")).toThrow(
      FrontmatterParseError,
    );
  });

  it("updates an embedded task through the goal markdown file", () => {
    const updated = updateTaskInGoalMarkdown(
      goalMarkdown,
      "goals/launch.md",
      "task_onboarding",
      { status: "completed", completedAt: "2026-04-26" },
    );
    const goal = goalFromVaultFile(
      parseMarkdownFrontmatter(updated, "goals/launch.md"),
    );

    expect(goal.tasks[0].status).toBe("completed");
    expect(goal.tasks[0].completedAt).toBe("2026-04-26");
  });

  it("parses nested subtask agenda metadata and parent linkage", () => {
    const raw = `---
id: goal_nested
type: goal
title: Nested Goal
status: active
created: "2026-04-25T12:00:00Z"
tasks:
  - id: task_parent
    title: Parent task
    status: pending
    parent_goal_id: goal_nested
    first_seen_on_agenda: "2026-04-24"
    subtasks:
      - id: subtask_child
        title: Child subtask
        status: pending
        generated_from_task_id: task_parent
        first_seen_on_agenda: "2026-04-24"
        last_missed_decision_on: "2026-04-26"
---
`;
    const path = "goals/nested.md";
    const goal = goalFromVaultFile(parseMarkdownFrontmatter(raw, path));

    expect(goal.tasks[0].firstSeenOnAgenda).toBe("2026-04-24");
    expect(goal.tasks[0].subtasks?.[0]).toMatchObject({
      id: "subtask_child",
      parentTaskId: "task_parent",
      firstSeenOnAgenda: "2026-04-24",
      lastMissedDecisionOn: "2026-04-26",
    });

    const result = loadVaultFiles([{ path, raw }]);
    expect(result.tasks.map((task) => task.id)).toEqual([
      "task_parent",
      "subtask_child",
    ]);
    expect(evaluateMissedWork(result.goals, { today: "2026-04-26" })).toEqual(
      [],
    );
  });
});
