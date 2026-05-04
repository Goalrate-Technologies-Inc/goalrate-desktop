import { describe, expect, it } from "vitest";
import {
  normalizeEntitlementStatus,
  normalizeSubscriptionStatus,
  subscriptionAllowsAi,
  subscriptionHasEntitlement,
} from "../subscriptions";
import {
  backendFeaturesForPlan,
  hasEntitlement,
  planAllowsAi,
  type EntitlementResponse,
} from "@goalrate-app/shared";

describe("launch entitlement matrix", () => {
  it("keeps the Free local-first core usable while locking AI", () => {
    expect(hasEntitlement("free", "localRoadmap")).toBe(true);
    expect(hasEntitlement("free", "localAgenda")).toBe(true);
    expect(hasEntitlement("free", "vaultMarkdownStorage")).toBe(true);
    expect(hasEntitlement("free", "manualGoalsAndTasks")).toBe(true);
    expect(planAllowsAi("free")).toBe(false);
  });

  it("unlocks AI on Plus without shipping post-launch surfaces", () => {
    expect(planAllowsAi("plus")).toBe(true);
    expect(hasEntitlement("plus", "publishing")).toBe(false);
    expect(hasEntitlement("plus", "sync")).toBe(false);
    expect(hasEntitlement("plus", "collaboration")).toBe(false);
  });

  it("treats post-launch tiers as unavailable in the launch entitlement model", () => {
    expect(planAllowsAi("pro")).toBe(false);
    expect(hasEntitlement("pro", "sync")).toBe(false);
    expect(hasEntitlement("premium", "collaboration")).toBe(false);
  });
});

describe("Stripe subscription state mapping", () => {
  it("maps active Stripe subscription states to the paid plan", () => {
    expect(
      subscriptionAllowsAi(
        normalizeSubscriptionStatus({
          plan_id: "plus",
          status: "active",
        }),
      ),
    ).toBe(true);
  });

  it("does not unlock hosted AI for Stripe trials", () => {
    const status = normalizeSubscriptionStatus({
      plan_id: "plus",
      status: "trialing",
    });

    expect(status.planId).toBe("free");
    expect(status.state).toBe("trial");
    expect(subscriptionAllowsAi(status)).toBe(false);
  });

  it("maps expired, canceled, past-due, and missing subscriptions to Free", () => {
    for (const statusText of ["expired", "canceled", "past_due"] as const) {
      const status = normalizeSubscriptionStatus({
        plan_id: "plus",
        status: statusText,
      });
      expect(status.planId).toBe("free");
      expect(subscriptionHasEntitlement(status, "aiAssistant")).toBe(false);
    }

    expect(normalizeSubscriptionStatus(null).planId).toBe("free");
  });

  it("uses cancellation-at-period-end as active until the period ends", () => {
    const status = normalizeSubscriptionStatus({
      plan_id: "plus",
      status: "active",
      cancel_at_period_end: true,
      current_period_end: "2026-05-29T00:00:00Z",
    });

    expect(status.planId).toBe("plus");
    expect(status.state).toBe("activeCanceled");
    expect(status.willRenew).toBe(false);
    expect(subscriptionAllowsAi(status)).toBe(true);
  });

  it("treats Stripe state as authoritative over stale plan ids", () => {
    const status = normalizeSubscriptionStatus({
      plan_id: "plus",
      status: "expired",
    });

    expect(status.planId).toBe("free");
    expect(status.active).toBe(false);
    expect(subscriptionAllowsAi(status)).toBe(false);
  });

  it("does not unlock AI for post-launch tier ids during the Free Plus launch", () => {
    for (const planId of ["pro", "premium"] as const) {
      const status = normalizeSubscriptionStatus({
        plan_id: planId,
        status: "active",
      });

      expect(status.planId).toBe("free");
      expect(status.active).toBe(false);
      expect(subscriptionAllowsAi(status)).toBe(false);
    }
  });
});

describe("backend entitlement response mapping", () => {
  function entitlementResponse(
    planId: "free" | "plus",
    status: "none" | "active" | "trialing" | "past_due",
  ): EntitlementResponse {
    return {
      user: {
        id: "user_1",
        email: "user@example.com",
        name: "Test User",
        avatarUrl: null,
      },
      activeWorkspace: {
        id: "workspace_1",
        name: "Personal",
        type: "personal",
        role: "owner",
      },
      accountEffectivePlan: {
        id: status === "active" ? planId : "free",
        sourceWorkspaceId: status === "active" ? "workspace_1" : null,
        sourceWorkspaceName: status === "active" ? "Personal" : null,
      },
      activeWorkspacePlan: {
        id: planId,
        status,
        source: status === "none" ? "none" : "stripe",
        currentPeriodStartsAt: null,
        currentPeriodEndsAt: null,
        cancelAtPeriodEnd: false,
      },
      activeWorkspaceFeatures: backendFeaturesForPlan(
        status === "active" ? planId : "free",
      ),
      workspaceMemberships: [
        {
          id: "workspace_1",
          name: "Personal",
          type: "personal",
          role: "owner",
          plan: status === "active" ? planId : "free",
        },
      ],
      limits: {
        period: status === "active" ? "subscription_billing_period" : "none",
        aiOperationsIncluded:
          status === "active" && planId === "plus" ? 300 : 0,
        aiOperationsUsed: 0,
      },
      refreshedAt: "2026-05-02T00:00:00.000Z",
    };
  }

  it("uses backend AI feature grants rather than plan name alone", () => {
    const status = normalizeEntitlementStatus(
      entitlementResponse("plus", "active"),
    );

    expect(status.planId).toBe("plus");
    expect(status.active).toBe(true);
    expect(subscriptionAllowsAi(status)).toBe(true);
  });

  it("does not unlock AI when backend features are free for non-active billing", () => {
    for (const stripeState of ["trialing", "past_due"] as const) {
      const status = normalizeEntitlementStatus(
        entitlementResponse("plus", stripeState),
      );

      expect(status.planId).toBe("free");
      expect(status.active).toBe(false);
      expect(subscriptionAllowsAi(status)).toBe(false);
    }
  });
});
