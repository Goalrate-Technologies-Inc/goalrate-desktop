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

describe("DomainSidebar task deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires confirmation before deleting an embedded Goal task", async () => {
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
        return Promise.resolve(
          taskListCalls === 1
            ? [
                {
                  id: "task_shell",
                  title: "Finish shell",
                  status: "todo",
                  parentId: null,
                },
              ]
            : [],
        );
      }
      if (command === "delete_goal_frontmatter_task") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    expect(await screen.findByText("Finish shell")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: 'Delete "Finish shell"' }),
    );

    expect(screen.getByText("Delete Task")).toBeInTheDocument();
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(([command]) => command === "delete_goal_frontmatter_task"),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_goal_frontmatter_task", {
        vaultId: "vault_test",
        goalId: "goal_launch",
        taskId: "task_shell",
        confirmed: true,
      });
    });
  });
});
