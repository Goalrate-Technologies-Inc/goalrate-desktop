import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

// ============================================================================
// STATUS CONFIGURATION
// ============================================================================

export type PresenceStatus = 'online' | 'away' | 'busy' | 'offline';

const STATUS_COLORS: Record<PresenceStatus, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-500',
  busy: 'bg-red-500',
  offline: 'bg-gray-400',
};

const STATUS_LABELS: Record<PresenceStatus, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

// ============================================================================
// STYLES
// ============================================================================

const presenceIndicatorVariants = cva(
  'rounded-full flex-shrink-0',
  {
    variants: {
      size: {
        xs: 'h-2 w-2',
        sm: 'h-2.5 w-2.5',
        md: 'h-3 w-3',
        lg: 'h-3.5 w-3.5',
      },
      animated: {
        true: '',
        false: '',
      },
    },
    defaultVariants: {
      size: 'sm',
      animated: true,
    },
  }
);

// ============================================================================
// COMPONENT
// ============================================================================

export interface PresenceIndicatorProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    Omit<VariantProps<typeof presenceIndicatorVariants>, 'animated'> {
  /** User's presence status */
  status: PresenceStatus;
  /** Enable pulsing animation for online status */
  animated?: boolean;
  /** Show status label as title tooltip */
  showTooltip?: boolean;
}

/**
 * Small status dot indicator showing user presence.
 *
 * @example
 * ```tsx
 * <PresenceIndicator status="online" />
 * <PresenceIndicator status="away" size="md" />
 * <PresenceIndicator status="busy" animated={false} />
 * ```
 */
export function PresenceIndicator({
  status,
  size,
  animated = true,
  showTooltip = true,
  className,
  ...props
}: PresenceIndicatorProps): React.JSX.Element {
  const statusColor = STATUS_COLORS[status];
  const statusLabel = STATUS_LABELS[status];
  const shouldAnimate = animated && status === 'online';

  return (
    <span
      className={cn(
        presenceIndicatorVariants({ size }),
        statusColor,
        shouldAnimate && 'animate-pulse',
        className
      )}
      role="status"
      aria-label={statusLabel}
      title={showTooltip ? statusLabel : undefined}
      {...props}
    />
  );
}

export { presenceIndicatorVariants, STATUS_COLORS, STATUS_LABELS };
