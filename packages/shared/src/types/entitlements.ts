import type { PlanId } from './user';

export type LaunchPlanId = Extract<PlanId, 'free' | 'plus'>;

export type EntitlementKey =
  | 'localRoadmap'
  | 'localAgenda'
  | 'vaultMarkdownStorage'
  | 'manualGoalsAndTasks'
  | 'vaultRecovery'
  | 'aiPlanning'
  | 'aiAssistant'
  | 'aiTaskBreakdown'
  | 'aiMemory'
  | 'publishing'
  | 'sync'
  | 'collaboration';

export type EntitlementMatrix = Record<
  LaunchPlanId,
  Readonly<Record<EntitlementKey, boolean>>
>;

export const LAUNCH_PLANS = ['free', 'plus'] as const satisfies readonly LaunchPlanId[];

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

export const APP_STORE_LAUNCH_PLANS = LAUNCH_PLANS;
export const APP_STORE_LAUNCH_ENTITLEMENTS = PLAN_ENTITLEMENTS;

export function isLaunchPlanId(planId: PlanId | string | null | undefined): planId is LaunchPlanId {
  return planId === 'free' || planId === 'plus';
}

export function normalizeLaunchPlanId(planId: PlanId | string | null | undefined): LaunchPlanId {
  return isLaunchPlanId(planId) ? planId : 'free';
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

export function planAllowsAi(planId: PlanId | string | null | undefined): boolean {
  const entitlements = entitlementsForPlan(planId);
  return (
    entitlements.aiPlanning &&
    entitlements.aiAssistant &&
    entitlements.aiTaskBreakdown &&
    entitlements.aiMemory
  );
}
