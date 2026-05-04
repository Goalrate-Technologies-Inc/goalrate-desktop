/**
 * Desktop Authentication Types
 *
 * These types are specific to the desktop app's offline-first authentication model.
 */

import type { EntitlementResponse } from "@goalrate-app/shared";

/**
 * Stored tokens in the system keychain
 */
export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * User data stored alongside tokens
 */
export interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  username?: string;
  avatarUrl?: string;
}

/**
 * Authentication mode
 * - anonymous: Using the app without logging in (local vaults only)
 * - authenticating: Browser sign-in has been started and is waiting for callback
 * - authenticated: Logged in with valid tokens (can sync with server)
 */
export type AuthMode = "anonymous" | "authenticating" | "authenticated";

/**
 * Desktop authentication state
 */
export interface DesktopAuthState {
  /** Current user, null if anonymous */
  user: StoredUser | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether an auth operation is in progress */
  isLoading: boolean;
  /** Current error message, if any */
  error: string | null;
  /** Current authentication mode */
  mode: AuthMode;
  /** Whether the app is online */
  isOnline: boolean;
  /** Backend-resolved workspace plan and feature grants */
  entitlements: EntitlementResponse | null;
}

/**
 * Desktop authentication context value
 */
export interface DesktopAuthContextValue extends DesktopAuthState {
  /** Log in with email and password */
  login: (email: string, password: string) => Promise<void>;
  /** Register a new account */
  register: (
    email: string,
    password: string,
    displayName: string,
    username: string,
  ) => Promise<void>;
  /** Start hosted browser sign-in */
  startSignIn: (screenHint?: "sign-in" | "sign-up") => Promise<void>;
  /** Complete hosted browser sign-in from a GoalRate deep link */
  handleAuthCallback: (callbackUrl: string) => Promise<void>;
  /** Reload backend-owned entitlements */
  refreshEntitlements: () => Promise<void>;
  /** Log out and return to anonymous mode */
  logout: () => Promise<void>;
  /** Continue using the app without logging in */
  continueWithoutLogin: () => void;
  /** Refresh the access token */
  refreshAuth: () => Promise<boolean>;
  /** Clear any error message */
  clearError: () => void;
}

/**
 * Login response from the API
 */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: StoredUser;
}

/**
 * Token refresh response from the API
 */
export interface TokenRefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}
