import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { emit, listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../test/utils/mockTauri";
import App from "../App";

const appMocks = vi.hoisted(() => ({
  closeVault: vi.fn(),
}));

function PassthroughProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}

vi.mock("@goalrate-app/ui/overlay", () => ({
  TooltipProvider: PassthroughProvider,
}));

vi.mock("../context/AuthContext", () => ({
  AuthProvider: PassthroughProvider,
  useAuth: () => ({
    isAuthenticated: false,
    mode: "anonymous",
  }),
}));

vi.mock("../context/VaultContext", () => ({
  VaultProvider: PassthroughProvider,
  useVault: () => ({
    closeVault: appMocks.closeVault,
  }),
}));

vi.mock("../context/PreferencesContext", () => ({
  PreferencesProvider: PassthroughProvider,
}));

vi.mock("../components/QuickCaptureDialog", () => ({
  QuickCaptureDialog: () => null,
}));

vi.mock("../pages/AgendaApp", () => ({
  AgendaApp: () => <div>Agenda</div>,
}));

describe("App native menu actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
    appMocks.closeVault.mockResolvedValue(undefined);
  });

  it("routes vault menu actions through close-vault behavior", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));

    render(<App />);

    expect(await screen.findByText("Agenda")).toBeInTheDocument();
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith("menu-action", expect.any(Function));
    });

    eventMock.simulateEvent("menu-action", "file:new-vault");
    eventMock.simulateEvent("menu-action", "file:open-vault");
    eventMock.simulateEvent("menu-action", "file:close-vault");

    await waitFor(() => {
      expect(appMocks.closeVault).toHaveBeenCalledTimes(3);
    });
  });
});
