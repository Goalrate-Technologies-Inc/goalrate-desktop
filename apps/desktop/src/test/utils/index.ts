/**
 * Test Utilities
 * Re-export all test utilities from a single entry point
 */

// Render utilities
export {
  renderWithProviders,
  createHookWrapper,
  createRouterWrapper,
  createStorageWrapper,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
  userEvent,
  type ProviderOptions,
  type CustomRenderResult,
} from './renderWithProviders';

// Tauri mock utilities
export {
  setupTauriInvokeMock,
  setupTauriEventMock,
  createWindowMock,
  createUpdaterMock,
  createProcessMock,
  commandResponses,
  type TauriInvokeMock,
  type TauriEventMock,
} from './mockTauri';

// Test data factories
export {
  // ID management
  resetIdCounter,
  // Vault factories
  createMockVaultConfig,
  createMockVault,
  createMockVaultListItem,
  // Goal factories
  createDefaultGoalColumns,
  createMockGoal,
  createMockGoalTask,
  // Project factories
  createDefaultProjectColumns,
  createMockProject,
  // Focus factories
  createMockFocusItem,
  createMockFocusDay,
  createMockFocusCandidate,
  createMockFocusVelocity,
  // Batch factories
  createMockVaultList,
  createMockGoalList,
  createMockGoalTaskList,
  createMockGoalWithTasks,
} from './factories';
