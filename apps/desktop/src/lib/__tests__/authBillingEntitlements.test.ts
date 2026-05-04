import { describe, expect, it } from "vitest";
import {
  parseDesktopAuthCallbackUrl,
  DESKTOP_AUTH_STATE_STORAGE_KEY,
} from "../authBillingEntitlements";

describe("desktop hosted auth callback parsing", () => {
  it("accepts a GoalRate callback with a verified state and exchange code", () => {
    const result = parseDesktopAuthCallbackUrl(
      "goalrate://auth/callback?code=abcDEF1234567890._~-&state=state_123",
      "state_123",
    );

    expect(result).toEqual({
      code: "abcDEF1234567890._~-",
      state: "state_123",
    });
  });

  it("rejects callbacks with mismatched state", () => {
    expect(() =>
      parseDesktopAuthCallbackUrl(
        "goalrate://auth/callback?code=abcDEF1234567890&state=wrong",
        "expected",
      ),
    ).toThrow(/verify the sign-in state/i);
  });

  it("rejects non-GoalRate callback URLs", () => {
    expect(() =>
      parseDesktopAuthCallbackUrl(
        "https://app.goalrate.com/auth/callback?code=abcDEF1234567890&state=state_123",
        "state_123",
      ),
    ).toThrow(/unexpected sign-in callback/i);
  });

  it("uses a stable storage key for pending desktop auth state", () => {
    expect(DESKTOP_AUTH_STATE_STORAGE_KEY).toBe("goalrate.desktopAuth.state");
  });
});
