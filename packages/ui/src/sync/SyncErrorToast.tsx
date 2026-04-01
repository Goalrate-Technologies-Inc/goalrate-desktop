import * as React from 'react';
import { cn } from '../utils/cn';

// ============================================================================
// ICONS
// ============================================================================

const AlertCircleIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-red-500"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const RefreshIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const XIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ============================================================================
// COMPONENT
// ============================================================================

export interface SyncErrorToastProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Error message to display */
  message: string;
  /** Error reason/code */
  reason?: 'conflict' | 'validation' | 'permission' | 'not_found' | string;
  /** Entity type that failed to sync */
  entityType?: string;
  /** Callback when retry is clicked */
  onRetry?: () => void;
  /** Callback when dismiss is clicked */
  onDismiss?: () => void;
  /** Whether retry is in progress */
  isRetrying?: boolean;
  /** Auto-dismiss after this many milliseconds (0 = no auto-dismiss) */
  autoDismiss?: number;
}

/**
 * Toast notification for sync errors with retry action
 *
 * @example
 * ```tsx
 * <SyncErrorToast
 *   message="Failed to save changes"
 *   reason="conflict"
 *   entityType="project"
 *   onRetry={() => retrySync()}
 *   onDismiss={() => setError(null)}
 * />
 * ```
 */
export function SyncErrorToast({
  message,
  reason,
  entityType,
  onRetry,
  onDismiss,
  isRetrying = false,
  autoDismiss = 0,
  className,
  ...props
}: SyncErrorToastProps): React.JSX.Element {
  // Auto-dismiss timer
  React.useEffect(() => {
    if (autoDismiss > 0 && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, autoDismiss);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [autoDismiss, onDismiss]);

  // Get human-readable reason
  const reasonText = React.useMemo(() => {
    switch (reason) {
      case 'conflict':
        return 'Another user made changes';
      case 'validation':
        return 'Invalid data';
      case 'permission':
        return 'Permission denied';
      case 'not_found':
        return 'Item not found';
      default:
        return reason || 'Unknown error';
    }
  }, [reason]);

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 shadow-lg dark:border-red-800 dark:bg-red-950',
        className,
      )}
      role="alert"
      aria-live="assertive"
      {...props}
    >
      <div className="flex-shrink-0 pt-0.5">
        <AlertCircleIcon />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">
          Sync failed
          {entityType && <span className="font-normal text-red-600 dark:text-red-400"> ({entityType})</span>}
        </p>
        <p className="mt-1 text-sm text-red-700 dark:text-red-300 truncate" title={message}>
          {message}
        </p>
        {reason && (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">
            Reason: {reasonText}
          </p>
        )}

        {/* Actions */}
        {(onRetry || onDismiss) && (
          <div className="mt-3 flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                  'bg-red-100 text-red-800 hover:bg-red-200',
                  'dark:bg-red-900/50 dark:text-red-200 dark:hover:bg-red-900',
                  'focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                  isRetrying && 'cursor-wait',
                )}
              >
                <RefreshIcon />
                {isRetrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
          </div>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            'flex-shrink-0 rounded-md p-1',
            'text-red-400 hover:text-red-600 hover:bg-red-100',
            'dark:hover:bg-red-900 dark:hover:text-red-300',
            'focus:outline-none focus:ring-2 focus:ring-red-500',
          )}
          aria-label="Dismiss"
        >
          <XIcon />
        </button>
      )}
    </div>
  );
}
