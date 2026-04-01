import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../src/http';
import { ApiError } from '../src/errors';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('HttpClient', () => {
  let client: HttpClient;

  beforeEach(() => {
    client = new HttpClient({ baseUrl: 'https://api.example.com' });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should remove trailing slash from baseUrl', () => {
      const c = new HttpClient({ baseUrl: 'https://api.example.com/' });
      // Access private field via any for testing
      expect((c as unknown as { baseUrl: string }).baseUrl).toBe('https://api.example.com');
    });

    it('should use default timeout of 30000ms', () => {
      expect((client as unknown as { timeout: number }).timeout).toBe(30000);
    });

    it('should accept custom timeout', () => {
      const c = new HttpClient({ baseUrl: 'https://api.example.com', timeout: 5000 });
      expect((c as unknown as { timeout: number }).timeout).toBe(5000);
    });
  });

  describe('token management', () => {
    it('should set and get access token', () => {
      expect(client.hasAccessToken()).toBe(false);
      expect(client.getAccessToken()).toBeNull();

      client.setAccessToken('my-token');

      expect(client.hasAccessToken()).toBe(true);
      expect(client.getAccessToken()).toBe('my-token');
    });

    it('should clear access token', () => {
      client.setAccessToken('my-token');
      client.clearAccessToken();

      expect(client.hasAccessToken()).toBe(false);
      expect(client.getAccessToken()).toBeNull();
    });
  });

  describe('GET requests', () => {
    it('should make a GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ data: 'test' })),
      });

      const response = await client.get<{ data: string }>('/test');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'GET',
        })
      );
      expect(response.data).toEqual({ data: 'test' });
      expect(response.status).toBe(200);
    });

    it('should include query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/test', { page: 1, limit: 10, filter: 'active' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test?page=1&limit=10&filter=active',
        expect.anything()
      );
    });

    it('should handle array query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/test', { tags: ['a', 'b', 'c'] });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test?tags=a&tags=b&tags=c',
        expect.anything()
      );
    });

    it('should skip null and undefined query parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/test', { a: 'value', b: null, c: undefined });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test?a=value',
        expect.anything()
      );
    });
  });

  describe('POST requests', () => {
    it('should make a POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ id: '123' })),
      });

      const response = await client.post<{ id: string }>('/items', { name: 'test' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'test' }),
        })
      );
      expect(response.data).toEqual({ id: '123' });
    });
  });

  describe('PATCH requests', () => {
    it('should make a PATCH request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({ updated: true })),
      });

      await client.patch('/items/123', { name: 'updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items/123',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'updated' }),
        })
      );
    });
  });

  describe('DELETE requests', () => {
    it('should make a DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: () => Promise.resolve(''),
      });

      await client.delete('/items/123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items/123',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('authentication', () => {
    it('should include Authorization header when token is set', async () => {
      client.setAccessToken('bearer-token');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/protected');

      const calledHeaders = mockFetch.mock.calls[0][1].headers;
      expect(calledHeaders.get('Authorization')).toBe('Bearer bearer-token');
    });

    it('should not include Authorization header when no token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/public');

      const calledHeaders = mockFetch.mock.calls[0][1].headers;
      expect(calledHeaders.has('Authorization')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw ApiError for non-ok responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'req-123' }),
        json: () => Promise.resolve({ message: 'Resource not found' }),
        text: () => Promise.resolve(JSON.stringify({ message: 'Resource not found' })),
      });

      await expect(client.get('/missing')).rejects.toThrow(ApiError);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'req-123' }),
        json: () => Promise.resolve({ message: 'Resource not found' }),
        text: () => Promise.resolve(JSON.stringify({ message: 'Resource not found' })),
      });

      try {
        await client.get('/missing');
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('NOT_FOUND');
        expect((error as ApiError).status).toBe(404);
      }
    });

    it('should extract error message from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ detail: 'Validation failed' }),
        text: () => Promise.resolve(JSON.stringify({ detail: 'Validation failed' })),
      });

      try {
        await client.post('/items', { invalid: 'data' });
      } catch (error) {
        expect((error as ApiError).message).toBe('Validation failed');
      }
    });

    it('should handle FastAPI validation errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          detail: [{ loc: ['body', 'email'], msg: 'Invalid email', type: 'value_error' }],
        }),
        text: () => Promise.resolve(JSON.stringify({
          detail: [{ loc: ['body', 'email'], msg: 'Invalid email', type: 'value_error' }],
        })),
      });

      try {
        await client.post('/items', { invalid: 'data' });
      } catch (error) {
        expect((error as ApiError).message).toBe('Invalid email');
      }
    });

    it('should throw timeout error when request times out', async () => {
      const slowClient = new HttpClient({
        baseUrl: 'https://api.example.com',
        timeout: 100,
      });

      // Create an error that looks like an AbortError
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(slowClient.get('/slow')).rejects.toThrow(ApiError);

      mockFetch.mockRejectedValueOnce(abortError);

      try {
        await slowClient.get('/slow');
      } catch (error) {
        expect((error as ApiError).code).toBe('TIMEOUT');
      }
    });

    it('should throw network error on fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(client.get('/test')).rejects.toThrow(ApiError);

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      try {
        await client.get('/test');
      } catch (error) {
        expect((error as ApiError).code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('interceptors', () => {
    it('should call request interceptors', async () => {
      const interceptor = vi.fn((config) => config);
      client.addRequestInterceptor(interceptor);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/test');

      expect(interceptor).toHaveBeenCalled();
    });

    it('should allow removing interceptors', async () => {
      const interceptor = vi.fn((config) => config);
      const remove = client.addRequestInterceptor(interceptor);

      remove();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      });

      await client.get('/test');

      expect(interceptor).not.toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    it('should retry on server errors', async () => {
      const clientWithRetry = new HttpClient({
        baseUrl: 'https://api.example.com',
        retries: 2,
        retryDelay: 10,
      });

      // First two calls fail, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
          json: () => Promise.resolve({ error: 'Server error' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Server error' })),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers(),
          json: () => Promise.resolve({ error: 'Server error' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Server error' })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ success: true })),
        });

      const response = await clientWithRetry.get<{ success: boolean }>('/test');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(response.data.success).toBe(true);
    });

    it('should not retry on client errors (4xx)', async () => {
      const clientWithRetry = new HttpClient({
        baseUrl: 'https://api.example.com',
        retries: 2,
        retryDelay: 10,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Bad request' }),
        text: () => Promise.resolve(JSON.stringify({ error: 'Bad request' })),
      });

      await expect(clientWithRetry.get('/test')).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on rate limiting (429)', async () => {
      const clientWithRetry = new HttpClient({
        baseUrl: 'https://api.example.com',
        retries: 1,
        retryDelay: 10,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers(),
          json: () => Promise.resolve({ error: 'Rate limited' }),
          text: () => Promise.resolve(JSON.stringify({ error: 'Rate limited' })),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ success: true })),
        });

      const response = await clientWithRetry.get<{ success: boolean }>('/test');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(response.data.success).toBe(true);
    });
  });
});
