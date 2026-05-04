import { act, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../../../test/utils/mockTauri";
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

describe("DomainSidebar vault events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
  });

  it("refreshes Roadmap for Goal and Task path changes only", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    let listGoalsCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        listGoalsCalls += 1;
        return Promise.resolve(
          listGoalsCalls === 1
            ? [
                {
                  id: "goal_before",
                  title: "Before external edit",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ]
            : [
                {
                  id: "goal_after",
                  title: "After external edit",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<DomainSidebar dataVersion={0} />);

    expect(await screen.findByText("Before external edit")).toBeInTheDocument();
    expect(listGoalsCalls).toBe(1);
    expect(listen).toHaveBeenCalledWith(
      "vault-library-updated",
      expect.any(Function),
    );

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_other",
        paths: ["goals/other.md"],
      });
    });
    expect(listGoalsCalls).toBe(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["logs/errors.md"],
      });
    });
    expect(listGoalsCalls).toBe(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["goals/goal_after.md"],
      });
    });

    expect(await screen.findByText("After external edit")).toBeInTheDocument();
    expect(listGoalsCalls).toBe(2);
  });

  it("opens the goal preview for an Agenda goal-notes request", async () => {
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([
          {
            id: "goal_launch",
            title: "Launch Goal",
            domain: "Work",
            status: "active",
            priority: "medium",
          },
        ]);
      }
      if (command === "get_goal") {
        return Promise.resolve({ notes: "Goal notes from Agenda" });
      }
      if (command === "list_goal_frontmatter_tasks") {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    render(
      <DomainSidebar
        dataVersion={0}
        openGoalRequest={{
          requestId: 1,
          goalId: "goal_launch",
          title: "Launch Goal",
        }}
      />,
    );

    expect(await screen.findByText("Goal notes from Agenda")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_goal", {
      vaultId: "vault_test",
      goalId: "goal_launch",
    });
  });

  it("treats missing watcher paths as a broad Roadmap refresh", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    let listGoalsCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        listGoalsCalls += 1;
        return Promise.resolve(
          listGoalsCalls === 1
            ? [
                {
                  id: "goal_before",
                  title: "Before broad refresh",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ]
            : [
                {
                  id: "goal_after",
                  title: "After broad refresh",
                  domain: "Work",
                  status: "active",
                  priority: "medium",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<DomainSidebar dataVersion={0} />);

    expect(await screen.findByText("Before broad refresh")).toBeInTheDocument();

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
      });
    });

    expect(await screen.findByText("After broad refresh")).toBeInTheDocument();
    expect(listGoalsCalls).toBe(2);
  });
});
