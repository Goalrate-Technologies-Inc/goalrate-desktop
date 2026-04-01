/**
 * Desktop API Client
 *
 * Wraps the shared API client with desktop-specific functionality:
 * - Token injection from system keychain
 * - Automatic token refresh on 401
 * - Offline detection and graceful degradation
 */

import { invoke } from '@tauri-apps/api/core';
import { createHttpClient, type HttpClient } from '@goalrate-app/api-client';
import type { StoredTokens } from '../types/auth';

// API base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

let httpClient: HttpClient | null = null;
let refreshPromise: Promise<boolean> | null = null;

/**
 * Get or create the HTTP client
 */
export function getApiClient(): HttpClient {
  if (!httpClient) {
    httpClient = createHttpClient({
      baseUrl: API_BASE_URL,
      timeout: 30000,
      retries: 1,
    });

    // Add error interceptor for automatic token refresh
    httpClient.addErrorInterceptor(async (error) => {
      // Check if this is a 401 error
      if (error.name === 'ApiError' && (error as { status?: number }).status === 401) {
        // Try to refresh the token
        const refreshed = await refreshTokens();
        if (refreshed) {
          // Token refreshed, the caller should retry the request
          // We throw a special error that indicates retry is needed
          const retryError = new Error('TOKEN_REFRESHED_RETRY');
          retryError.name = 'RetryableError';
          throw retryError;
        }
      }
      throw error;
    });
  }

  return httpClient;
}

/**
 * Initialize the API client with tokens from keychain
 */
export async function initializeApiClient(): Promise<void> {
  try {
    const tokens = await invoke<StoredTokens | null>('get_tokens');

    if (tokens) {
      const client = getApiClient();
      client.setAccessToken(tokens.accessToken);
      console.warn('[API] Client initialized with access token');
    } else {
      console.warn('[API] No tokens found, client initialized without auth');
    }
  } catch (error) {
    console.error('[API] Failed to initialize client:', error);
  }
}

/**
 * Update the API client with new access token
 */
export function setAccessToken(token: string | null): void {
  const client = getApiClient();
  client.setAccessToken(token);
}

/**
 * Clear the access token from the API client
 */
export function clearAccessToken(): void {
  const client = getApiClient();
  client.clearAccessToken();
}

/**
 * Check if the client has an access token
 */
export function hasAccessToken(): boolean {
  const client = getApiClient();
  return client.hasAccessToken();
}

/**
 * Refresh tokens using the refresh token from keychain
 */
export async function refreshTokens(): Promise<boolean> {
  // If refresh is already in progress, wait for it
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = doRefreshTokens();
  const result = await refreshPromise;
  refreshPromise = null;
  return result;
}

/**
 * Internal function to perform token refresh
 */
async function doRefreshTokens(): Promise<boolean> {
  try {
    const tokens = await invoke<StoredTokens | null>('get_tokens');

    if (!tokens) {
      console.warn('[API] No tokens to refresh');
      return false;
    }

    console.warn('[API] Refreshing access token...');

    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    });

    if (!response.ok) {
      console.warn('[API] Token refresh failed with status:', response.status);

      if (response.status === 401) {
        // Refresh token is invalid, clear tokens
        await invoke('clear_tokens');
        clearAccessToken();

        // Emit event for auth context to handle
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }

      return false;
    }

    const data = await response.json();

    // Calculate expiration timestamp
    const expiresAt = Date.now() + data.expires_in * 1000;

    // Update tokens in keychain
    await invoke('update_tokens', {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    });

    // Update API client
    setAccessToken(data.access_token);

    console.warn('[API] Token refresh successful');
    return true;
  } catch (error) {
    console.error('[API] Token refresh error:', error);
    return false;
  }
}

/**
 * Check if we're online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Make an authenticated API request
 *
 * This is a convenience wrapper that:
 * 1. Ensures the client has a token
 * 2. Handles token refresh if needed
 * 3. Gracefully handles offline state
 */
export async function authenticatedRequest<T>(
  requestFn: (client: HttpClient) => Promise<T>
): Promise<T> {
  if (!isOnline()) {
    throw new Error('No network connection');
  }

  const client = getApiClient();

  // Ensure we have a token
  if (!client.hasAccessToken()) {
    await initializeApiClient();
  }

  try {
    return await requestFn(client);
  } catch (error) {
    // Check if we need to retry after token refresh
    if (error instanceof Error && error.name === 'RetryableError') {
      // Retry the request with the new token
      return await requestFn(client);
    }
    throw error;
  }
}

/**
 * Reset the API client (for logout)
 */
export function resetApiClient(): void {
  if (httpClient) {
    httpClient.clearAccessToken();
  }
  httpClient = null;
}
