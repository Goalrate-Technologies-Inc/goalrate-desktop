/**
 * @goalrate-app/storage
 * Platform-agnostic storage adapter layer
 *
 * This package provides a unified interface for storage operations across platforms:
 * - Web: API-based storage via HTTP
 * - Desktop: File system storage via Tauri (Phase 1)
 * - Native: AsyncStorage for React Native (Phase 5)
 *
 * @example
 * ```typescript
 * // Web application
 * import { StorageProvider } from '@goalrate-app/storage/react';
 * import { createWebStorage } from '@goalrate-app/storage/web';
 *
 * const storage = createWebStorage('https://api.goalrate.com');
 *
 * function App() {
 *   return (
 *     <StorageProvider adapter={storage}>
 *       <YourApp />
 *     </StorageProvider>
 *   );
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Testing
 * import { createMockStorage } from '@goalrate-app/storage/testing';
 *
 * const mockStorage = createMockStorage();
 * mockStorage.getGoals.mockReturnValue(Promise.resolve({ success: true, data: mockGoals }));
 * ```
 */

// Core interface and types
export type {
  StorageAdapter,
  StorageResult,
  StorageError,
  StorageErrorCode,
  GoalQueryOptions,
  ProjectQueryOptions,
  SprintQueryOptions,
} from './interface';

// Error utilities
export {
  createStorageError,
  wrapSuccess,
  wrapError,
  wrapResult,
  isSuccess,
  isError,
  isStorageError,
  toStorageError,
  tryCatch,
  tryCatchWithMapping,
  getErrorMessage,
  formatErrorMessage,
  unwrap,
  unwrapOr,
  mapResult,
  chainResults,
} from './errors';

// Re-export adapters barrel (for convenience)
export * from './adapters';

// Re-export react barrel (for convenience)
export * from './react';

// Re-export testing barrel (for convenience)
export * from './testing';
