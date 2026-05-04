import { afterEach, describe, expect, it } from "vitest";
import { hasTauriIpc } from "../tauriIntegration";

type TauriWindow = Window &
  typeof globalThis & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };

const tauriWindow = window as TauriWindow;
const originalInternals = tauriWindow.__TAURI_INTERNALS__;

afterEach(() => {
  if (originalInternals === undefined) {
    delete tauriWindow.__TAURI_INTERNALS__;
  } else {
    tauriWindow.__TAURI_INTERNALS__ = originalInternals;
  }
});

describe("tauriIntegration", () => {
  it("reports no IPC when Tauri internals are absent", () => {
    delete tauriWindow.__TAURI_INTERNALS__;

    expect(hasTauriIpc()).toBe(false);
  });

  it("reports IPC when Tauri exposes invoke internals", () => {
    tauriWindow.__TAURI_INTERNALS__ = {
      invoke: () => undefined,
    };

    expect(hasTauriIpc()).toBe(true);
  });
});
