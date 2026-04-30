import { describe, expect, it } from "vitest";
import { hasTauriIpc } from "../test/tauriIntegration";

describe.runIf(!hasTauriIpc())("Tauri IPC prerequisite", () => {
  it("reports that native integration suites are skipped outside Tauri IPC", () => {
    console.warn(
      "Skipping native integration suites because Tauri IPC is not available in this test process.",
    );

    expect(hasTauriIpc()).toBe(false);
  });
});
