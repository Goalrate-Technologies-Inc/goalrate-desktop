import { describe } from "vitest";

type TauriWindow = Window &
  typeof globalThis & {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  };

export function hasTauriIpc(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as TauriWindow).__TAURI_INTERNALS__?.invoke === "function";
}

export const describeTauriIntegration = hasTauriIpc() ? describe : describe.skip;
