/**
 * HTTP Client for making API requests
 * Extracted and enhanced from the storage adapter's api-client
 */

import {
  ApiError,
  createApiError,
  createNetworkError,
  createTimeoutError,
} from './errors';
import type {
  ApiResponse,
  HttpClientConfig,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from './types';

/**
 * Default configuration values
 */
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * HTTP Client class for making typed API requests
 */
export class HttpClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private customHeaders: Record<string, string>;
  private timeout: number;
  private retries: number;
  private retryDelay: number;

  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private errorInterceptors: ErrorInterceptor[] = [];

  constructor(config: Partial<HttpClientConfig> & { baseUrl: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.customHeaders = config.headers || {};
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.retries = config.retries || DEFAULT_RETRIES;
    this.retryDelay = config.retryDelay || DEFAULT_RETRY_DELAY;
  }

  /**
   * Set the access token for authenticated requests
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Check if the client has an access token
   */
  hasAccessToken(): boolean {
    return this.accessToken !== null && this.accessToken.length > 0;
  }

  /**
   * Clear the access token
   */
  clearAccessToken(): void {
    this.accessToken = null;
  }

  /**
   * Set custom headers
   */
  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...this.customHeaders, ...headers };
  }

  /**
   * Add a request interceptor
   */
  addRequestInterceptor(interceptor: RequestInterceptor): () => void {
    this.requestInterceptors.push(interceptor);
    return () => {
      const index = this.requestInterceptors.indexOf(interceptor);
      if (index > -1) {
        this.requestInterceptors.splice(index, 1);
      }
    };
  }

  /**
   * Add a response interceptor
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
    this.responseInterceptors.push(interceptor);
    return () => {
      const index = this.responseInterceptors.indexOf(interceptor);
      if (index > -1) {
        this.responseInterceptors.splice(index, 1);
      }
    };
  }

  /**
   * Add an error interceptor
   */
  addErrorInterceptor(interceptor: ErrorInterceptor): () => void {
    this.errorInterceptors.push(interceptor);
    return () => {
      const index = this.errorInterceptors.indexOf(interceptor);
      if (index > -1) {
        this.errorInterceptors.splice(index, 1);
      }
    };
  }

  /**
   * Make a GET request
   */
  async get<T>(
    path: string,
    queryParams?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, queryParams);
    return this.request<T>('GET', url);
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>('POST', url, body);
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>('PUT', url, body);
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>('PATCH', url, body);
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    return this.request<T>('DELETE', url, body);
  }

  /**
   * Build URL with query parameters
   */
  private buildUrl(
    path: string,
    queryParams?: Record<string, unknown>
  ): string {
    // Handle absolute URLs vs relative paths
    const fullUrl = path.startsWith('http')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    const url = new URL(fullUrl);

    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            value.forEach((v) => url.searchParams.append(key, String(v)));
          } else if (typeof value === 'object') {
            url.searchParams.append(key, JSON.stringify(value));
          } else {
            url.searchParams.append(key, String(value));
          }
        }
      }
    }

    return url.toString();
  }

  /**
   * Build request headers
   */
  private buildHeaders(): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.customHeaders,
    });

    if (this.accessToken) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }

    return headers;
  }

  /**
   * Make an HTTP request with retry logic
   */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        return await this.executeRequest<T>(method, url, body);
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx) except rate limiting
        if (error instanceof ApiError) {
          if (
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            throw error;
          }
        }

        // If this was the last attempt, throw the error
        if (attempt === this.retries) {
          throw error;
        }

        // Wait before retrying with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError || new Error('Unknown error');
  }

  /**
   * Execute a single HTTP request
   */
  private async executeRequest<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Build initial request config
      let config: RequestInit & { url: string } = {
        url,
        method,
        headers: this.buildHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      };

      // Apply request interceptors
      for (const interceptor of this.requestInterceptors) {
        config = await interceptor(config);
      }

      // Make the request
      let response = await fetch(config.url, {
        method: config.method,
        headers: config.headers,
        body: config.body,
        signal: config.signal,
      });

      clearTimeout(timeoutId);

      // Apply response interceptors
      for (const interceptor of this.responseInterceptors) {
        response = await interceptor(response);
      }

      // Handle error responses
      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          try {
            errorData = await response.text();
          } catch {
            errorData = undefined;
          }
        }

        const requestId = response.headers.get('x-request-id') || undefined;

        throw createApiError(
          response.status,
          this.extractErrorMessage(errorData, response.statusText),
          errorData,
          requestId
        );
      }

      // Parse response data
      const contentType = response.headers.get('content-type');
      let data: T;

      if (contentType?.includes('application/json')) {
        const text = await response.text();
        data = text ? JSON.parse(text) : (null as T);
      } else {
        data = (await response.text()) as unknown as T;
      }

      return {
        data,
        status: response.status,
        headers: response.headers,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        throw createTimeoutError(this.timeout);
      }

      // Handle network errors
      if (
        error instanceof TypeError &&
        error.message.includes('Failed to fetch')
      ) {
        throw createNetworkError('Network request failed', error);
      }

      // Apply error interceptors
      let processedError = error as Error;
      for (const interceptor of this.errorInterceptors) {
        processedError = await interceptor(processedError);
      }

      // Re-throw ApiErrors as-is
      if (processedError instanceof ApiError) {
        throw processedError;
      }

      // Wrap other errors
      if (processedError instanceof Error) {
        throw createNetworkError(processedError.message, processedError);
      }

      throw createNetworkError('Unknown error', error as Error);
    }
  }

  /**
   * Extract error message from response data
   */
  private extractErrorMessage(
    data: unknown,
    fallback: string
  ): string {
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        return obj.message;
      }
      if (typeof obj.detail === 'string') {
        return obj.detail;
      }
      if (typeof obj.error === 'string') {
        return obj.error;
      }
      if (Array.isArray(obj.detail) && obj.detail.length > 0) {
        const firstError = obj.detail[0];
        if (typeof firstError === 'object' && firstError !== null) {
          const errorObj = firstError as Record<string, unknown>;
          if (typeof errorObj.msg === 'string') {
            return errorObj.msg;
          }
        }
      }
    }
    return fallback;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create an HTTP client instance
 */
export function createHttpClient(
  config: Partial<HttpClientConfig> & { baseUrl: string }
): HttpClient {
  return new HttpClient(config);
}
