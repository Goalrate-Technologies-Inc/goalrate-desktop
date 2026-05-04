import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainSidebar } from "../DomainSidebar";

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

describe("DomainSidebar task recurrence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a user set how often an embedded Goal task recurs", async () => {
    let taskListCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch MVP",
            domain: "Work",
            status: "active",
            priority: "medium",
          },
        ]);
      }
      if (command === "get_goal") {
        return Promise.resolve({ notes: "" });
      }
      if (command === "list_goal_frontmatter_tasks") {
        taskListCalls += 1;
        return Promise.resolve([
          {
            id: "task_shell",
            title: "Finish shell",
            status: "todo",
            parentId: null,
            recurring: taskListCalls > 1 ? "weekly" : null,
          },
        ]);
      }
      if (command === "update_goal_frontmatter_task_recurrence") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    expect(
      screen.queryByLabelText('Recurrence for "Finish shell"'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle("Does not repeat")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTitle("Edit task"));

    const recurrenceSelect = await screen.findByLabelText(
      'Recurrence for "Finish shell"',
    );

    expect(recurrenceSelect).toHaveValue("");

    fireEvent.change(recurrenceSelect, { target: { value: "weekly" } });
    expect(
      screen.getByLabelText('Recurrence for "Finish shell"'),
    ).toHaveValue("weekly");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([command]) => command === "update_goal_frontmatter_task_recurrence",
        ),
    ).toBe(false);

    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_goal_frontmatter_task_recurrence",
        {
          vaultId: "vault_test",
          goalId: "goal_launch",
          taskId: "task_shell",
          recurrence: "weekly",
        },
      );
    });
    await waitFor(() => {
      expect(screen.getByTitle("Repeats weekly")).toBeInTheDocument();
    });
    expect(
      screen.queryByLabelText('Recurrence for "Finish shell"'),
    ).not.toBeInTheDocument();
  });

  it("lets a user set the exact date for an embedded Goal task", async () => {
    let taskListCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch MVP",
            domain: "Work",
            status: "active",
            priority: "medium",
          },
        ]);
      }
      if (command === "get_goal") {
        return Promise.resolve({ notes: "" });
      }
      if (command === "list_goal_frontmatter_tasks") {
        taskListCalls += 1;
        return Promise.resolve([
          {
            id: "task_shell",
            title: "Finish shell",
            status: "todo",
            parentId: null,
            recurring: null,
            scheduledDate: taskListCalls > 1 ? "2026-04-30" : null,
          },
        ]);
      }
      if (command === "update_goal_frontmatter_task_scheduled_date") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    expect(
      screen.queryByTitle("Scheduled for 2026-04-30"),
    ).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTitle("Edit task"));

    const scheduledDateInput = await screen.findByLabelText(
      'Scheduled date for "Finish shell"',
    );

    expect(scheduledDateInput).toHaveValue("");

    fireEvent.change(scheduledDateInput, {
      target: { value: "2026-04-30" },
    });
    expect(
      screen.getByLabelText('Scheduled date for "Finish shell"'),
    ).toHaveValue("2026-04-30");
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([command]) =>
            command === "update_goal_frontmatter_task_scheduled_date",
        ),
    ).toBe(false);

    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "update_goal_frontmatter_task_scheduled_date",
        {
          vaultId: "vault_test",
          goalId: "goal_launch",
          taskId: "task_shell",
          scheduledDate: "2026-04-30",
        },
      );
    });
    await waitFor(() => {
      expect(
        screen.queryByLabelText('Scheduled date for "Finish shell"'),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTitle("Scheduled for 2026-04-30")).toBeInTheDocument();
  });
});
