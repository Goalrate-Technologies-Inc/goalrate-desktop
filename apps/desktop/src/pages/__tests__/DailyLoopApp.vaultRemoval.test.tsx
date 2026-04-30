import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DailyLoopApp } from "../DailyLoopApp";

const vaultMocks = vi.hoisted(() => ({
  closeVault: vi.fn(),
  refreshVaults: vi.fn(),
}));

vi.mock("../../hooks/useDailyLoop", () => ({
  useDailyLoop: () => ({
    dataVersion: 0,
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../context/VaultContext", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const activeVault = {
    id: "vault_test",
    name: "Test Vault",
    path: "/tmp/test-vault",
    vaultType: "private",
    created: "2026-04-26T00:00:00Z",
  };

  return {
    useVault: () => {
      const [currentVault, setCurrentVault] = React.useState<
        typeof activeVault | null
      >(activeVault);

      return {
        currentVault,
        vaults: [activeVault],
        openVault: vi.fn().mockResolvedValue(undefined),
        closeVault: vaultMocks.closeVault.mockImplementation(async () => {
          setCurrentVault(null);
        }),
        refreshVaults: vaultMocks.refreshVaults.mockResolvedValue(undefined),
      };
    },
  };
});

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
  IntakeFlow: ({ hasVault }: { hasVault: boolean }) => (
    <div>{hasVault ? "Intake with vault" : "Intake without vault"}</div>
  ),
}));

vi.mock("../daily-loop/SettingsPanel", () => ({
  SettingsPanel: () => <div>Settings panel</div>,
}));

describe("DailyLoopApp vault removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "list_goals") {
        return Promise.resolve([{ id: "goal_launch" }]);
      }
      if (command === "delete_vault") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  });

  it("clears the active workspace and returns to intake after removing the active vault reference", async () => {
    render(<DailyLoopApp />);

    expect(await screen.findByText("Roadmap panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Test Vault/i }));
    fireEvent.click(screen.getByTitle("Remove vault"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(vaultMocks.closeVault).toHaveBeenCalledTimes(1);
    });
    expect(invoke).toHaveBeenCalledWith("delete_vault", {
      vaultId: "vault_test",
    });
    expect(vaultMocks.refreshVaults).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Intake without vault"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Roadmap panel")).not.toBeInTheDocument();
  });
});
