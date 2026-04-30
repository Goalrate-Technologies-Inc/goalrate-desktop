import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDailyLoopReturn } from "../../../hooks/useDailyLoop";
import { PlanGenerateButton } from "../PlanGenerateButton";
import * as dailyLoopIpc from "../../../lib/dailyLoopIpc";

const subscriptionState = vi.hoisted(() => ({
  allowsAi: false,
}));

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

vi.mock("../../../context/SubscriptionContext", () => ({
  useSubscription: () => ({
    status: {
      planId: subscriptionState.allowsAi ? "plus" : "free",
      state: subscriptionState.allowsAi ? "active" : "none",
      active: subscriptionState.allowsAi,
      willRenew: null,
      source: subscriptionState.allowsAi ? "stripe" : "none",
      expiresAt: null,
      checkedAt: "2026-04-28T00:00:00Z",
      managementUrl: "https://goalrate.com/account/billing",
    },
    product: {
      planId: "plus",
      displayName: "GoalRate Plus",
      description: "AI planning",
      displayPrice: "$15.00",
      billingCycle: "monthly",
      subscriptionPeriod: { unit: "month", value: 1, display: "Monthly" },
    },
    isLoading: false,
    isPurchasing: false,
    isManaging: false,
    error: null,
    allowsAi: subscriptionState.allowsAi,
    hasEntitlement: () => subscriptionState.allowsAi,
    refresh: vi.fn(),
    startPlusCheckout: vi.fn(),
    manageBilling: vi.fn(),
  }),
}));

vi.mock("../../../lib/dailyLoopIpc", async (importOriginal) => {
  const actual = await importOriginal<typeof dailyLoopIpc>();
  return {
    ...actual,
    generatePlan: vi.fn(),
  };
});

function dailyLoop(): UseDailyLoopReturn {
  return {
    date: "2026-04-28",
    plan: null,
    outcomes: [],
    chatHistory: [],
    checkIn: null,
    agendaWarnings: [],
    isLoading: false,
    error: null,
    taskTitles: {},
    taskMetadata: {},
    recentStats: [],
    dataVersion: 0,
    mergeTaskTitles: vi.fn(),
    createPlan: vi.fn(),
    updatePlan: vi.fn(),
    updateScheduledTasks: vi.fn(),
    addOutcome: vi.fn(),
    updateOutcome: vi.fn(),
    deleteOutcome: vi.fn(),
    deferTask: vi.fn(),
    toggleTaskCompletion: vi.fn(),
    sendChat: vi.fn(),
    createCheckIn: vi.fn(),
    openAgendaErrorLog: vi.fn(),
    setDate: vi.fn(),
    refresh: vi.fn(),
  };
}

describe("PlanGenerateButton subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptionState.allowsAi = false;
  });

  it("creates a local Agenda on Free without calling AI", async () => {
    const loop = dailyLoop();
    render(<PlanGenerateButton dailyLoop={loop} />);

    expect(screen.getByText("Upgrade to GoalRate Plus")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Agenda" }));

    await waitFor(() => {
      expect(loop.createPlan).toHaveBeenCalledTimes(1);
    });
    expect(dailyLoopIpc.generatePlan).not.toHaveBeenCalled();
  });

  it("generates an AI Agenda when Plus is active", async () => {
    subscriptionState.allowsAi = true;
    const loop = dailyLoop();
    vi.mocked(dailyLoopIpc.generatePlan).mockResolvedValue({
      plan: {} as never,
      outcomes: [],
      dailyInsight: null,
      patternNote: null,
      deferralsConfrontation: [],
      taskTitles: {},
    });

    render(<PlanGenerateButton dailyLoop={loop} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Agenda" }));

    await waitFor(() => {
      expect(dailyLoopIpc.generatePlan).toHaveBeenCalledWith(
        "vault_test",
        dailyLoopIpc.DEFAULT_AI_MODEL,
        "2026-04-28",
      );
    });
  });
});
