/**
 * Configuration options for the GoalrateClient
 */
export interface GoalrateClientConfig {
  /** Base URL for API requests (e.g., 'https://api.goalrate.com') */
  baseUrl: string;

  /** Optional initial access token for authentication */
  accessToken?: string;

  /** Optional refresh token for token refresh */
  refreshToken?: string;

  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;

  /** Custom headers to include with every request */
  headers?: Record<string, string>;

  /** Callback when access token is refreshed */
  onTokenRefresh?: (accessToken: string, refreshToken: string) => void;

  /** Callback when authentication fails and user should re-login */
  onAuthError?: () => void;

  /** Enable automatic token refresh on 401 (default: true) */
  autoRefresh?: boolean;

  /** Number of retry attempts for failed requests (default: 0) */
  retries?: number;

  /** Retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
}

/**
 * HTTP client configuration (internal)
 */
export interface HttpClientConfig {
  baseUrl: string;
  timeout: number;
  headers: Record<string, string>;
  retries: number;
  retryDelay: number;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

/**
 * Paginated response from the API
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Common list query parameters
 * Includes index signature for compatibility with Record<string, unknown>
 */
export interface ListParams {
  [key: string]: unknown;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Request interceptor function type
 */
export type RequestInterceptor = (
  config: RequestInit & { url: string }
) => RequestInit & { url: string } | Promise<RequestInit & { url: string }>;

/**
 * Response interceptor function type
 */
export type ResponseInterceptor = (
  response: Response
) => Response | Promise<Response>;

/**
 * Error interceptor function type
 */
export type ErrorInterceptor = (
  error: Error
) => Error | Promise<Error>;
