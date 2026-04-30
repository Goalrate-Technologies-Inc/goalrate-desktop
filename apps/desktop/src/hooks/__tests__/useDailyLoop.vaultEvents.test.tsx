import { act, renderHook, waitFor } from "@testing-library/react";
import { emit, listen } from "@tauri-apps/api/event";
import type { DailyPlan } from "@goalrate-app/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriEventMock } from "../../test/utils/mockTauri";
import * as dailyLoopIpc from "../../lib/dailyLoopIpc";
import { useDailyLoop } from "../useDailyLoop";

vi.mock("../../context/VaultContext", () => ({
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

vi.mock("../../lib/dailyLoopIpc", () => ({
  DEFAULT_AI_MODEL: "test-model",
  getPlan: vi.fn(),
  getAgendaWarnings: vi.fn(),
  getTaskMetadata: vi.fn(),
  getOutcomes: vi.fn(),
  getChatHistory: vi.fn(),
  getCheckIn: vi.fn(),
  getRecentStats: vi.fn(),
}));

function planWithTask(taskId: string, title: string): DailyPlan {
  return {
    id: "plan_2026_04_26",
    date: "2026-04-26",
    top3OutcomeIds: [],
    taskOrder: [taskId],
    taskTitles: { [taskId]: title },
    completedTaskIds: [],
    scheduledTasks: [
      {
        id: `scheduled_${taskId}`,
        taskId,
        title,
        startTime: "9:00 AM",
        durationMinutes: 30,
      },
    ],
    lockedAt: null,
    createdAt: "2026-04-26T08:00:00Z",
    updatedAt: "2026-04-26T08:00:00Z",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

describe("useDailyLoop vault events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listen).mockResolvedValue(() => {});
    vi.mocked(emit).mockResolvedValue(undefined);
    vi.mocked(dailyLoopIpc.getAgendaWarnings).mockResolvedValue([]);
    vi.mocked(dailyLoopIpc.getTaskMetadata).mockResolvedValue({});
    vi.mocked(dailyLoopIpc.getOutcomes).mockResolvedValue([]);
    vi.mocked(dailyLoopIpc.getChatHistory).mockResolvedValue([]);
    vi.mocked(dailyLoopIpc.getCheckIn).mockResolvedValue(null);
    vi.mocked(dailyLoopIpc.getRecentStats).mockResolvedValue([]);
  });

  it("refreshes agenda data when the active vault changes on disk", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    vi.mocked(dailyLoopIpc.getPlan)
      .mockResolvedValueOnce(
        planWithTask("task_before", "Before external edit"),
      )
      .mockResolvedValueOnce(planWithTask("task_after", "After external edit"));

    const { result } = renderHook(() => useDailyLoop());

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_before"]);
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith(
      "vault-library-updated",
      expect.any(Function),
    );

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_other",
      });
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
      });
    });

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_after"]);
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(2);
  });

  it("uses watcher paths to ignore unrelated active-vault changes", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    const today = toLocalDateString();
    vi.mocked(dailyLoopIpc.getPlan)
      .mockResolvedValueOnce(
        planWithTask("task_before", "Before external edit"),
      )
      .mockResolvedValueOnce(planWithTask("task_after", "After external edit"));

    const { result } = renderHook(() => useDailyLoop());

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_before"]);
    });

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["logs/errors.md"],
      });
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(1);

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: [`agenda/${today}.md`],
      });
    });

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_after"]);
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(2);
  });

  it("ignores stale overlapping refresh results", async () => {
    const slowInitial = deferred<DailyPlan | null>();
    const fastRefresh = deferred<DailyPlan | null>();
    vi.mocked(dailyLoopIpc.getPlan)
      .mockReturnValueOnce(slowInitial.promise)
      .mockReturnValueOnce(fastRefresh.promise);

    const { result } = renderHook(() => useDailyLoop());

    await waitFor(() => {
      expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(1);
    });

    let refreshPromise: Promise<void> | undefined;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => {
      expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(2);
    });

    fastRefresh.resolve(planWithTask("task_after", "After refresh"));
    await act(async () => {
      await refreshPromise!;
    });

    expect(result.current.plan?.taskOrder).toEqual(["task_after"]);

    slowInitial.resolve(planWithTask("task_before", "Stale initial load"));
    await act(async () => {
      await slowInitial.promise;
      await Promise.resolve();
    });

    expect(result.current.plan?.taskOrder).toEqual(["task_after"]);
  });

  it("coalesces watcher refreshes while a refresh is already running", async () => {
    const eventMock = setupTauriEventMock(vi.mocked(listen), vi.mocked(emit));
    const today = toLocalDateString();
    const slowWatcherRefresh = deferred<DailyPlan | null>();

    vi.mocked(dailyLoopIpc.getPlan)
      .mockResolvedValueOnce(planWithTask("task_before", "Before external edit"))
      .mockReturnValueOnce(slowWatcherRefresh.promise)
      .mockResolvedValueOnce(planWithTask("task_after", "After external edits"));

    const { result } = renderHook(() => useDailyLoop());

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_before"]);
    });

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: [`agenda/${today}.md`],
      });
    });
    await waitFor(() => {
      expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: [`agenda/${today}.md`],
      });
      eventMock.simulateEvent("vault-library-updated", {
        vaultId: "vault_test",
        paths: ["goals/launch.md"],
      });
    });
    expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(2);

    await act(async () => {
      slowWatcherRefresh.resolve(
        planWithTask("task_mid", "Intermediate external edit"),
      );
      await slowWatcherRefresh.promise;
    });
    await waitFor(() => {
      expect(dailyLoopIpc.getPlan).toHaveBeenCalledTimes(3);
    });

    await waitFor(() => {
      expect(result.current.plan?.taskOrder).toEqual(["task_after"]);
    });
  });
});
