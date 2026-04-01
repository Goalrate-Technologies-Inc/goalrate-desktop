import * as React from 'react';
import { cn } from '../utils/cn';
import { Avatar, AvatarImage, AvatarFallback, type AvatarSize } from '../data-display/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '../overlay/tooltip';
import { PresenceIndicator, type PresenceStatus } from './PresenceIndicator';

// ============================================================================
// TYPES
// ============================================================================

export interface UserPresenceData {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: PresenceStatus;
  lastActivity?: Date;
}

// Map PresenceBadge sizes to Avatar sizes
const SIZE_MAP: Record<'sm' | 'md' | 'lg', AvatarSize> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

// Position of indicator relative to avatar
const INDICATOR_POSITION: Record<'sm' | 'md' | 'lg', string> = {
  sm: '-bottom-0.5 -right-0.5',
  md: '-bottom-0.5 -right-0.5',
  lg: '-bottom-1 -right-1',
};

// ============================================================================
// COMPONENT
// ============================================================================

export interface PresenceBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /** User presence data */
  user: UserPresenceData;
  /** Badge size */
  size?: 'sm' | 'md' | 'lg';
  /** Show username next to avatar */
  showName?: boolean;
  /** Show tooltip with full user info on hover */
  showTooltip?: boolean;
  /** Enable animation for online status */
  animated?: boolean;
}

/**
 * User avatar with presence status indicator overlay.
 *
 * @example
 * ```tsx
 * <PresenceBadge user={{ userId: '1', username: 'Alice', status: 'online' }} />
 * <PresenceBadge user={user} size="lg" showName />
 * <PresenceBadge user={user} showTooltip={false} />
 * ```
 */
export function PresenceBadge({
  user,
  size = 'md',
  showName = false,
  showTooltip = true,
  animated = true,
  className,
  ...props
}: PresenceBadgeProps): React.JSX.Element {
  const avatarSize = SIZE_MAP[size];
  const indicatorSize = size === 'lg' ? 'md' : 'sm';
  const indicatorPosition = INDICATOR_POSITION[size];

  // Format last activity for tooltip
  const lastActivityText = React.useMemo(() => {
    if (!user.lastActivity) {
      return null;
    }
    const now = new Date();
    const diff = now.getTime() - user.lastActivity.getTime();
    const minutes = Math.floor(diff / 60000);

    if (minutes < 1) {
      return 'Active now';
    }
    if (minutes < 60) {
      return `Active ${minutes}m ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `Active ${hours}h ago`;
    }

    return `Active ${Math.floor(hours / 24)}d ago`;
  }, [user.lastActivity]);

  const content = (
    <div className={cn('inline-flex items-center gap-2', className)} {...props}>
      <div className="relative">
        <Avatar size={avatarSize}>
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.username} />}
          <AvatarFallback userName={user.username} />
        </Avatar>
        <span
          className={cn(
            'absolute ring-2 ring-background rounded-full',
            indicatorPosition
          )}
        >
          <PresenceIndicator
            status={user.status}
            size={indicatorSize}
            animated={animated}
            showTooltip={false}
          />
        </span>
      </div>
      {showName && (
        <span className="text-sm font-medium text-foreground truncate">
          {user.username}
        </span>
      )}
    </div>
  );

  if (!showTooltip) {
    return content;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="top" className="text-sm">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{user.username}</span>
          <span className="text-muted-foreground capitalize">{user.status}</span>
          {lastActivityText && (
            <span className="text-muted-foreground text-xs">{lastActivityText}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
