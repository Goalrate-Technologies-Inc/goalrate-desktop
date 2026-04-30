import {
  listen,
  type EventCallback,
  type EventName,
  type Options,
  type UnlistenFn,
} from "@tauri-apps/api/event";

type RuntimeUnlistenFn = () => void | Promise<void>;

interface AttachTauriEventListenerOptions extends Options {
  onError?: (err: unknown) => void;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isBenignUnlistenError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "";

  return (
    message.includes("handlerId") ||
    message.includes("listeners[eventId]") ||
    message.includes("unregisterListener")
  );
}

export function safeUnlisten(
  unlisten: UnlistenFn | RuntimeUnlistenFn,
  label: string,
): void {
  try {
    const result = (unlisten as RuntimeUnlistenFn)();
    if (isPromiseLike(result)) {
      result.catch((err: unknown) => {
        if (!isBenignUnlistenError(err)) {
          console.warn(`[Tauri events] Failed to remove ${label} listener:`, err);
        }
      });
    }
  } catch (err) {
    if (!isBenignUnlistenError(err)) {
      console.warn(`[Tauri events] Failed to remove ${label} listener:`, err);
    }
  }
}

export function attachTauriEventListener<T>(
  event: EventName | string,
  handler: EventCallback<T>,
  options: AttachTauriEventListenerOptions = {},
): () => void {
  const { onError, ...listenOptions } = options;
  const listenArgs =
    Object.keys(listenOptions).length > 0
      ? ([event as EventName, handler, listenOptions] as const)
      : ([event as EventName, handler] as const);
  let disposed = false;
  let cleanup: (() => void) | undefined;

  void listen<T>(...listenArgs)
    .then((unlisten) => {
      const guardedCleanup = (): void => {
        safeUnlisten(unlisten, event);
      };

      if (disposed) {
        guardedCleanup();
      } else {
        cleanup = guardedCleanup;
      }
    })
    .catch((err) => {
      if (!disposed) {
        onError?.(err);
      }
    });

  return () => {
    disposed = true;
    cleanup?.();
    cleanup = undefined;
  };
}
