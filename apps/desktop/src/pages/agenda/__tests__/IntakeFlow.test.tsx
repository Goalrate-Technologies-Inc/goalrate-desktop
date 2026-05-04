import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeFlow } from "../IntakeFlow";

const vaultMocks = vi.hoisted(() => ({
  createVault: vi.fn(),
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
    createVault: vaultMocks.createVault,
  }),
}));

describe("IntakeFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  it("persists onboarding domains, goals, tasks, memory, and consent to vault commands", async () => {
    const onComplete = vi.fn();
    render(<IntakeFlow hasVault onComplete={onComplete} />);

    fireEvent.change(screen.getAllByPlaceholderText("e.g., Startup")[0], {
      target: { value: "Startup" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Next: Set Goals/i }));

    fireEvent.change(await screen.findByPlaceholderText("e.g., Launch MVP by April 1"), {
      target: { value: "Launch GoalRate MVP" },
    });
    fireEvent.change(screen.getByDisplayValue(""), {
      target: { value: "2026-05-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Next: Add Tasks/i }));

    fireEvent.change(await screen.findByPlaceholderText("e.g., Write API endpoint"), {
      target: { value: "Ship local-first agenda" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Next: Add Memory/i }));

    fireEvent.change(await screen.findByPlaceholderText("Name"), {
      target: { value: "Avery" },
    });
    fireEvent.change(screen.getByPlaceholderText("Task hrs/day"), {
      target: { value: "4.5" },
    });
    fireEvent.change(screen.getByPlaceholderText("Sleep hrs"), {
      target: { value: "7.5" },
    });
    fireEvent.change(screen.getByPlaceholderText("Exercise min"), {
      target: { value: "30" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Meals, one per line: Lunch | 12:00 PM | 1:00 PM | weekdays",
      ),
      {
        target: { value: "Lunch | 12:00 PM | 1:00 PM | weekdays" },
      },
    );
    fireEvent.change(screen.getByPlaceholderText("Likes and preferences"), {
      target: { value: "deep work, morning planning" },
    });
    fireEvent.change(screen.getByPlaceholderText("Limitations or constraints"), {
      target: { value: "No meetings before 10am" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Important days, one per line: Birthday | 1990-05-10 | yearly",
      ),
      {
        target: { value: "Launch day | 2026-05-15 | yearly | Celebrate" },
      },
    );
    expect(screen.queryByLabelText("Use Memory for planning")).toBeNull();
    fireEvent.click(
      screen.getByLabelText("Allow Memory context in remote AI requests"),
    );

    fireEvent.click(screen.getByRole("button", { name: /Start Planning/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_goal", {
        vaultId: "vault_test",
        data: {
          title: "Launch GoalRate MVP",
          goalType: "Startup",
          deadline: "2026-05-15",
          tags: ["Startup"],
          tasks: [{ title: "Ship local-first agenda" }],
        },
      });
    });
    expect(invoke).toHaveBeenCalledWith("save_memory", {
      vaultId: "vault_test",
      input: {
        userName: "Avery",
        age: null,
        importantDays: [
          {
            label: "Launch day",
            date: "2026-05-15",
            recurrence: "yearly",
            notes: "Celebrate",
          },
        ],
        likes: ["deep work", "morning planning"],
        dislikes: [],
        limitations: ["No meetings before 10am"],
        mealWindows: [
          {
            label: "Lunch",
            startTime: "12:00 PM",
            endTime: "1:00 PM",
            days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
          },
        ],
        snackWindows: [],
        exerciseMinutesNeeded: 30,
        socializationMinutesNeeded: null,
        selfCareMinutesNeeded: null,
        taskCapacityHoursPerDay: 4.5,
        sleepHoursNeeded: 7.5,
        downtimeHoursNeeded: null,
        consent: {
          useForPlanning: true,
          allowAiUpdatesFromChat: false,
          allowRemoteAiContext: true,
          requireConfirmationForSensitiveUpdates: true,
        },
      },
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
