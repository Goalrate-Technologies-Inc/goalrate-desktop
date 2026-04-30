import { describe, expect, it } from "vitest";

import {
  assertAgentWriteAllowed,
  createVaultMutationAgent,
  type AgentWriteRequest,
} from "../agents";

const nextFile = {
  path: "goals/goal_assistant.md",
  kind: "goal",
  frontmatter: {
    id: "goal_assistant",
    created_at: "2026-04-26T09:00:00-07:00",
    title: "Assistant Goal",
    status: "active",
  },
  body: "Notes",
  raw: "---\nid: goal_assistant\n---\nNotes",
} satisfies AgentWriteRequest["nextFile"];

const agendaFile = {
  path: "agenda/2026-04-26.md",
  kind: "agenda",
  frontmatter: {
    id: "agenda_2026_04_26",
    type: "agenda",
    created: "2026-04-26T09:00:00-07:00",
    date: "2026-04-26",
    status: "active",
    generated_at: "2026-04-26T09:00:00-07:00",
    scheduled_tasks: [
      {
        id: "scheduled_task_one",
        task_id: "task_one",
        title: "Task one",
        start_time: "9:00 AM",
        duration_minutes: 30,
      },
    ],
  },
  body: "## Schedule",
  raw: "---\nid: agenda_2026_04_26\n---\n## Schedule",
} satisfies AgentWriteRequest["nextFile"];

function writeRequest(
  overrides: Partial<AgentWriteRequest> = {},
): AgentWriteRequest {
  return {
    vaultId: "vault_test",
    actor: "assistant",
    action: "assistant_generate_goal_tasks",
    filePath: nextFile.path,
    nextFile,
    reason: "Generate a task from Assistant planning",
    ...overrides,
  };
}

describe("agent vault write guardrails", () => {
  it("allows Assistant-originated writes with schema identity", () => {
    expect(() => assertAgentWriteAllowed(writeRequest())).not.toThrow();
  });

  it("rejects destructive Assistant writes without confirmation", () => {
    expect(() =>
      assertAgentWriteAllowed(writeRequest({ destructive: true })),
    ).toThrow("explicit confirmation");
  });

  it("rejects legacy ai actor names for mutation logs", () => {
    expect(() =>
      assertAgentWriteAllowed(
        writeRequest({ actor: "ai" as AgentWriteRequest["actor"] }),
      ),
    ).toThrow("assistant or system");
  });

  it("validates, snapshots, writes markdown, and logs successful Assistant mutations", async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const snapshots: Array<{ path: string; contents: string }> = [];
    const mutationEntries: string[] = [];
    const agent = createVaultMutationAgent({
      now: () => new Date("2026-04-26T16:00:00.000Z"),
      createId: () => "mutation_test",
      storage: {
        readFile: async () => "previous markdown",
        writeFile: async (path, contents) => {
          writes.push({ path, contents });
        },
        writeSnapshot: async (path, contents) => {
          snapshots.push({ path, contents });
          return "system/snapshots/goals_goal_assistant_20260426.md";
        },
        appendMutationLog: async (entry) => {
          mutationEntries.push(entry);
        },
      },
    });

    const result = await agent.writeVaultFile(writeRequest());

    expect(result.ok).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(snapshots).toEqual([
      { path: "goals/goal_assistant.md", contents: "previous markdown" },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("goals/goal_assistant.md");
    expect(writes[0].contents).toContain("id: goal_assistant");
    expect(writes[0].contents).toContain("title: Assistant Goal");
    expect(result.mutationLog).toMatchObject({
      id: "mutation_test",
      timestamp: "2026-04-26T16:00:00.000Z",
      actor: "assistant",
      action: "assistant_generate_goal_tasks",
      filePath: "goals/goal_assistant.md",
      entityId: "goal_assistant",
      snapshotPath: "system/snapshots/goals_goal_assistant_20260426.md",
      summary: "Generate a task from Assistant planning",
    });
    expect(mutationEntries[0]).toContain("- Actor: assistant");
    expect(mutationEntries[0]).toContain("- Action: assistant_generate_goal_tasks");
    expect(mutationEntries[0]).toContain("- File: `goals/goal_assistant.md`");
    expect(mutationEntries[0]).toContain("- Snapshot: `system/snapshots/");
  });

  it("returns validation errors without writing invalid Assistant mutations", async () => {
    const writes: string[] = [];
    const agent = createVaultMutationAgent({
      storage: {
        readFile: async () => "previous markdown",
        writeFile: async (path) => {
          writes.push(path);
        },
        writeSnapshot: async () => {
          throw new Error("should not snapshot invalid writes");
        },
        appendMutationLog: async () => {
          throw new Error("should not log invalid writes");
        },
      },
    });

    const invalidFile = {
      ...nextFile,
      frontmatter: {
        ...nextFile.frontmatter,
        title: undefined,
      },
    };

    const result = await agent.writeVaultFile(
      writeRequest({ nextFile: invalidFile }),
    );

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContainEqual({
      path: "goals/goal_assistant.md",
      field: "title",
      message: "Missing title",
    });
    expect(writes).toEqual([]);
  });

  it("reports missing ids as validation errors without writing", async () => {
    const writes: string[] = [];
    const agent = createVaultMutationAgent({
      storage: {
        readFile: async () => "previous markdown",
        writeFile: async (path) => {
          writes.push(path);
        },
        writeSnapshot: async () => {
          throw new Error("should not snapshot invalid writes");
        },
        appendMutationLog: async () => {
          throw new Error("should not log invalid writes");
        },
      },
    });

    const invalidFile = {
      ...nextFile,
      frontmatter: {
        ...nextFile.frontmatter,
        id: undefined,
      },
    };

    const result = await agent.writeVaultFile(
      writeRequest({ nextFile: invalidFile }),
    );

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContainEqual({
      path: "goals/goal_assistant.md",
      field: "id",
      message: "Missing id",
    });
    expect(writes).toEqual([]);
  });

  it("validates Agenda-required frontmatter before Assistant writes", async () => {
    const writes: string[] = [];
    const agent = createVaultMutationAgent({
      storage: {
        readFile: async () => "previous markdown",
        writeFile: async (path) => {
          writes.push(path);
        },
        writeSnapshot: async () => {
          throw new Error("should not snapshot invalid writes");
        },
        appendMutationLog: async () => {
          throw new Error("should not log invalid writes");
        },
      },
    });

    const result = await agent.writeVaultFile(
      writeRequest({
        action: "assistant_update_agenda",
        filePath: agendaFile.path,
        nextFile: {
          ...agendaFile,
          frontmatter: {
            ...agendaFile.frontmatter,
            scheduled_tasks: undefined,
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContainEqual({
      path: "agenda/2026-04-26.md",
      field: "scheduled_tasks",
      message: "Missing scheduled_tasks",
    });
    expect(writes).toEqual([]);
  });

  it("validates Agenda scheduled-task row fields before Assistant writes", async () => {
    const writes: string[] = [];
    const agent = createVaultMutationAgent({
      storage: {
        readFile: async () => "previous markdown",
        writeFile: async (path) => {
          writes.push(path);
        },
        writeSnapshot: async () => {
          throw new Error("should not snapshot invalid writes");
        },
        appendMutationLog: async () => {
          throw new Error("should not log invalid writes");
        },
      },
    });

    const result = await agent.writeVaultFile(
      writeRequest({
        action: "assistant_update_agenda",
        filePath: agendaFile.path,
        nextFile: {
          ...agendaFile,
          frontmatter: {
            ...agendaFile.frontmatter,
            scheduled_tasks: [
              {
                id: "scheduled_task_one",
                task_id: "task_one",
                title: "Task one",
                duration_minutes: 30,
              },
            ],
          },
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.validationErrors).toContainEqual({
      path: "agenda/2026-04-26.md",
      field: "scheduled_tasks[0].start_time",
      message: "Missing start_time",
    });
    expect(writes).toEqual([]);
  });
});
