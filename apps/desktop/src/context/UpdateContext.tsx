/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react';
import { useAutoUpdate, type UseAutoUpdateReturn } from '../hooks/useAutoUpdate';
import { UpdateNotification } from '../components/UpdateNotification';

/**
 * Context for sharing update state and actions across the application
 */
const UpdateContext = createContext<UseAutoUpdateReturn | null>(null);

/**
 * Props for the UpdateProvider component
 */
export interface UpdateProviderProps {
  children: ReactNode;
}

/**
 * Provider component that manages auto-update functionality
 *
 * - Initializes the useAutoUpdate hook
 * - Renders the UpdateNotification component
 * - Exposes update state and actions via context
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <UpdateProvider>
 *       <YourApp />
 *     </UpdateProvider>
 *   );
 * }
 * ```
 */
export function UpdateProvider({ children }: UpdateProviderProps): React.ReactElement {
  const update = useAutoUpdate({
    checkOnMount: false, // Manual checks only
    checkInterval: 0,
    onUpdateAvailable: (info): void => {
      console.warn('[Update] New version available:', info.version);
    },
    onError: (error): void => {
      console.error('[Update] Error:', error.message);
    },
  });

  return (
    <UpdateContext.Provider value={update}>
      {children}
      <UpdateNotification
        state={update.state}
        onDownload={update.downloadUpdate}
        onInstall={update.installUpdate}
        onDismiss={update.dismissUpdate}
      />
    </UpdateContext.Provider>
  );
}

/**
 * Hook to access update functionality from any component
 *
 * @throws Error if used outside of UpdateProvider
 *
 * @example
 * ```tsx
 * function SettingsPage() {
 *   const { state, checkForUpdates } = useUpdate();
 *
 *   return (
 *     <button onClick={checkForUpdates}>
 *       Check for Updates
 *     </button>
 *   );
 * }
 * ```
 */
export function useUpdate(): UseAutoUpdateReturn {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useUpdate must be used within an UpdateProvider');
  }
  return context;
}
