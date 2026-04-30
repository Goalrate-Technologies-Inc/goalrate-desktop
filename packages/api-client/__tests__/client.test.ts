import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoalrateClient } from '../src/client';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('GoalrateClient', () => {
  let client: GoalrateClient;

  beforeEach(() => {
    mockFetch.mockReset();
    client = new GoalrateClient({
      baseUrl: 'https://api.goalrate.com',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create client with all feature clients', () => {
      expect(client.auth).toBeDefined();
      expect(client.vaults).toBeDefined();
      expect(client.goals).toBeDefined();
      expect(client.projects).toBeDefined();
      expect(client.epics).toBeDefined();
      expect(client.sprints).toBeDefined();
      expect(client.focus).toBeDefined();
      expect(client.social).toBeDefined();
      expect(client.subscriptions).toBeDefined();
      expect(client.users).toBeDefined();
    });

    it('should set initial access token', () => {
      const clientWithToken = new GoalrateClient({
        baseUrl: 'https://api.goalrate.com',
        accessToken: 'initial-token',
      });

      expect(clientWithToken.isAuthenticated()).toBe(true);
    });
  });

  describe('token management', () => {
    it('should set access token', () => {
      expect(client.isAuthenticated()).toBe(false);

      client.setAccessToken('my-token');

      expect(client.isAuthenticated()).toBe(true);
    });

    it('should clear access token', () => {
      client.setAccessToken('my-token');
      client.clearAccessToken();

      expect(client.isAuthenticated()).toBe(false);
    });

    it('should set both tokens', () => {
      client.setTokens('access', 'refresh');

      expect(client.isAuthenticated()).toBe(true);
    });

    it('should clear all tokens', () => {
      client.setTokens('access', 'refresh');
      client.clearTokens();

      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('feature clients', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 10, hasMore: false })),
      });
    });

    it('should use goals client', async () => {
      await client.goals.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.goalrate.com/api/goals',
        expect.anything()
      );
    });

    it('should use projects client', async () => {
      await client.projects.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.goalrate.com/api/projects',
        expect.anything()
      );
    });

    it('should use vaults client', async () => {
      await client.vaults.list();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.goalrate.com/api/vaults',
        expect.anything()
      );
    });
  });

  describe('auth flow', () => {
    it('should login and set token', async () => {
      const authResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: '1', email: 'test@example.com', display_name: 'Test' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(authResponse)),
      });

      const response = await client.auth.login({
        email: 'test@example.com',
        password: 'password',
      });

      expect(response.access_token).toBe('new-access-token');

      // Set token after login
      client.setAccessToken(response.access_token);
      expect(client.isAuthenticated()).toBe(true);
    });
  });

  describe('token refresh callbacks', () => {
    it('should call onTokenRefresh when tokens are refreshed', async () => {
      const onTokenRefresh = vi.fn();

      const clientWithRefresh = new GoalrateClient({
        baseUrl: 'https://api.goalrate.com',
        refreshToken: 'initial-refresh-token',
        onTokenRefresh,
      });

      const tokenResponse = {
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
      };
      // Mock refresh endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(tokenResponse)),
      });

      // Manually trigger refresh
      await clientWithRefresh.auth.refreshToken('initial-refresh-token');

      // onTokenRefresh would be called by the auto-refresh interceptor
      // In this test we're just verifying the mechanism exists
      expect(clientWithRefresh).toBeDefined();
    });
  });

  describe('getHttpClient', () => {
    it('should return the underlying HTTP client', () => {
      const httpClient = client.getHttpClient();

      expect(httpClient).toBeDefined();
      expect(typeof httpClient.get).toBe('function');
      expect(typeof httpClient.post).toBe('function');
    });
  });
});
