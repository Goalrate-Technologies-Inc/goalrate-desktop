import type { PlanId } from "./user";

export type LaunchPlanId = Extract<PlanId, "free" | "plus">;

export type EntitlementKey =
  | "localRoadmap"
  | "localAgenda"
  | "vaultMarkdownStorage"
  | "manualGoalsAndTasks"
  | "vaultRecovery"
  | "aiPlanning"
  | "aiAssistant"
  | "aiTaskBreakdown"
  | "aiMemory"
  | "publishing"
  | "sync"
  | "collaboration";

export type BackendFeatureKey =
  | "local.roadmap"
  | "local.agenda"
  | "local.vault.markdown_storage"
  | "local.goals_tasks.manual"
  | "local.vault.recovery"
  | "ai.agenda.generate"
  | "ai.assistant.chat"
  | "ai.task.breakdown"
  | "ai.memory.context"
  | "sync.devices"
  | "publishing.basic"
  | "publishing.advanced"
  | "publishing.analytics"
  | "collaboration.workspaces"
  | "collaboration.roles"
  | "billing.seat_management"
  | "auth.sso";

export type EntitlementMatrix = Record<
  LaunchPlanId,
  Readonly<Record<EntitlementKey, boolean>>
>;

export type BackendFeatureMatrix = Record<
  PlanId,
  Readonly<Record<BackendFeatureKey, boolean>>
>;

export type WorkspaceType = "personal" | "team";

export type WorkspaceMemberRole = "owner" | "admin" | "member";

export type EntitlementPlanStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "expired"
  | "none";

export type EntitlementPlanSource = "stripe" | "app_store" | "workos" | "none";

export interface EntitlementUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export interface EntitlementWorkspace {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceMemberRole;
}

export interface EntitlementEffectivePlan {
  id: PlanId;
  sourceWorkspaceId?: string | null;
  sourceWorkspaceName?: string | null;
}

export interface EntitlementWorkspacePlan {
  id: PlanId;
  status: EntitlementPlanStatus;
  source: EntitlementPlanSource;
  currentPeriodStartsAt?: string | null;
  currentPeriodEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export type WorkspaceFeatureMap = Readonly<Record<BackendFeatureKey, boolean>>;

export interface EntitlementWorkspaceMembership {
  id: string;
  name: string;
  type: WorkspaceType;
  role: WorkspaceMemberRole;
  plan: PlanId;
}

export interface EntitlementLimits {
  period: "subscription_billing_period" | "none";
  periodStartsAt?: string | null;
  periodEndsAt?: string | null;
  aiOperationsIncluded?: number | null;
  aiOperationsUsed?: number;
}

export interface EntitlementResponse {
  user: EntitlementUser;
  activeWorkspace: EntitlementWorkspace;
  accountEffectivePlan: EntitlementEffectivePlan;
  activeWorkspacePlan: EntitlementWorkspacePlan;
  activeWorkspaceFeatures: WorkspaceFeatureMap;
  workspaceMemberships: EntitlementWorkspaceMembership[];
  limits: EntitlementLimits;
  refreshedAt: string;
}

export const LAUNCH_PLANS = [
  "free",
  "plus",
] as const satisfies readonly LaunchPlanId[];

export const PLAN_ENTITLEMENTS = {
  free: {
    localRoadmap: true,
    localAgenda: true,
    vaultMarkdownStorage: true,
    manualGoalsAndTasks: true,
    vaultRecovery: true,
    aiPlanning: false,
    aiAssistant: false,
    aiTaskBreakdown: false,
    aiMemory: false,
    publishing: false,
    sync: false,
    collaboration: false,
  },
  plus: {
    localRoadmap: true,
    localAgenda: true,
    vaultMarkdownStorage: true,
    manualGoalsAndTasks: true,
    vaultRecovery: true,
    aiPlanning: true,
    aiAssistant: true,
    aiTaskBreakdown: true,
    aiMemory: true,
    publishing: false,
    sync: false,
    collaboration: false,
  },
} as const satisfies EntitlementMatrix;

export const BACKEND_FEATURES = [
  "local.roadmap",
  "local.agenda",
  "local.vault.markdown_storage",
  "local.goals_tasks.manual",
  "local.vault.recovery",
  "ai.agenda.generate",
  "ai.assistant.chat",
  "ai.task.breakdown",
  "ai.memory.context",
  "sync.devices",
  "publishing.basic",
  "publishing.advanced",
  "publishing.analytics",
  "collaboration.workspaces",
  "collaboration.roles",
  "billing.seat_management",
  "auth.sso",
] as const satisfies readonly BackendFeatureKey[];

const FREE_BACKEND_FEATURES = {
  "local.roadmap": true,
  "local.agenda": true,
  "local.vault.markdown_storage": true,
  "local.goals_tasks.manual": true,
  "local.vault.recovery": true,
  "ai.agenda.generate": false,
  "ai.assistant.chat": false,
  "ai.task.breakdown": false,
  "ai.memory.context": false,
  "sync.devices": false,
  "publishing.basic": false,
  "publishing.advanced": false,
  "publishing.analytics": false,
  "collaboration.workspaces": false,
  "collaboration.roles": false,
  "billing.seat_management": false,
  "auth.sso": false,
} as const satisfies Readonly<Record<BackendFeatureKey, boolean>>;

const PLUS_BACKEND_FEATURES = {
  ...FREE_BACKEND_FEATURES,
  "ai.agenda.generate": true,
  "ai.assistant.chat": true,
  "ai.task.breakdown": true,
  "ai.memory.context": true,
} as const satisfies Readonly<Record<BackendFeatureKey, boolean>>;

export const PLAN_BACKEND_FEATURES = {
  free: FREE_BACKEND_FEATURES,
  plus: PLUS_BACKEND_FEATURES,
  pro: PLUS_BACKEND_FEATURES,
  premium: PLUS_BACKEND_FEATURES,
} as const satisfies BackendFeatureMatrix;

export const ENTITLEMENT_FEATURE_KEYS = {
  localRoadmap: "local.roadmap",
  localAgenda: "local.agenda",
  vaultMarkdownStorage: "local.vault.markdown_storage",
  manualGoalsAndTasks: "local.goals_tasks.manual",
  vaultRecovery: "local.vault.recovery",
  aiPlanning: "ai.agenda.generate",
  aiAssistant: "ai.assistant.chat",
  aiTaskBreakdown: "ai.task.breakdown",
  aiMemory: "ai.memory.context",
  publishing: "publishing.basic",
  sync: "sync.devices",
  collaboration: "collaboration.workspaces",
} as const satisfies Readonly<Record<EntitlementKey, BackendFeatureKey>>;

export const APP_STORE_LAUNCH_PLANS = LAUNCH_PLANS;
export const APP_STORE_LAUNCH_ENTITLEMENTS = PLAN_ENTITLEMENTS;

export function isPlanId(
  planId: PlanId | string | null | undefined,
): planId is PlanId {
  return (
    planId === "free" ||
    planId === "plus" ||
    planId === "pro" ||
    planId === "premium"
  );
}

export function normalizePlanId(
  planId: PlanId | string | null | undefined,
): PlanId {
  return isPlanId(planId) ? planId : "free";
}

export function isLaunchPlanId(
  planId: PlanId | string | null | undefined,
): planId is LaunchPlanId {
  return planId === "free" || planId === "plus";
}

export function normalizeLaunchPlanId(
  planId: PlanId | string | null | undefined,
): LaunchPlanId {
  return isLaunchPlanId(planId) ? planId : "free";
}

export function entitlementsForPlan(
  planId: PlanId | string | null | undefined,
): Readonly<Record<EntitlementKey, boolean>> {
  return PLAN_ENTITLEMENTS[normalizeLaunchPlanId(planId)];
}

export function hasEntitlement(
  planId: PlanId | string | null | undefined,
  entitlement: EntitlementKey,
): boolean {
  return entitlementsForPlan(planId)[entitlement];
}

export function planAllowsAi(
  planId: PlanId | string | null | undefined,
): boolean {
  const entitlements = entitlementsForPlan(planId);
  return (
    entitlements.aiPlanning &&
    entitlements.aiAssistant &&
    entitlements.aiTaskBreakdown &&
    entitlements.aiMemory
  );
}

export function backendFeaturesForPlan(
  planId: PlanId | string | null | undefined,
): WorkspaceFeatureMap {
  return PLAN_BACKEND_FEATURES[normalizePlanId(planId)];
}

export function backendFeatureForEntitlement(
  entitlement: EntitlementKey,
): BackendFeatureKey {
  return ENTITLEMENT_FEATURE_KEYS[entitlement];
}

export function planHasBackendFeature(
  planId: PlanId | string | null | undefined,
  feature: BackendFeatureKey,
): boolean {
  return backendFeaturesForPlan(planId)[feature];
}

export function entitlementResponseHasFeature(
  entitlements: EntitlementResponse | null | undefined,
  feature: BackendFeatureKey,
): boolean {
  return Boolean(entitlements?.activeWorkspaceFeatures?.[feature]);
}

export function entitlementResponseAllowsAi(
  entitlements: EntitlementResponse | null | undefined,
): boolean {
  return (
    entitlementResponseHasFeature(entitlements, "ai.agenda.generate") &&
    entitlementResponseHasFeature(entitlements, "ai.assistant.chat") &&
    entitlementResponseHasFeature(entitlements, "ai.task.breakdown") &&
    entitlementResponseHasFeature(entitlements, "ai.memory.context")
  );
}

export function entitlementPlanLabel(
  entitlements: EntitlementResponse | null | undefined,
): string {
  const planId = entitlements?.accountEffectivePlan.id ?? "free";
  const title = planId.charAt(0).toUpperCase() + planId.slice(1);
  const source = entitlements?.accountEffectivePlan.sourceWorkspaceName;
  return source && planId !== entitlements?.activeWorkspacePlan.id
    ? `${title} via ${source}`
    : title;
}
