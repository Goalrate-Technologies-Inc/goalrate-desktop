import {
  backendFeatureForEntitlement,
  entitlementsForPlan,
  entitlementResponseAllowsAi,
  entitlementResponseHasFeature,
  normalizeLaunchPlanId,
  planAllowsAi,
  type BillingCycle,
  type EntitlementKey,
  type EntitlementResponse,
  type LaunchPlanId,
  type PlanId,
  type Subscription,
} from "@goalrate-app/shared";
import type { StoredUser } from "../types/auth";
import {
  apiRequest,
  getEntitlements,
  getStoredAccessToken,
  isTauriRuntime,
  openBillingPortalFromBackend,
  openPlusCheckoutFromBackend,
  openWebPlusSignup,
} from "./authBillingEntitlements";

export const PLUS_PLAN_ID = "plus" satisfies LaunchPlanId;

const HAS_CONFIGURED_API_BASE_URL = Boolean(import.meta.env.VITE_API_BASE_URL);

const BILLING_SUCCESS_URL = "https://app.goalrate.com/account/billing/success";
const BILLING_CANCEL_URL = "https://app.goalrate.com/account/billing/cancel";
const BILLING_RETURN_URL = "https://app.goalrate.com/account/billing";

export type SubscriptionState =
  | "none"
  | "active"
  | "activeCanceled"
  | "trial"
  | "gracePeriod"
  | "pastDue"
  | "billingRetry"
  | "canceled"
  | "expired"
  | "revoked"
  | "pending"
  | "unavailable";

export type SubscriptionSource = "stripe" | "none" | "unavailable";

export interface SubscriptionPeriod {
  unit: "day" | "week" | "month" | "year" | "unknown";
  value: number;
  display: string;
}

export interface SubscriptionProduct {
  planId: LaunchPlanId;
  displayName: string;
  description: string;
  displayPrice: string;
  billingCycle: BillingCycle;
  subscriptionPeriod: SubscriptionPeriod | null;
}

export interface BillingSubscriptionStatus {
  planId: LaunchPlanId;
  state: SubscriptionState;
  active: boolean;
  willRenew: boolean | null;
  source: SubscriptionSource;
  expiresAt: string | null;
  checkedAt: string;
  managementUrl: string | null;
  entitlements: EntitlementResponse | null;
}

interface PlanPricingResponse {
  id?: PlanId;
  planId?: PlanId;
  name?: string;
  description?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
}

interface SubscriptionDetailsResponse extends Partial<Subscription> {
  planId?: PlanId;
  plan_id?: PlanId;
  billingCycle?: BillingCycle;
  billing_cycle?: BillingCycle;
  status?: string;
  currentPeriodEnd?: string;
  current_period_end?: string;
  cancelAtPeriodEnd?: boolean;
  cancel_at_period_end?: boolean;
}

interface CheckoutSessionResponse {
  url?: string;
  checkout_url?: string;
  sessionId?: string;
  session_id?: string;
}

interface BillingPortalResponse {
  url?: string;
  portal_url?: string;
}

export const FALLBACK_PLUS_PRODUCT: SubscriptionProduct = {
  planId: PLUS_PLAN_ID,
  displayName: "GoalRate Plus",
  description: "AI planning and Assistant features for GoalRate Desktop.",
  displayPrice: "$15/mo",
  billingCycle: "monthly",
  subscriptionPeriod: {
    unit: "month",
    value: 1,
    display: "Monthly",
  },
};

function priceLabel(value: number | undefined, suffix: string): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return `$${value}/${suffix}`;
}

function fallbackCheckedAt(): string {
  return new Date(0).toISOString();
}

export function defaultFreeSubscriptionStatus(
  overrides: Partial<BillingSubscriptionStatus> = {},
): BillingSubscriptionStatus {
  return {
    planId: "free",
    state: "none",
    active: false,
    willRenew: null,
    source: "none",
    expiresAt: null,
    checkedAt: fallbackCheckedAt(),
    managementUrl: null,
    entitlements: null,
    ...overrides,
  };
}

function normalizeSubscriptionState(
  rawStatus: string | null | undefined,
  cancelAtPeriodEnd: boolean,
): SubscriptionState {
  switch (rawStatus) {
    case "active":
      return cancelAtPeriodEnd ? "activeCanceled" : "active";
    case "trial":
    case "trialing":
      return "trial";
    case "past_due":
    case "pastDue":
    case "unpaid":
      return "pastDue";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "expired":
      return "expired";
    default:
      return "none";
  }
}

function stateIsEntitled(state: SubscriptionState): boolean {
  return (
    state === "active" || state === "activeCanceled" || state === "gracePeriod"
  );
}

export function normalizeSubscriptionStatus(
  subscription: SubscriptionDetailsResponse | null | undefined,
): BillingSubscriptionStatus {
  if (!subscription) {
    return defaultFreeSubscriptionStatus({
      checkedAt: new Date().toISOString(),
    });
  }

  const cancelAtPeriodEnd =
    subscription.cancelAtPeriodEnd ??
    subscription.cancel_at_period_end ??
    false;
  const state = normalizeSubscriptionState(
    subscription.status,
    cancelAtPeriodEnd,
  );
  const rawPlanId = subscription.planId ?? subscription.plan_id;
  const planId = stateIsEntitled(state)
    ? normalizeLaunchPlanId(rawPlanId)
    : "free";

  return defaultFreeSubscriptionStatus({
    planId,
    state,
    active: stateIsEntitled(state) && planAllowsAi(planId),
    willRenew:
      state === "active" || state === "activeCanceled"
        ? !cancelAtPeriodEnd
        : null,
    source: state === "none" ? "none" : "stripe",
    expiresAt:
      subscription.currentPeriodEnd ?? subscription.current_period_end ?? null,
    checkedAt: new Date().toISOString(),
    managementUrl: BILLING_RETURN_URL,
  });
}

export function normalizeEntitlementStatus(
  entitlements: EntitlementResponse,
): BillingSubscriptionStatus {
  const allowsAi = entitlementResponseAllowsAi(entitlements);
  const activePlan = entitlements.activeWorkspacePlan;
  const state = normalizeSubscriptionState(
    activePlan.status,
    activePlan.cancelAtPeriodEnd ?? false,
  );

  return defaultFreeSubscriptionStatus({
    planId: allowsAi ? PLUS_PLAN_ID : "free",
    state,
    active: allowsAi,
    willRenew:
      state === "active" || state === "activeCanceled"
        ? !(activePlan.cancelAtPeriodEnd ?? false)
        : null,
    source:
      activePlan.source === "stripe"
        ? "stripe"
        : activePlan.source === "none"
          ? "none"
          : "unavailable",
    expiresAt: activePlan.currentPeriodEndsAt ?? null,
    checkedAt: entitlements.refreshedAt,
    managementUrl: BILLING_RETURN_URL,
    entitlements,
  });
}

export function subscriptionHasEntitlement(
  status: BillingSubscriptionStatus | null | undefined,
  entitlement: EntitlementKey,
): boolean {
  const backendFeature = backendFeatureForEntitlement(entitlement);
  if (status?.entitlements) {
    return entitlementResponseHasFeature(status.entitlements, backendFeature);
  }

  const planId = status?.active ? status.planId : "free";
  return entitlementsForPlan(planId)[entitlement];
}

export function subscriptionAllowsAi(
  status: BillingSubscriptionStatus | null | undefined,
): boolean {
  return subscriptionHasEntitlement(status, "aiPlanning");
}

export async function getPlusSubscriptionProduct(): Promise<SubscriptionProduct> {
  if (import.meta.env.DEV && !HAS_CONFIGURED_API_BASE_URL) {
    return FALLBACK_PLUS_PRODUCT;
  }

  try {
    const plan = await apiRequest<PlanPricingResponse>("/api/plans/plus");
    const monthlyPrice = priceLabel(plan.monthlyPrice, "mo");

    return {
      ...FALLBACK_PLUS_PRODUCT,
      displayName: plan.name ?? FALLBACK_PLUS_PRODUCT.displayName,
      description: plan.description ?? FALLBACK_PLUS_PRODUCT.description,
      displayPrice: monthlyPrice ?? FALLBACK_PLUS_PRODUCT.displayPrice,
    };
  } catch {
    return FALLBACK_PLUS_PRODUCT;
  }
}

export async function getSubscriptionStatus(): Promise<BillingSubscriptionStatus> {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    return defaultFreeSubscriptionStatus({
      checkedAt: new Date().toISOString(),
    });
  }

  let user: StoredUser | null = null;
  if (isTauriRuntime()) {
    user = await import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<StoredUser | null>("get_stored_user"))
      .catch(() => null);
  }

  try {
    const entitlements = await getEntitlements(accessToken, user);
    return normalizeEntitlementStatus(entitlements);
  } catch {
    // Fall through to the legacy subscription endpoints for older dev servers.
  }

  try {
    const details = await apiRequest<SubscriptionDetailsResponse | null>(
      "/api/subscriptions/me/details",
      { accessToken },
    );
    return normalizeSubscriptionStatus(details);
  } catch {
    const subscription = await apiRequest<SubscriptionDetailsResponse | null>(
      "/api/subscriptions/me",
      { accessToken },
    );
    return normalizeSubscriptionStatus(subscription);
  }
}

export async function openPlusCheckout(
  billingCycle: BillingCycle = "monthly",
): Promise<void> {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    await openWebPlusSignup(billingCycle);
    return;
  }

  try {
    await openPlusCheckoutFromBackend(accessToken, billingCycle);
    return;
  } catch {
    // Fall back to the legacy route while older dev backends are still running.
  }

  const session = await apiRequest<CheckoutSessionResponse>(
    "/api/subscriptions/checkout",
    {
      method: "POST",
      accessToken,
      body: {
        planId: PLUS_PLAN_ID,
        billingCycle,
        successUrl: BILLING_SUCCESS_URL,
        cancelUrl: BILLING_CANCEL_URL,
      },
    },
  );

  const url = session.url ?? session.checkout_url;
  if (!url) {
    throw new Error("GoalRate did not return a Stripe checkout URL.");
  }

  await import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("open_billing_url", { url }),
  );
}

export async function openBillingPortal(): Promise<void> {
  const accessToken = await getStoredAccessToken();
  if (!accessToken) {
    throw new Error("Sign in to manage your GoalRate subscription.");
  }

  try {
    await openBillingPortalFromBackend(accessToken);
    return;
  } catch {
    // Fall back to the legacy route while older dev backends are still running.
  }

  const portal = await apiRequest<BillingPortalResponse>(
    "/api/subscriptions/portal",
    {
      method: "POST",
      accessToken,
      body: {
        returnUrl: BILLING_RETURN_URL,
      },
    },
  );

  const url = portal.url ?? portal.portal_url;
  if (!url) {
    throw new Error("GoalRate did not return a Stripe billing portal URL.");
  }

  await import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("open_billing_url", { url }),
  );
}
