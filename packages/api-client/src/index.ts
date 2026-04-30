/**
 * @goalrate-app/api-client
 *
 * Type-safe HTTP client for Goalrate API
 *
 * @example
 * ```typescript
 * import { GoalrateClient } from '@goalrate-app/api-client';
 *
 * const client = new GoalrateClient({
 *   baseUrl: 'https://api.goalrate.com',
 *   accessToken: getStoredToken(),
 *   onAuthError: () => redirectToLogin(),
 * });
 *
 * // Use feature clients
 * const goals = await client.goals.list();
 * const projects = await client.projects.list();
 * ```
 */

// Main client
export { GoalrateClient, createGoalrateClient } from './client';

// HTTP client (for advanced use cases)
export { HttpClient, createHttpClient } from './http';

// Types
export type {
  GoalrateClientConfig,
  HttpClientConfig,
  ApiResponse,
  PaginatedResponse,
  ListParams,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from './types';

// Errors
export {
  ApiError,
  isApiError,
  statusToErrorCode,
  createApiError,
  createNetworkError,
  createTimeoutError,
} from './errors';
export type { ApiErrorCode } from './errors';

// Feature clients - re-export for convenience
export { AuthClient } from './auth/authClient';
export { VaultClient } from './vaults/vaultClient';
export { GoalClient } from './goals/goalClient';
export { ProjectClient } from './projects/projectClient';
export { EpicClient } from './epics/epicClient';
export { SprintClient } from './sprints/sprintClient';
export { FocusClient } from './focus/focusClient';
export { SocialClient } from './social/socialClient';
export { SubscriptionClient } from './subscriptions/subscriptionClient';
export { UserClient } from './users/userClient';

// Feature client types
export type {
  LoginCredentials,
  RegisterData,
  AuthResponse,
  TokenResponse,
  PasswordResetRequest,
  PasswordResetConfirm,
  PasswordChangeRequest,
  ProfileUpdateData,
} from './auth/authClient';

export type {
  VaultListItem,
  VaultCreate,
  VaultUpdate,
  VaultStats,
} from './vaults/vaultClient';

export type {
  GoalListParams,
  GoalTaskCreate,
  GoalTaskUpdate,
  DailyTaskCreate,
} from './goals/goalClient';

export type {
  ProjectListParams,
  ProjectCreate,
  ProjectUpdate,
  ColumnCreate,
  ColumnUpdate,
} from './projects/projectClient';

export type {
  EpicListParams,
  EpicCreate,
  EpicUpdate,
} from './epics/epicClient';

export type {
  SprintListParams,
  SprintCreate,
  SprintUpdate,
  RetrospectiveData,
  SprintVelocity,
} from './sprints/sprintClient';

export type { FocusHistoryParams } from './focus/focusClient';

export type {
  ActivityFeedParams,
  UserSearchParams,
} from './social/socialClient';

export type {
  PlanPricing,
  CheckoutSession,
  BillingPortal,
  SubscriptionDetails,
  Invoice,
} from './subscriptions/subscriptionClient';

export type {
  UserSettingsUpdate,
  ProfileVisibility,
  AvatarUploadResult,
} from './users/userClient';
