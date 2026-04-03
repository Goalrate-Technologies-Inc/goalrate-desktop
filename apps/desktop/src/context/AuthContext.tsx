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

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type {
  DesktopAuthContextValue,
  DesktopAuthState,
  StoredTokens,
  StoredUser,
  LoginResponse,
  TokenRefreshResponse,
} from '../types/auth';

// API base URL - should match the web app's configuration
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/**
 * Default auth state
 */
const defaultAuthState: DesktopAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  mode: 'anonymous',
  isOnline: navigator.onLine,
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

/**
 * AuthProvider component
 *
 * Wraps the app with authentication state management.
 * On mount, checks for existing tokens in the keychain.
 */
export function AuthProvider({ children }: AuthProviderProps): React.ReactElement {
  const [state, setState] = useState<DesktopAuthState>(defaultAuthState);

  // Track online status
  useEffect(() => {
    const handleOnline = (): void => {
      setState((prev) => ({ ...prev, isOnline: true }));
    };
    const handleOffline = (): void => {
      setState((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  /**
   * Initialize auth state on mount
   */
  useEffect(() => {
    const initAuth = async (): Promise<void> => {
      // If running outside Tauri (e.g. plain browser), skip keychain access
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
        setState({
          ...defaultAuthState,
          isLoading: false,
          mode: 'anonymous',
        });
        return;
      }
      try {
        // Check for existing tokens in keychain
        const tokens = await invoke<StoredTokens | null>('get_tokens');
        const user = await invoke<StoredUser | null>('get_stored_user');

        if (tokens && user) {
          // Check if tokens are still valid
          const now = Date.now();
          const isExpired = tokens.expiresAt <= now;

          if (isExpired) {
            // Try to refresh the token
            const refreshed = await refreshAuthInternal(tokens.refreshToken);
            if (!refreshed) {
              // Token refresh failed, clear tokens and go to anonymous mode
              await invoke('clear_tokens');
              setState({
                ...defaultAuthState,
                isLoading: false,
                mode: 'anonymous',
              });
              return;
            }
          }

          // Tokens are valid
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            mode: 'authenticated',
            isOnline: navigator.onLine,
          });
        } else {
          // No tokens, anonymous mode
          setState({
            ...defaultAuthState,
            isLoading: false,
            mode: 'anonymous',
          });
        }
      } catch (error) {
        console.error('[Auth] Failed to initialize auth:', error);
        setState({
          ...defaultAuthState,
          isLoading: false,
          error: 'Failed to load authentication state',
        });
      }
    };

    initAuth();
  }, []);

  /**
   * Internal token refresh function
   */
  const refreshAuthInternal = async (refreshToken: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        console.warn('[Auth] Token refresh failed with status:', response.status);
        return false;
      }

      const data: TokenRefreshResponse = await response.json();

      // Calculate expiration timestamp
      const expiresAt = Date.now() + data.expires_in * 1000;

      // Update tokens in keychain
      await invoke('update_tokens', {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      });

      return true;
    } catch (error) {
      console.error('[Auth] Token refresh error:', error);
      return false;
    }
  };

  /**
   * Log in with email and password
   */
  const login = useCallback(async (email: string, password: string): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.detail ||
          errorData.message ||
          (response.status === 401
            ? 'Invalid email or password'
            : response.status === 429
              ? 'Too many login attempts. Please try again later.'
              : 'Login failed');
        throw new Error(errorMessage);
      }

      const data: LoginResponse = await response.json();

      // Calculate expiration timestamp
      const expiresAt = Date.now() + data.expires_in * 1000;

      // Store user data
      const user: StoredUser = {
        id: data.user.id,
        email: data.user.email,
        displayName: data.user.displayName,
        username: data.user.username,
        avatarUrl: data.user.avatarUrl,
      };

      // Store tokens in keychain
      await invoke('store_tokens', {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        userId: user.id,
        expiresAt,
        user,
      });

      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        mode: 'authenticated',
        isOnline: navigator.onLine,
      });

      console.warn('[Auth] Login successful for:', email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      console.error('[Auth] Login error:', message);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
      throw error;
    }
  }, []);

  /**
   * Register a new account
   */
  const register = useCallback(
    async (
      email: string,
      password: string,
      displayName: string,
      username: string
    ): Promise<void> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const response = await fetch(`${API_BASE_URL}/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
            display_name: displayName,
            username: username.trim().toLowerCase(),
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage =
            errorData.detail || errorData.message || 'Registration failed';
          throw new Error(errorMessage);
        }

        const data: LoginResponse = await response.json();

        // Calculate expiration timestamp
        const expiresAt = Date.now() + data.expires_in * 1000;

        // Store user data
        const user: StoredUser = {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName,
          username: data.user.username,
          avatarUrl: data.user.avatarUrl,
        };

        // Store tokens in keychain
        await invoke('store_tokens', {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          userId: user.id,
          expiresAt,
          user,
        });

        setState({
          user,
          isAuthenticated: true,
          isLoading: false,
          error: null,
          mode: 'authenticated',
          isOnline: navigator.onLine,
        });

        console.warn('[Auth] Registration successful for:', email);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Registration failed';
        console.error('[Auth] Registration error:', message);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: message,
        }));
        throw error;
      }
    },
    []
  );

  /**
   * Log out and return to anonymous mode
   */
  const logout = useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Get current tokens to call logout endpoint
      const tokens = await invoke<StoredTokens | null>('get_tokens');

      if (tokens && navigator.onLine) {
        // Call logout endpoint (best effort, ignore failures)
        try {
          await fetch(`${API_BASE_URL}/auth/logout`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokens.accessToken}`,
            },
          });
        } catch (error) {
          console.warn('[Auth] Logout API call failed (continuing anyway):', error);
        }
      }

      // Clear tokens from keychain
      await invoke('clear_tokens');

      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        mode: 'anonymous',
        isOnline: navigator.onLine,
      });

      console.warn('[Auth] Logout successful');
    } catch (error) {
      console.error('[Auth] Logout error:', error);
      // Still clear local state even if keychain clear fails
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        mode: 'anonymous',
        isOnline: navigator.onLine,
      });
    }
  }, []);

  /**
   * Continue using the app without logging in
   */
  const continueWithoutLogin = useCallback((): void => {
    setState((prev) => ({
      ...prev,
      mode: 'anonymous',
      isLoading: false,
      error: null,
    }));
    console.warn('[Auth] Continuing in anonymous mode');
  }, []);

  /**
   * Refresh the access token
   */
  const refreshAuth = useCallback(async (): Promise<boolean> => {
    try {
      const tokens = await invoke<StoredTokens | null>('get_tokens');
      if (!tokens) {
        return false;
      }

      return await refreshAuthInternal(tokens.refreshToken);
    } catch (error) {
      console.error('[Auth] Refresh auth error:', error);
      return false;
    }
  }, []);

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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Export context for advanced use cases
 */
export { AuthContext };
