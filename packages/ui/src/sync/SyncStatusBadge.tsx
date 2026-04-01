import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';
import type { SyncStatus } from '@goalrate-app/shared';

// ============================================================================
// ICONS
// ============================================================================

const CheckIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="sync-icon"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SpinnerIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="sync-icon animate-spin"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

const ClockIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="sync-icon"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const AlertIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="sync-icon"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const CloudOffIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="sync-icon"
  >
    <line x1="2" y1="2" x2="22" y2="22" />
    <path d="M5 5a9 9 0 0 0 3.5 17h5c2.91 0 5.43-1.67 6.68-4.1" />
    <path d="M21 15.92V15a7 7 0 0 0-9.46-6.58" />
  </svg>
);

// ============================================================================
// STATUS CONFIGURATION
// ============================================================================

const STATUS_CONFIG: Record<
  SyncStatus,
  { icon: React.ComponentType; label: string; variant: 'synced' | 'syncing' | 'pending' | 'error' | 'offline' }
> = {
  synced: { icon: CheckIcon, label: 'Saved', variant: 'synced' },
  syncing: { icon: SpinnerIcon, label: 'Saving...', variant: 'syncing' },
  pending: { icon: ClockIcon, label: 'Pending', variant: 'pending' },
  error: { icon: AlertIcon, label: 'Error', variant: 'error' },
  offline: { icon: CloudOffIcon, label: 'Offline', variant: 'offline' },
};

// ============================================================================
// STYLES
// ============================================================================

const syncStatusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        synced: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        syncing: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
        pending: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
        error: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        offline: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2 py-0.5 text-xs',
      },
    },
    defaultVariants: {
      variant: 'synced',
      size: 'md',
    },
  },
);

// ============================================================================
// COMPONENT
// ============================================================================

export interface SyncStatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    Omit<VariantProps<typeof syncStatusBadgeVariants>, 'variant'> {
  /** Current sync status */
  status: SyncStatus;
  /** Last sync timestamp */
  lastSyncAt?: Date | null;
  /** Show timestamp in tooltip */
  showTimestamp?: boolean;
  /** Show label text */
  showLabel?: boolean;
}

/**
 * Badge component showing sync status with icon
 *
 * @example
 * ```tsx
 * <SyncStatusBadge status="syncing" />
 * <SyncStatusBadge status="synced" lastSyncAt={new Date()} showTimestamp />
 * <SyncStatusBadge status="error" size="sm" />
 * ```
 */
export function SyncStatusBadge({
  status,
  lastSyncAt,
  showTimestamp = false,
  showLabel = true,
  size,
  className,
  ...props
}: SyncStatusBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  // Format timestamp
  const formattedTime = React.useMemo(() => {
    if (!lastSyncAt) {
      return null;
    }
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(lastSyncAt);
  }, [lastSyncAt]);

  // Build title for tooltip
  const title = React.useMemo(() => {
    if (!showTimestamp || !formattedTime) {
      return config.label;
    }
    return `${config.label} at ${formattedTime}`;
  }, [showTimestamp, formattedTime, config.label]);

  return (
    <div
      className={cn(syncStatusBadgeVariants({ variant: config.variant, size }), className)}
      title={title}
      role="status"
      aria-label={title}
      {...props}
    >
      <Icon />
      {showLabel && <span>{config.label}</span>}
    </div>
  );
}

export { syncStatusBadgeVariants };
