import * as React from 'react';
import { cn } from '../utils/cn';
import { PresenceBadge, type UserPresenceData } from './PresenceBadge';

// ============================================================================
// HELPERS
// ============================================================================

function formatLastActivity(lastActivity?: Date): string | null {
  if (!lastActivity) {
    return null;
  }

  const now = new Date();
  const diff = now.getTime() - lastActivity.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return 'Active now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface UserPresenceRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** User presence data */
  user: UserPresenceData;
  /** Callback when message button is clicked */
  onMessage?: (userId: string) => void;
  /** Show last activity timestamp */
  showActivity?: boolean;
  /** Highlight this row (e.g., current user) */
  highlighted?: boolean;
}

/**
 * Single row item showing user presence in a list.
 *
 * @example
 * ```tsx
 * <UserPresenceRow user={user} />
 * <UserPresenceRow user={user} onMessage={(id) => openChat(id)} />
 * <UserPresenceRow user={user} highlighted showActivity />
 * ```
 */
export function UserPresenceRow({
  user,
  onMessage,
  showActivity = true,
  highlighted = false,
  className,
  ...props
}: UserPresenceRowProps): React.JSX.Element {
  const activityText = showActivity ? formatLastActivity(user.lastActivity) : null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
        'hover:bg-muted/50',
        highlighted && 'bg-muted/30',
        className
      )}
      {...props}
    >
      <PresenceBadge user={user} size="sm" showTooltip={false} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate">
            {user.username}
          </span>
          {highlighted && (
            <span className="text-xs text-muted-foreground">(you)</span>
          )}
        </div>
        {activityText && (
          <span className="text-xs text-muted-foreground">{activityText}</span>
        )}
      </div>

      {onMessage && user.status !== 'offline' && (
        <button
          type="button"
          onClick={() => onMessage(user.userId)}
          className={cn(
            'p-1.5 rounded-md text-muted-foreground',
            'hover:text-foreground hover:bg-muted',
            'transition-colors'
          )}
          title={`Message ${user.username}`}
          aria-label={`Send message to ${user.username}`}
        >
          <MessageIcon />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function MessageIcon(): React.JSX.Element {
  return (
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
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
