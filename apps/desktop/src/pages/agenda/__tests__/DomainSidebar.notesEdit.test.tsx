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

function mockGoalWithNotes(
  notes: string,
  overrides: {
    listGoal?: Record<string, unknown>;
    goal?: Record<string, unknown>;
  } = {},
): void {
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "list_goals") {
      return Promise.resolve([
        {
          id: "goal_launch",
          title: "Launch MVP",
          domain: "Work",
          status: "active",
          priority: "medium",
          ...overrides.listGoal,
        },
      ]);
    }
    if (command === "get_goal") {
      return Promise.resolve({
        title: "Launch MVP",
        notes,
        priority: "medium",
        ...overrides.goal,
      });
    }
    if (command === "list_goal_frontmatter_tasks") {
      return Promise.resolve([]);
    }
    return Promise.resolve(undefined);
  });
}

describe("DomainSidebar goal notes editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the notes editor when existing notes are clicked in the goal modal", async () => {
    mockGoalWithNotes("Draft launch notes");

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByText("Draft launch notes"));

    expect(
      await screen.findByDisplayValue("Draft launch notes"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Goal Notes")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Edit" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Preview" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("opens the notes editor when the empty notes section is clicked", async () => {
    mockGoalWithNotes("");

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    fireEvent.click(
      await screen.findByText("No notes yet. Click here to add notes."),
    );

    expect(
      await screen.findByPlaceholderText("Write notes about this goal..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });

  it("saves edited notes from inside the goal modal", async () => {
    mockGoalWithNotes("Draft launch notes");

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });
    fireEvent.click(await screen.findByText("Draft launch notes"));
    fireEvent.change(await screen.findByDisplayValue("Draft launch notes"), {
      target: { value: "Updated launch notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_goal", {
        vaultId: "vault_test",
        goalId: "goal_launch",
        data: { notes: "Updated launch notes" },
      });
    });
    expect(await screen.findByText("Updated launch notes")).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Updated launch notes"),
    ).not.toBeInTheDocument();
  });

  it("updates the goal priority from inside the goal modal", async () => {
    mockGoalWithNotes("");

    render(<DomainSidebar />);

    fireEvent.mouseUp(await screen.findByText("Launch MVP"), { button: 0 });

    const prioritySelect = await screen.findByLabelText(
      "Priority for Launch MVP",
    );
    expect(prioritySelect).toHaveValue("medium");

    fireEvent.change(prioritySelect, { target: { value: "critical" } });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_goal", {
        vaultId: "vault_test",
        goalId: "goal_launch",
        data: { priority: "critical" },
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Priority for Launch MVP")).toHaveValue(
        "critical",
      );
    });
  });
});
