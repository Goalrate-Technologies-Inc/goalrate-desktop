import { useState, useCallback, useEffect, useRef } from 'react';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import type { UpdateState, UpdateInfo, UpdateStatus } from '../types/update';

/**
 * Options for configuring the auto-update hook
 */
export interface UseAutoUpdateOptions {
  /** Check for updates on mount (default: true) */
  checkOnMount?: boolean;
  /** Interval in milliseconds for periodic checks (0 = disabled, default: 4 hours) */
  checkInterval?: number;
  /** Callback when update is available */
  onUpdateAvailable?: (info: UpdateInfo) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

/**
 * Return type for the useAutoUpdate hook
 */
export interface UseAutoUpdateReturn {
  /** Current state of the update system */
  state: UpdateState;
  /** Manually check for updates */
  checkForUpdates: (options?: CheckForUpdatesOptions) => Promise<void>;
  /** Download and prepare the update for installation */
  downloadUpdate: () => Promise<void>;
  /** Restart the application to install the update */
  installUpdate: () => Promise<void>;
  /** Dismiss the update notification */
  dismissUpdate: () => void;
}

/**
 * Options for manual update checks
 */
export interface CheckForUpdatesOptions {
  /** Whether to surface errors to the UI */
  showError?: boolean;
}

const INITIAL_STATE: UpdateState = {
  status: 'idle',
  info: null,
  progress: 0,
  error: null,
};

/** Default check interval: 4 hours */
const DEFAULT_CHECK_INTERVAL = 4 * 60 * 60 * 1000;

/** Delay before first check on mount: 3 seconds */
const INITIAL_CHECK_DELAY = 3000;

/**
 * Hook for managing auto-updates in a Tauri application
 *
 * @example
 * ```tsx
 * function App() {
 *   const { state, checkForUpdates, downloadUpdate, installUpdate } = useAutoUpdate();
 *
 *   if (state.status === 'available') {
 *     return <button onClick={downloadUpdate}>Download Update</button>;
 *   }
 *
 *   return <div>App content</div>;
 * }
 * ```
 */
export function useAutoUpdate(options: UseAutoUpdateOptions = {}): UseAutoUpdateReturn {
  const {
    checkOnMount = true,
    checkInterval = DEFAULT_CHECK_INTERVAL,
    onUpdateAvailable,
    onError,
  } = options;
  const resolvedCheckInterval = import.meta.env.MODE === 'test' ? 0 : checkInterval;

  const [state, setState] = useState<UpdateState>(INITIAL_STATE);
  const updateRef = useRef<Update | null>(null);
  const intervalRef = useRef<number | null>(null);

  const setStatus = useCallback((status: UpdateStatus): void => {
    setState((prev) => ({ ...prev, status }));
  }, []);

  const setError = useCallback(
    (error: string | null): void => {
      setState((prev) => ({ ...prev, status: 'error', error }));
      if (error && onError) {
        onError(new Error(error));
      }
    },
    [onError]
  );

  /**
   * Check for available updates
   */
  const checkForUpdates = useCallback(
    async (options: CheckForUpdatesOptions = {}): Promise<void> => {
      const { showError = false } = options;
    try {
      setStatus('checking');

      const update = await check();

      if (update) {
        updateRef.current = update;
        const info: UpdateInfo = {
          version: update.version,
          date: update.date ?? new Date().toISOString(),
          body: update.body ?? 'No release notes available.',
          currentVersion: update.currentVersion,
        };

        setState({
          status: 'available',
          info,
          progress: 0,
          error: null,
        });

        onUpdateAvailable?.(info);
      } else {
        setState({
          status: 'not-available',
          info: null,
          progress: 0,
          error: null,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates';
      if (showError) {
        setError(message);
      } else {
        setState({
          status: 'not-available',
          info: null,
          progress: 0,
          error: null,
        });
      }
    }
    },
    [setStatus, setError, onUpdateAvailable]
  );

  /**
   * Download and prepare the update for installation
   */
  const downloadUpdate = useCallback(async (): Promise<void> => {
    const update = updateRef.current;
    if (!update) {
      setError('No update available to download');
      return;
    }

    try {
      setStatus('downloading');

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress': {
            downloaded += event.data.chunkLength;
            const progress =
              contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : 0;
            setState((prev) => ({ ...prev, progress }));
            break;
          }
          case 'Finished':
            setState((prev) => ({ ...prev, status: 'ready', progress: 100 }));
            break;
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download update';
      setError(message);
    }
  }, [setStatus, setError]);

  /**
   * Restart the application to install the update
   */
  const installUpdate = useCallback(async (): Promise<void> => {
    try {
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to restart application';
      setError(message);
    }
  }, [setError]);

  /**
   * Dismiss the update notification and reset state
   */
  const dismissUpdate = useCallback((): void => {
    setState(INITIAL_STATE);
    updateRef.current = null;
  }, []);

  // Check on mount with a small delay to let the app initialize
  useEffect(() => {
    if (checkOnMount) {
      const timeout = setTimeout(() => {
        checkForUpdates();
      }, INITIAL_CHECK_DELAY);

      return (): void => {
        clearTimeout(timeout);
      };
    }
  }, [checkOnMount, checkForUpdates]);

  // Set up periodic checks
  useEffect(() => {
    if (resolvedCheckInterval > 0) {
      intervalRef.current = window.setInterval(checkForUpdates, resolvedCheckInterval);

      return (): void => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [checkForUpdates, resolvedCheckInterval]);

  return {
    state,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
  };
}
