import { invoke } from "@tauri-apps/api/core";
import {
  backendFeaturesForPlan,
  entitlementResponseAllowsAi,
  normalizePlanId,
  type BackendFeatureKey,
  type BillingCycle,
  type EntitlementResponse,
  type EntitlementWorkspaceMembership,
  type LaunchPlanId,
  type PlanId,
} from "@goalrate-app/shared";
import type {
  StoredTokens,
  StoredUser,
  TokenRefreshResponse,
} from "../types/auth";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "http://localhost:8000" : "https://api.goalrate.com");
const WEB_APP_BASE_URL =
  import.meta.env.VITE_WEB_APP_URL ||
  (import.meta.env.DEV ? "http://localhost:5173" : "https://app.goalrate.com");
const STAGING_API_SECRET = import.meta.env.VITE_STAGING_API_SECRET;

export const DESKTOP_AUTH_STATE_STORAGE_KEY = "goalrate.desktopAuth.state";

export interface DesktopAuthStartResponse {
  authorizationUrl?: string;
  authorization_url?: string;
  authUrl?: string;
  auth_url?: string;
  state: string;
  expiresAt?: string;
  expires_at?: string;
}

export interface DesktopAuthExchangeResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: StoredUser;
  entitlements: EntitlementResponse;
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

interface LegacySubscriptionResponse {
  subscription?: {
    plan_id?: PlanId;
    planId?: PlanId;
    status?: string;
    billing_cycle?: BillingCycle;
    current_period_end?: string | null;
    currentPeriodEnd?: string | null;
    cancel_at_period_end?: boolean;
    cancelAtPeriodEnd?: boolean;
  } | null;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function apiUrl(path: string): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function webAppUrl(path: string): string {
  const base = WEB_APP_BASE_URL.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function authHeader(
  accessToken: string | null | undefined,
): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

function stagingHeader(url: string): Record<string, string> {
  if (!STAGING_API_SECRET) {
    return {};
  }

  try {
    const requestUrl = new URL(url);
    const baseUrl = new URL(API_BASE_URL);
    return requestUrl.origin === baseUrl.origin
      ? { "X-Staging-Secret": STAGING_API_SECRET }
      : {};
  } catch {
    return {};
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST";
    accessToken?: string | null;
    body?: unknown;
  } = {},
): Promise<T> {
  const url = apiUrl(path);
  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...stagingHeader(url),
        ...authHeader(options.accessToken),
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(
      `Unable to reach the GoalRate API at ${API_BASE_URL}. Start the local API or set VITE_API_BASE_URL. (${reason})`,
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  const text = await response.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { message: text };
        }
      })()
    : null;

  if (!response.ok) {
    const message =
      typeof data?.detail === "string"
        ? data.detail
        : typeof data?.message === "string"
          ? data.message
          : `GoalRate request failed (${response.status}).`;
    throw new Error(message);
  }

  return data as T;
}

export async function getStoredAccessToken(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const tokens = await invoke<StoredTokens | null>("get_tokens");
  return tokens?.accessToken ?? null;
}

export function storeDesktopAuthState(state: string): void {
  window.localStorage.setItem(DESKTOP_AUTH_STATE_STORAGE_KEY, state);
}

export function readDesktopAuthState(): string | null {
  return window.localStorage.getItem(DESKTOP_AUTH_STATE_STORAGE_KEY);
}

export function clearDesktopAuthState(): void {
  window.localStorage.removeItem(DESKTOP_AUTH_STATE_STORAGE_KEY);
}

export function parseDesktopAuthCallbackUrl(
  callbackUrl: string,
  expectedState: string | null,
): { code: string; state: string } {
  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new Error("GoalRate received a malformed sign-in callback.");
  }

  const isGoalRateCallback =
    parsed.protocol === "goalrate:" &&
    parsed.hostname === "auth" &&
    parsed.pathname === "/callback";

  if (!isGoalRateCallback) {
    throw new Error("GoalRate received an unexpected sign-in callback.");
  }

  const error = parsed.searchParams.get("error");
  if (error) {
    const description = parsed.searchParams.get("error_description");
    throw new Error(description || `GoalRate sign-in failed: ${error}`);
  }

  const state = parsed.searchParams.get("state");
  if (!state || state !== expectedState) {
    throw new Error(
      "GoalRate could not verify the sign-in state. Please try again.",
    );
  }

  const code = parsed.searchParams.get("code");
  if (!code || !/^[A-Za-z0-9._~-]{16,512}$/.test(code)) {
    throw new Error("GoalRate received an invalid sign-in exchange code.");
  }

  return { code, state };
}

export async function startDesktopAuth(
  screenHint: "sign-in" | "sign-up" = "sign-in",
): Promise<DesktopAuthStartResponse> {
  return apiRequest<DesktopAuthStartResponse>("/auth/desktop/start", {
    method: "POST",
    body: {
      callbackUri: "goalrate://auth/callback",
      screenHint,
      device: {
        name: navigator.platform || "GoalRate Desktop",
        userAgent: navigator.userAgent,
      },
    },
  });
}

export async function exchangeDesktopAuthCode(
  code: string,
  state: string,
): Promise<DesktopAuthExchangeResponse> {
  return apiRequest<DesktopAuthExchangeResponse>("/auth/desktop/exchange", {
    method: "POST",
    body: {
      code,
      state,
      device: {
        name: navigator.platform || "GoalRate Desktop",
        userAgent: navigator.userAgent,
      },
    },
  });
}

export async function refreshDesktopToken(
  refreshToken: string,
): Promise<TokenRefreshResponse> {
  return apiRequest<TokenRefreshResponse>("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export async function logoutDesktopSession(
  accessToken: string | null,
  refreshToken: string | null,
): Promise<void> {
  await apiRequest<void>("/auth/logout", {
    method: "POST",
    accessToken,
    body: refreshToken ? { refresh_token: refreshToken } : undefined,
  });
}

function normalizeFeatureMap(
  features: Partial<Record<BackendFeatureKey, boolean>> | undefined,
  planId: PlanId,
): Readonly<Record<BackendFeatureKey, boolean>> {
  return {
    ...backendFeaturesForPlan(planId),
    ...(features ?? {}),
  };
}

function legacyEntitlementsFromSubscription(
  subscription: LegacySubscriptionResponse | null,
  user: StoredUser | null,
): EntitlementResponse {
  const rawSubscription = subscription?.subscription ?? null;
  const rawPlanId = rawSubscription?.plan_id ?? rawSubscription?.planId;
  const status = rawSubscription?.status === "active" ? "active" : "none";
  const planId = status === "active" ? normalizePlanId(rawPlanId) : "free";
  const workspaceName = "Personal Workspace";
  const workspaceId = user?.id ? `personal_${user.id}` : "personal_local";
  const member: EntitlementWorkspaceMembership = {
    id: workspaceId,
    name: workspaceName,
    type: "personal",
    role: "owner",
    plan: planId,
  };

  return {
    user: {
      id: user?.id ?? "anonymous",
      email: user?.email ?? "",
      name: user?.displayName ?? "GoalRate User",
      avatarUrl: user?.avatarUrl ?? null,
    },
    activeWorkspace: {
      id: workspaceId,
      name: workspaceName,
      type: "personal",
      role: "owner",
    },
    accountEffectivePlan: {
      id: planId,
      sourceWorkspaceId: workspaceId,
      sourceWorkspaceName: workspaceName,
    },
    activeWorkspacePlan: {
      id: planId,
      status,
      source: planId === "free" ? "none" : "stripe",
      currentPeriodEndsAt:
        rawSubscription?.current_period_end ??
        rawSubscription?.currentPeriodEnd ??
        null,
      cancelAtPeriodEnd:
        rawSubscription?.cancel_at_period_end ??
        rawSubscription?.cancelAtPeriodEnd ??
        false,
    },
    activeWorkspaceFeatures: normalizeFeatureMap(undefined, planId),
    workspaceMemberships: [member],
    limits: {
      period: planId === "free" ? "none" : "subscription_billing_period",
      periodEndsAt:
        rawSubscription?.current_period_end ??
        rawSubscription?.currentPeriodEnd ??
        null,
      aiOperationsIncluded: entitlementResponseAllowsAi({
        activeWorkspaceFeatures: normalizeFeatureMap(undefined, planId),
      } as EntitlementResponse)
        ? 300
        : 0,
      aiOperationsUsed: 0,
    },
    refreshedAt: new Date().toISOString(),
  };
}

export async function getEntitlements(
  accessToken: string,
  storedUser: StoredUser | null = null,
): Promise<EntitlementResponse> {
  try {
    return await apiRequest<EntitlementResponse>("/entitlements", {
      accessToken,
    });
  } catch {
    try {
      return await apiRequest<EntitlementResponse>("/me", { accessToken });
    } catch {
      const legacy = await apiRequest<LegacySubscriptionResponse | null>(
        "/api/subscriptions/me",
        { accessToken },
      );
      return legacyEntitlementsFromSubscription(legacy, storedUser);
    }
  }
}

export async function openAuthUrl(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.location.assign(url);
    return;
  }

  await invoke("open_auth_url", { url });
}

export async function openWebPlusSignup(
  billingCycle: BillingCycle = "monthly",
): Promise<void> {
  const url = webAppUrl(`/register?plan=plus&billing=${billingCycle}`);
  await openAuthUrl(url);
}

export async function openPlusCheckoutFromBackend(
  accessToken: string,
  billingCycle: BillingCycle = "monthly",
): Promise<void> {
  const session = await apiRequest<CheckoutSessionResponse>(
    "/billing/checkout",
    {
      method: "POST",
      accessToken,
      body: {
        plan: "plus" satisfies LaunchPlanId,
        planId: "plus" satisfies LaunchPlanId,
        billingCycle,
        successUrl: "https://app.goalrate.com/account/billing/success",
        cancelUrl: "https://app.goalrate.com/account/billing/cancel",
      },
    },
  );

  const url = session.url ?? session.checkout_url;
  if (!url) {
    throw new Error("GoalRate did not return a Stripe checkout URL.");
  }

  await invoke("open_billing_url", { url });
}

export async function openBillingPortalFromBackend(
  accessToken: string,
): Promise<void> {
  const portal = await apiRequest<BillingPortalResponse>("/billing/portal", {
    method: "POST",
    accessToken,
    body: {
      returnUrl: "https://app.goalrate.com/account/billing",
    },
  });

  const url = portal.url ?? portal.portal_url;
  if (!url) {
    throw new Error("GoalRate did not return a Stripe billing portal URL.");
  }

  await invoke("open_billing_url", { url });
}
