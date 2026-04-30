import { act, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../../test/utils/mockTauri";
import { DailyLoopApp } from "../DailyLoopApp";

vi.mock("../../hooks/useDailyLoop", () => ({
  useDailyLoop: () => ({
    dataVersion: 0,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../context/VaultContext", () => ({
  useVault: () => ({
    currentVault: {
      id: "vault_test",
      name: "Test Vault",
      path: "/tmp/test-vault",
      vaultType: "private",
      created: "2026-04-26T00:00:00Z",
    },
    vaults: [],
    openVault: vi.fn().mockResolvedValue(undefined),
    closeVault: vi.fn().mockResolvedValue(undefined),
    refreshVaults: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../daily-loop/DomainSidebar", () => ({
  DomainSidebar: () => <div>Roadmap panel</div>,
}));

vi.mock("../daily-loop/TodaysPlan", () => ({
  TodaysPlan: () => <div>Agenda panel</div>,
}));

vi.mock("../daily-loop/AiChatPanel", () => ({
  AiChatPanel: () => <div>Assistant panel</div>,
}));

vi.mock("../daily-loop/IntakeFlow", () => ({
  IntakeFlow: () => <div>Intake flow</div>,
}));

vi.mock("../daily-loop/SettingsPanel", () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}));

describe("DailyLoopApp vault events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([{ id: "goal_launch" }]);
      }
      return Promise.resolve(undefined);
    });
  });

  it("shows a transient local refresh status for active-vault changes", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));

    render(<DailyLoopApp />);

    expect(await screen.findByText("Roadmap panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith(
        "vault-library-updated",
        expect.any(Function),
      );
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 3, 26, 9, 30, 0));
      await act(async () => {
        eventMock.simulateEvent("vault-library-updated", {
          vaultId: "vault_other",
          paths: ["goals/other.md"],
        });
      });
      expect(screen.queryByText("Goals refreshed")).not.toBeInTheDocument();

      await act(async () => {
        eventMock.simulateEvent("vault-library-updated", {
          vaultId: "vault_test",
          paths: ["goals/goal_launch.md"],
        });
      });
      expect(screen.getByText("Goals refreshed")).toHaveAttribute(
        "title",
        "Last refreshed at 9:30 AM",
      );

      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      expect(screen.queryByText("Goals refreshed")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a broad local refresh status when changed paths span areas", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));

    render(<DailyLoopApp />);

    expect(await screen.findByText("Roadmap panel")).toBeInTheDocument();
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith(
        "vault-library-updated",
        expect.any(Function),
      );
    });

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["goals/goal_launch.md", "agenda/2026-04-26.md"],
      });
    });

    expect(screen.getByText("Vault refreshed")).toBeInTheDocument();
  });
});
