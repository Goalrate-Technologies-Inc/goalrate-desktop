import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { entitlementsForPlan, type EntitlementKey } from "@goalrate-app/shared";
import {
  FALLBACK_PLUS_PRODUCT,
  defaultFreeSubscriptionStatus,
  getPlusSubscriptionProduct,
  getSubscriptionStatus,
  normalizeEntitlementStatus,
  openBillingPortal,
  openPlusCheckout,
  subscriptionAllowsAi,
  subscriptionHasEntitlement,
  type BillingSubscriptionStatus,
  type SubscriptionProduct,
} from "../lib/subscriptions";
import { useAuth } from "./AuthContext";

interface SubscriptionContextValue {
  status: BillingSubscriptionStatus;
  product: SubscriptionProduct;
  isLoading: boolean;
  isPurchasing: boolean;
  isManaging: boolean;
  isAwaitingCheckoutAuth: boolean;
  error: string | null;
  allowsAi: boolean;
  hasEntitlement: (entitlement: EntitlementKey) => boolean;
  refresh: () => Promise<void>;
  startPlusCheckout: () => Promise<void>;
  manageBilling: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(
  null,
);

const fallbackSubscriptionContext: SubscriptionContextValue = {
  status: defaultFreeSubscriptionStatus(),
  product: FALLBACK_PLUS_PRODUCT,
  isLoading: false,
  isPurchasing: false,
  isManaging: false,
  isAwaitingCheckoutAuth: false,
  error: null,
  allowsAi: false,
  hasEntitlement: (entitlement) => entitlementsForPlan("free")[entitlement],
  refresh: async () => {},
  startPlusCheckout: async () => {},
  manageBilling: async () => {},
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") {
      return obj.message;
    }
  }
  return "Unable to load subscription information.";
}

export function SubscriptionProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const { isAuthenticated, mode, entitlements } = useAuth();
  const [status, setStatus] = useState<BillingSubscriptionStatus>(() =>
    defaultFreeSubscriptionStatus(),
  );
  const [product, setProduct] = useState<SubscriptionProduct>(
    FALLBACK_PLUS_PRODUCT,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isManaging, setIsManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime()) {
      setStatus(defaultFreeSubscriptionStatus());
      setProduct(FALLBACK_PLUS_PRODUCT);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const [nextProduct, nextStatus] = await Promise.all([
        getPlusSubscriptionProduct().catch(() => FALLBACK_PLUS_PRODUCT),
        getSubscriptionStatus(),
      ]);
      setProduct(nextProduct);
      setStatus(nextStatus);
    } catch (err) {
      setError(errorMessage(err));
      setStatus(defaultFreeSubscriptionStatus({ state: "unavailable" }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refresh();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh, isAuthenticated, mode]);

  const effectiveStatus = useMemo(() => {
    if (entitlements) {
      return normalizeEntitlementStatus(entitlements);
    }
    if (!isAuthenticated) {
      return defaultFreeSubscriptionStatus();
    }
    return status;
  }, [entitlements, isAuthenticated, status]);

  const startPlusCheckout = useCallback(async () => {
    setIsPurchasing(true);
    setError(null);
    try {
      await openPlusCheckout("monthly");
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsPurchasing(false);
    }
  }, [refresh]);

  const manageBilling = useCallback(async () => {
    setIsManaging(true);
    setError(null);
    try {
      await openBillingPortal();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsManaging(false);
    }
  }, [refresh]);

  const value = useMemo<SubscriptionContextValue>(() => {
    const entitlements = entitlementsForPlan(effectiveStatus.planId);
    return {
      status: effectiveStatus,
      product,
      isLoading,
      isPurchasing,
      isManaging,
      isAwaitingCheckoutAuth: false,
      error,
      allowsAi: subscriptionAllowsAi(effectiveStatus),
      hasEntitlement: (entitlement) =>
        entitlements[entitlement] ||
        subscriptionHasEntitlement(effectiveStatus, entitlement),
      refresh,
      startPlusCheckout,
      manageBilling,
    };
  }, [
    effectiveStatus,
    product,
    isLoading,
    isPurchasing,
    isManaging,
    error,
    refresh,
    startPlusCheckout,
    manageBilling,
  ]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSubscription(): SubscriptionContextValue {
  const context = useContext(SubscriptionContext);
  return context ?? fallbackSubscriptionContext;
}
