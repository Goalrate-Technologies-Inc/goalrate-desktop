import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../../../test/utils/mockTauri";
import { SettingsPanel } from "../SettingsPanel";

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

describe("SettingsPanel vault recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        return Promise.resolve([
          {
            createdAt: "2026-04-26T12:00:00Z",
            actor: "user",
            action: "write_test_goal",
            targetPath: "goals/history.md",
            snapshotPath: "system/snapshots/history.md",
          },
        ]);
      }
      if (command === "list_vault_error_log_entries") {
        return Promise.resolve([
          {
            createdAt: "2026-04-26T13:00:00Z",
            filePath: "goals/goal_launch.md",
            message: "tasks[0].title is required",
          },
        ]);
      }
      if (command === "preview_vault_snapshot") {
        return Promise.resolve({
          targetPath: "goals/history.md",
          snapshotPath: "system/snapshots/history.md",
          currentExists: true,
          addedLines: 1,
          removedLines: 1,
          unchangedLines: 1,
          currentExcerpt: "title: current",
          restoredExcerpt: "title: restored",
        });
      }
      if (command === "restore_latest_vault_snapshot") {
        return Promise.resolve({
          restoredPath: "goals/test-goal.md",
          snapshotPath: "system/snapshots/test.md",
        });
      }
      if (command === "restore_vault_snapshot") {
        return Promise.resolve({
          restoredPath: "goals/history.md",
          snapshotPath: "system/snapshots/history.md",
        });
      }
      return Promise.resolve(undefined);
    });
  });

  it("restores the latest vault snapshot after confirmation", async () => {
    const onVaultRestored = vi.fn();
    render(
      <SettingsPanel onClose={vi.fn()} onVaultRestored={onVaultRestored} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Restore latest snapshot" }),
    );
    expect(await screen.findByText("+1 / -1 lines")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("restore_latest_vault_snapshot", {
        vaultId: "vault_test",
      });
    });
    await waitFor(() => {
      expect(onVaultRestored).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Restored goals/test-goal.md"),
    ).toBeInTheDocument();
  });

  it("lists snapshots and restores a selected snapshot after confirmation", async () => {
    const onVaultRestored = vi.fn();
    render(
      <SettingsPanel onClose={vi.fn()} onVaultRestored={onVaultRestored} />,
    );

    expect(await screen.findByText("goals/history.md")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Restore goals/history.md snapshot",
      }),
    );
    expect(await screen.findByText("+1 / -1 lines")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("restore_vault_snapshot", {
        vaultId: "vault_test",
        snapshotPath: "system/snapshots/history.md",
      });
    });
    await waitFor(() => {
      expect(onVaultRestored).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Restored goals/history.md"),
    ).toBeInTheDocument();
  });

  it("shows a snapshot preview before restoring a selected snapshot", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("goals/history.md")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Restore goals/history.md snapshot",
      }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("preview_vault_snapshot", {
        vaultId: "vault_test",
        snapshotPath: "system/snapshots/history.md",
      });
    });
    expect(await screen.findByText("+1 / -1 lines")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Restored Snapshot")).toBeInTheDocument();
    expect(screen.getByText("title: current")).toBeInTheDocument();
    expect(screen.getByText("title: restored")).toBeInTheDocument();
  });

  it("shows recent vault issues from logs/errors.md", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("Recent Issues")).toBeInTheDocument();
    expect(await screen.findByText("goals/goal_launch.md")).toBeInTheDocument();
    expect(
      screen.getByText("tasks[0].title is required"),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("list_vault_error_log_entries", {
        vaultId: "vault_test",
        limit: 5,
      });
    });
  });

  it("opens logs/errors.md from recent vault issues", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("Recent Issues")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open logs/errors.md" }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_vault_error_log", {
        vaultId: "vault_test",
      });
    });
  });

  it("opens the affected markdown file from a recent vault issue", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("goals/goal_launch.md")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Open goals/goal_launch.md" }),
    );

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("open_vault_issue_file", {
        vaultId: "vault_test",
        path: "goals/goal_launch.md",
      });
    });
  });

  it("refreshes recent vault issues from logs/errors.md", async () => {
    let issueCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        return Promise.resolve([]);
      }
      if (command === "list_vault_error_log_entries") {
        issueCalls += 1;
        return Promise.resolve(
          issueCalls === 1
            ? [
                {
                  createdAt: "2026-04-26T13:00:00Z",
                  filePath: "goals/goal_launch.md",
                  message: "tasks[0].title is required",
                },
              ]
            : [
                {
                  createdAt: "2026-04-26T13:15:00Z",
                  filePath: "agenda/2026-04-26.md",
                  message:
                    "scheduled_tasks[0].start_time is required",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(
      await screen.findByText("tasks[0].title is required"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh recent issues" }),
    );

    expect(
      await screen.findByText("scheduled_tasks[0].start_time is required"),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(issueCalls).toBe(2);
    });
  });

  it("refreshes recent vault issues when the active vault changes on disk", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    let issueCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        return Promise.resolve([]);
      }
      if (command === "list_vault_error_log_entries") {
        issueCalls += 1;
        return Promise.resolve(
          issueCalls === 1
            ? [
                {
                  createdAt: "2026-04-26T13:00:00Z",
                  filePath: "goals/goal_launch.md",
                  message: "tasks[0].title is required",
                },
              ]
            : [
                {
                  createdAt: "2026-04-26T13:15:00Z",
                  filePath: "agenda/2026-04-26.md",
                  message: "scheduled_tasks[0].start_time is required",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(
      await screen.findByText("tasks[0].title is required"),
    ).toBeInTheDocument();
    expect(listen).toHaveBeenCalledWith(
      "vault-library-updated",
      expect.any(Function),
    );

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_other",
      });
    });
    expect(issueCalls).toBe(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
      });
    });

    expect(
      await screen.findByText("scheduled_tasks[0].start_time is required"),
    ).toBeInTheDocument();
    expect(issueCalls).toBe(2);
  });

  it("uses watcher paths to refresh only affected recovery data", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    let issueCalls = 0;
    let snapshotCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        snapshotCalls += 1;
        return Promise.resolve([]);
      }
      if (command === "list_vault_error_log_entries") {
        issueCalls += 1;
        return Promise.resolve(
          issueCalls === 1
            ? [
                {
                  createdAt: "2026-04-26T13:00:00Z",
                  filePath: "goals/goal_launch.md",
                  message: "tasks[0].title is required",
                },
              ]
            : [
                {
                  createdAt: "2026-04-26T13:15:00Z",
                  filePath: "logs/errors.md",
                  message: "new issue written",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(
      await screen.findByText("tasks[0].title is required"),
    ).toBeInTheDocument();
    expect(snapshotCalls).toBe(1);
    expect(issueCalls).toBe(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["agenda/2026-04-26.md"],
      });
    });
    expect(snapshotCalls).toBe(1);
    expect(issueCalls).toBe(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["logs/errors.md"],
      });
    });

    expect(await screen.findByText("new issue written")).toBeInTheDocument();
    expect(snapshotCalls).toBe(1);
    expect(issueCalls).toBe(2);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["system/mutations.md"],
      });
    });
    expect(snapshotCalls).toBe(2);
    expect(issueCalls).toBe(2);
  });

  it("shows Memory parse issues after the active vault error log changes", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    let issueCalls = 0;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "check_api_keys") {
        return Promise.resolve({ anthropic: false, openai: false });
      }
      if (command === "list_vault_snapshots") {
        return Promise.resolve([]);
      }
      if (command === "list_vault_error_log_entries") {
        issueCalls += 1;
        return Promise.resolve(
          issueCalls === 1
            ? []
            : [
                {
                  createdAt: "2026-04-26T14:00:00Z",
                  filePath: "memory.md",
                  message:
                    "Markdown parse error: YAML parse error: did not find expected node content",
                },
              ],
        );
      }
      return Promise.resolve(undefined);
    });

    render(<SettingsPanel onClose={vi.fn()} />);

    expect(await screen.findByText("No vault issues logged.")).toBeInTheDocument();

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["logs/errors.md"],
      });
    });

    expect(await screen.findByText("memory.md")).toBeInTheDocument();
    expect(
      screen.getByText(/Markdown parse error: YAML parse error/),
    ).toBeInTheDocument();
    expect(issueCalls).toBe(2);
  });
});
