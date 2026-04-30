/**
 * GoalrateClient - Main API client class
 * Composes all feature-specific clients into a unified interface
 */

import { HttpClient } from './http';
import type { GoalrateClientConfig } from './types';
import { AuthClient } from './auth/authClient';
import { VaultClient } from './vaults/vaultClient';
import { GoalClient } from './goals/goalClient';
import { ProjectClient } from './projects/projectClient';
import { EpicClient } from './epics/epicClient';
import { SprintClient } from './sprints/sprintClient';
import { FocusClient } from './focus/focusClient';
import { SocialClient } from './social/socialClient';
import { SubscriptionClient } from './subscriptions/subscriptionClient';
import { UserClient } from './users/userClient';
import { ApiError, isApiError } from './errors';

/**
 * Main Goalrate API client
 *
 * Provides a unified interface for all Goalrate API operations.
 * Handles authentication, token refresh, and provides access to
 * all feature-specific clients.
 *
 * @example
 * ```typescript
 * const client = new GoalrateClient({
 *   baseUrl: 'https://api.goalrate.com',
 *   accessToken: 'initial-token',
 *   onTokenRefresh: (access, refresh) => {
 *     localStorage.setItem('access_token', access);
 *     localStorage.setItem('refresh_token', refresh);
 *   },
 *   onAuthError: () => {
 *     window.location.href = '/login';
 *   },
 * });
 *
 * // Use feature clients
 * const goals = await client.goals.list();
 * const projects = await client.projects.list();
 *
 * // Login
 * const { access_token, user } = await client.auth.login({
 *   email: 'user@example.com',
 *   password: 'password',
 * });
 * client.setAccessToken(access_token);
 * ```
 */
export class GoalrateClient {
  private http: HttpClient;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<void> | null = null;
  private config: GoalrateClientConfig;

  // Feature clients
  public readonly auth: AuthClient;
  public readonly vaults: VaultClient;
  public readonly goals: GoalClient;
  public readonly projects: ProjectClient;
  public readonly epics: EpicClient;
  public readonly sprints: SprintClient;
  public readonly focus: FocusClient;
  public readonly social: SocialClient;
  public readonly subscriptions: SubscriptionClient;
  public readonly users: UserClient;

  constructor(config: GoalrateClientConfig) {
    this.config = config;
    this.refreshToken = config.refreshToken || null;

    // Create HTTP client
    this.http = new HttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout || 30000,
      headers: config.headers || {},
      retries: config.retries || 0,
      retryDelay: config.retryDelay || 1000,
    });

    // Set initial access token
    if (config.accessToken) {
      this.http.setAccessToken(config.accessToken);
    }

    // Set up automatic token refresh on 401
    if (config.autoRefresh !== false) {
      this.setupAutoRefresh();
    }

    // Initialize feature clients
    this.auth = new AuthClient(this.http);
    this.vaults = new VaultClient(this.http);
    this.goals = new GoalClient(this.http);
    this.projects = new ProjectClient(this.http);
    this.epics = new EpicClient(this.http);
    this.sprints = new SprintClient(this.http);
    this.focus = new FocusClient(this.http);
    this.social = new SocialClient(this.http);
    this.subscriptions = new SubscriptionClient(this.http);
    this.users = new UserClient(this.http);
  }

  /**
   * Set the access token for authenticated requests
   */
  setAccessToken(token: string): void {
    this.http.setAccessToken(token);
  }

  /**
   * Clear the access token
   */
  clearAccessToken(): void {
    this.http.clearAccessToken();
  }

  /**
   * Set the refresh token for automatic token refresh
   */
  setRefreshToken(token: string): void {
    this.refreshToken = token;
  }

  /**
   * Clear the refresh token
   */
  clearRefreshToken(): void {
    this.refreshToken = null;
  }

  /**
   * Set both access and refresh tokens
   */
  setTokens(accessToken: string, refreshToken: string): void {
    this.setAccessToken(accessToken);
    this.setRefreshToken(refreshToken);
  }

  /**
   * Clear all tokens (logout)
   */
  clearTokens(): void {
    this.clearAccessToken();
    this.clearRefreshToken();
  }

  /**
   * Check if the client has an access token
   */
  isAuthenticated(): boolean {
    return this.http.hasAccessToken();
  }

  /**
   * Get the underlying HTTP client for custom requests
   */
  getHttpClient(): HttpClient {
    return this.http;
  }

  /**
   * Set up automatic token refresh on 401 errors
   */
  private setupAutoRefresh(): void {
    this.http.addErrorInterceptor(async (error) => {
      // Only handle 401 errors with a refresh token available
      if (!isApiError(error) || error.status !== 401 || !this.refreshToken) {
        return error;
      }

      // Prevent concurrent refresh attempts
      if (!this.refreshPromise) {
        this.refreshPromise = this.attemptTokenRefresh();
      }

      try {
        await this.refreshPromise;
        // Token refreshed successfully, the original request should be retried
        // by the caller (we can't retry here as we don't have the original request)
        return error;
      } catch (refreshError) {
        // Token refresh failed, call auth error callback
        this.config.onAuthError?.();
        return refreshError instanceof Error ? refreshError : error;
      } finally {
        this.refreshPromise = null;
      }
    });
  }

  /**
   * Attempt to refresh the access token
   */
  private async attemptTokenRefresh(): Promise<void> {
    if (!this.refreshToken) {
      throw new ApiError('UNAUTHORIZED', 'No refresh token available', 401);
    }

    try {
      const response = await this.auth.refreshToken(this.refreshToken);

      // Update tokens
      this.http.setAccessToken(response.access_token);
      this.refreshToken = response.refresh_token;

      // Notify callback
      this.config.onTokenRefresh?.(
        response.access_token,
        response.refresh_token
      );
    } catch (error) {
      // Clear tokens on refresh failure
      this.clearTokens();
      throw error;
    }
  }
}

/**
 * Create a GoalrateClient instance
 */
export function createGoalrateClient(
  config: GoalrateClientConfig
): GoalrateClient {
  return new GoalrateClient(config);
}
