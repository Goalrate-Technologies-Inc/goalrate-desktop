import * as React from 'react';
import { cn } from '../utils/cn';
import { PresenceBadge, type UserPresenceData } from './PresenceBadge';
import { UserPresenceRow } from './UserPresenceRow';
import { Badge } from '../feedback/badge';

// ============================================================================
// COMPONENT
// ============================================================================

export interface OnlineUsersListProps extends React.HTMLAttributes<HTMLDivElement> {
  /** List of users with presence data */
  users: UserPresenceData[];
  /** Title for the section */
  title?: string;
  /** Maximum users to show when collapsed (shows avatars only) */
  maxVisible?: number;
  /** Current user ID (to highlight and show "(you)") */
  currentUserId?: string;
  /** Callback when a user is clicked */
  onUserClick?: (userId: string) => void;
  /** Callback for message button */
  onMessage?: (userId: string) => void;
  /** Start expanded (show full list) */
  defaultExpanded?: boolean;
  /** Show empty state when no users online */
  showEmptyState?: boolean;
}

/**
 * Collapsible list showing online users in a workspace.
 *
 * @example
 * ```tsx
 * <OnlineUsersList users={onlineUsers} title="Team Members" />
 * <OnlineUsersList users={users} currentUserId={me.id} onMessage={openChat} />
 * <OnlineUsersList users={users} maxVisible={5} defaultExpanded />
 * ```
 */
export function OnlineUsersList({
  users,
  title = 'Online',
  maxVisible = 5,
  currentUserId,
  onUserClick,
  onMessage,
  defaultExpanded = false,
  showEmptyState = true,
  className,
  ...props
}: OnlineUsersListProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  // Filter and sort users: online first, then current user
  const sortedUsers = React.useMemo(() => {
    const statusOrder: Record<string, number> = {
      online: 0,
      busy: 1,
      away: 2,
      offline: 3,
    };

    return [...users].sort((a, b) => {
      // Current user always first
      if (a.userId === currentUserId) {
        return -1;
      }
      if (b.userId === currentUserId) {
        return 1;
      }
      // Then by status
      return statusOrder[a.status] - statusOrder[b.status];
    });
  }, [users, currentUserId]);

  const onlineCount = users.filter((u) => u.status === 'online').length;
  const visibleUsers = expanded ? sortedUsers : sortedUsers.slice(0, maxVisible);
  const hiddenCount = sortedUsers.length - maxVisible;

  // Empty state
  if (users.length === 0 && showEmptyState) {
    return (
      <div className={cn('p-4 text-center', className)} {...props}>
        <p className="text-sm text-muted-foreground">No one online</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      {/* Header */}
      <div className="flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{title}</span>
          <Badge variant="secondary" className="text-xs">
            {onlineCount}
          </Badge>
        </div>
        {sortedUsers.length > maxVisible && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? 'Show less' : `+${hiddenCount} more`}
          </button>
        )}
      </div>

      {/* Collapsed view - Avatar stack */}
      {!expanded && sortedUsers.length > 0 && (
        <div className="px-3">
          <div className="flex items-center -space-x-2">
            {visibleUsers.map((user) => (
              <div
                key={user.userId}
                className="ring-2 ring-background rounded-full"
                onClick={() => onUserClick?.(user.userId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onUserClick?.(user.userId);
                  }
                }}
                role={onUserClick ? 'button' : undefined}
                tabIndex={onUserClick ? 0 : undefined}
              >
                <PresenceBadge user={user} size="sm" showTooltip />
              </div>
            ))}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn(
                  'h-8 w-8 rounded-full bg-muted flex items-center justify-center',
                  'text-xs font-medium text-muted-foreground',
                  'ring-2 ring-background',
                  'hover:bg-muted/80 transition-colors'
                )}
              >
                +{hiddenCount}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expanded view - Full list */}
      {expanded && (
        <div className="space-y-1">
          {sortedUsers.map((user) => (
            <UserPresenceRow
              key={user.userId}
              user={user}
              highlighted={user.userId === currentUserId}
              onMessage={onMessage}
              onClick={() => onUserClick?.(user.userId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
