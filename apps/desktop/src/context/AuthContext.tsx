/* eslint-disable react-refresh/only-export-components */
/**
 * Desktop Authentication Context
 *
 * Provides authentication state and methods for the desktop app.
 * Uses OS keychain for secure token storage via Tauri commands.
 *
 * Key differences from web:
 * - Tokens stored in system keychain, not httpOnly cookies
 * - Supports anonymous mode for offline-only usage
 * - Uses Authorization header with Bearer token
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { attachTauriEventListener } from "../lib/tauriEvents";
import {
  clearDesktopAuthState,
  exchangeDesktopAuthCode,
  getEntitlements,
  isTauriRuntime,
  logoutDesktopSession,
  openAuthUrl,
  parseDesktopAuthCallbackUrl,
  readDesktopAuthState,
  refreshDesktopToken,
  startDesktopAuth,
  storeDesktopAuthState,
  type DesktopAuthExchangeResponse,
} from "../lib/authBillingEntitlements";
import type {
  DesktopAuthContextValue,
  DesktopAuthState,
  StoredTokens,
  StoredUser,
  TokenRefreshResponse,
} from "../types/auth";

/**
 * Default auth state
 */
const defaultAuthState: DesktopAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  mode: "anonymous",
  isOnline: navigator.onLine,
  entitlements: null,
};

/**
 * Auth context
 */
const AuthContext = createContext<DesktopAuthContextValue | null>(null);

/**
 * Props for AuthProvider
 */
export interface AuthProviderProps {
  children: ReactNode;
}

async function refreshAuthInternal(refreshToken: string): Promise<boolean> {
  try {
    const data: TokenRefreshResponse = await refreshDesktopToken(refreshToken);

    // Calculate expiration timestamp
    const expiresAt = Date.now() + data.expires_in * 1000;

    // Update tokens in keychain
    await invoke("update_tokens", {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    });

    return true;
  } catch (error) {
    console.error("[Auth] Token refresh error:", error);
    return false;
  }
}

async function storeAuthenticatedSession(
  session: DesktopAuthExchangeResponse,
): Promise<StoredUser> {
  const user: StoredUser = {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    username: session.user.username,
    avatarUrl: session.user.avatarUrl,
  };
  const expiresAt = Date.now() + session.expires_in * 1000;

  await invoke("store_tokens", {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: user.id,
    expiresAt,
    user,
  });

  return user;
}

async function loadStoredEntitlements(
  accessToken: string,
  user: StoredUser | null,
): Promise<DesktopAuthState["entitlements"]> {
  try {
    return await getEntitlements(accessToken, user);
  } catch (error) {
    console.warn("[Auth] Failed to load entitlements:", error);
    return null;
  }
}

/**
 * AuthProvider component
 *
 * Wraps the app with authentication state management.
 * On mount, checks for existing tokens in the keychain.
 */
export function AuthProvider({
  children,
}: AuthProviderProps): React.ReactElement {
  const [state, setState] = useState<DesktopAuthState>(defaultAuthState);

  // Track online status
  useEffect(() => {
    const handleOnline = (): void => {
      setState((prev) => ({ ...prev, isOnline: true }));
    };
    const handleOffline = (): void => {
      setState((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  /**
   * Initialize auth state on mount
   */
  useEffect(() => {
    const initAuth = async (): Promise<void> => {
      // If running outside Tauri (e.g. plain browser), skip keychain access
      if (!isTauriRuntime()) {
        setState({
          ...defaultAuthState,
          isLoading: false,
          mode: "anonymous",
        });
        return;
      }
      try {
        // Check for existing tokens in keychain
        let tokens = await invoke<StoredTokens | null>("get_tokens");
        const user = await invoke<StoredUser | null>("get_stored_user");

        if (tokens && user) {
          // Check if tokens are still valid
          const now = Date.now();
          const isExpired = tokens.expiresAt <= now;

          if (isExpired) {
            // Try to refresh the token
            const refreshed = await refreshAuthInternal(tokens.refreshToken);
            if (!refreshed) {
              // Token refresh failed, clear tokens and go to anonymous mode
              await invoke("clear_tokens");
              clearDesktopAuthState();
              setState({
                ...defaultAuthState,
                isLoading: false,
                mode: "anonymous",
              });
              return;
            }
            tokens = await invoke<StoredTokens | null>("get_tokens");
          }

          const entitlements = tokens?.accessToken
            ? await loadStoredEntitlements(tokens.accessToken, user)
            : null;

          // Tokens are valid
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            mode: "authenticated",
            isOnline: navigator.onLine,
            entitlements,
          });
        } else {
          // No tokens, anonymous mode
          setState({
            ...defaultAuthState,
            isLoading: false,
            mode: "anonymous",
          });
        }
      } catch (error) {
        console.error("[Auth] Failed to initialize auth:", error);
        setState({
          ...defaultAuthState,
          isLoading: false,
          error: "Failed to load authentication state",
        });
      }
    };

    initAuth();
  }, []);

  /**
   * Start hosted browser sign-in.
   */
  const startSignIn = useCallback(
    async (screenHint: "sign-in" | "sign-up" = "sign-in"): Promise<void> => {
      if (!navigator.onLine) {
        const message = "Sign in requires an internet connection.";
        setState((prev) => ({ ...prev, error: message, isLoading: false }));
        throw new Error(message);
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        error: null,
        mode: "authenticating",
      }));

      try {
        const authStart = await startDesktopAuth(screenHint);
        const authUrl =
          authStart.authorizationUrl ??
          authStart.authorization_url ??
          authStart.authUrl ??
          authStart.auth_url;

        if (!authUrl || !authStart.state) {
          throw new Error("GoalRate could not start browser sign-in.");
        }

        storeDesktopAuthState(authStart.state);
        await openAuthUrl(authUrl);

        setState((prev) => ({
          ...prev,
          isAuthenticated: false,
          isLoading: false,
          error: null,
          mode: "authenticating",
        }));
      } catch (error) {
        clearDesktopAuthState();
        const message =
          error instanceof Error ? error.message : "Sign in failed";
        console.error("[Auth] Failed to start browser sign-in:", error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
          mode: prev.isAuthenticated ? "authenticated" : "anonymous",
        }));
        throw error;
      }
    },
    [],
  );

  /**
   * Complete hosted browser sign-in from a deep link callback.
   */
  const handleAuthCallback = useCallback(
    async (callbackUrl: string): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const expectedState = readDesktopAuthState();
        const { code, state: verifiedState } = parseDesktopAuthCallbackUrl(
          callbackUrl,
          expectedState,
        );
        const session = await exchangeDesktopAuthCode(code, verifiedState);
        const user = await storeAuthenticatedSession(session);

        clearDesktopAuthState();
        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
          mode: "authenticated",
          isOnline: navigator.onLine,
          entitlements: session.entitlements,
        });

        console.warn("[Auth] Browser sign-in completed for:", user.email);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Sign in failed";
        console.error("[Auth] Browser sign-in callback error:", message);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }));
        throw error;
      }
    },
    [],
  );

  /**
   * Listen for native deep link callbacks while the app is running.
   */
  useEffect(() => {
    if (!isTauriRuntime()) {
      return undefined;
    }

    return attachTauriEventListener<string>(
      "auth-callback-url",
      (event) => {
        const callbackUrl = event.payload;
        if (typeof callbackUrl === "string") {
          void handleAuthCallback(callbackUrl).catch((error) => {
            console.warn("[Auth] Auth callback handling failed:", error);
          });
        }
      },
      {
        onError: (error) => {
          console.warn(
            "[Auth] Failed to attach auth callback listener:",
            error,
          );
        },
      },
    );
  }, [handleAuthCallback]);

  /**
   * Backwards-compatible login entry point. Hosted auth owns credentials.
   */
  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      void email;
      void password;
      await startSignIn("sign-in");
    },
    [startSignIn],
  );

  /**
   * Backwards-compatible register entry point. Hosted auth owns account creation.
   */
  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      username: string,
    ): Promise<void> => {
      void email;
      void password;
      void displayName;
      void username;
      await startSignIn("sign-up");
    },
    [startSignIn],
  );

  /**
   * Log out and return to anonymous mode
   */
  const logout = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Get current tokens to call logout endpoint
      const tokens = await invoke<StoredTokens | null>("get_tokens");

      if (tokens && navigator.onLine) {
        // Call logout endpoint (best effort, ignore failures)
        try {
          await logoutDesktopSession(tokens.accessToken, tokens.refreshToken);
        } catch (error) {
          console.warn(
            "[Auth] Logout API call failed (continuing anyway):",
            error,
          );
        }
      }

      // Clear tokens from keychain
      await invoke("clear_tokens");
      clearDesktopAuthState();

      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        mode: "anonymous",
        isOnline: navigator.onLine,
        entitlements: null,
      });

      console.warn("[Auth] Logout successful");
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      // Still clear local state even if keychain clear fails
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        mode: "anonymous",
        isOnline: navigator.onLine,
        entitlements: null,
      });
    }
  }, []);

  /**
   * Continue using the app without logging in
   */
  const continueWithoutLogin = useCallback((): void => {
    clearDesktopAuthState();
    setState((prev) => ({
      ...prev,
      mode: "anonymous",
      isLoading: false,
      error: null,
      entitlements: null,
    }));
    console.warn("[Auth] Continuing in anonymous mode");
  }, []);

  /**
   * Refresh backend-owned entitlements.
   */
  const refreshEntitlements = useCallback(async (): Promise<void> => {
    if (!isTauriRuntime()) {
      setState((prev) => ({ ...prev, entitlements: null }));
      return;
    }

    try {
      const tokens = await invoke<StoredTokens | null>("get_tokens");
      const user = await invoke<StoredUser | null>("get_stored_user");

      if (!tokens) {
        setState((prev) => ({ ...prev, entitlements: null }));
        return;
      }

      const entitlements = await getEntitlements(tokens.accessToken, user);
      setState((prev) => ({ ...prev, entitlements, error: null }));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to refresh entitlements";
      console.warn("[Auth] Entitlement refresh failed:", error);
      setState((prev) => ({ ...prev, error: message }));
      throw error;
    }
  }, []);

  /**
   * Refresh the access token
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const tokens = await invoke<StoredTokens | null>("get_tokens");
      if (!tokens) {
        return false;
      }

      const refreshed = await refreshAuthInternal(tokens.refreshToken);
      if (refreshed) {
        await refreshEntitlements().catch((error) => {
          console.warn(
            "[Auth] Entitlements did not refresh after token refresh:",
            error,
          );
        });
      }
      return refreshed;
    } catch (error) {
      console.error("[Auth] Refresh auth error:", error);
      return false;
    }
  }, [refreshEntitlements]);

  /**
   * Clear any error message
   */
  const clearError = useCallback((): void => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  const value: DesktopAuthContextValue = {
    ...state,
    login,
    register,
    logout,
    continueWithoutLogin,
    refreshAuth,
    startSignIn,
    handleAuthCallback,
    refreshEntitlements,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access authentication state and methods
 *
 * @throws Error if used outside of AuthProvider
 */
export function useAuth(): DesktopAuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/**
 * Export context for advanced use cases
 */
export { AuthContext };
