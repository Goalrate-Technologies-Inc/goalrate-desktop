import * as React from 'react';
import { cn } from '../utils/cn';
import { Avatar, AvatarImage, AvatarFallback } from '../data-display/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '../overlay/tooltip';

// ============================================================================
// TYPES
// ============================================================================

export interface EntityViewerData {
  userId: string;
  username: string;
  avatarUrl?: string;
  startedAt: Date;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatViewingDuration(startedAt: Date): string {
  const now = new Date();
  const diff = now.getTime() - startedAt.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return 'Just started';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface EntityViewersProps extends React.HTMLAttributes<HTMLDivElement> {
  /** List of users viewing this entity */
  viewers: EntityViewerData[];
  /** Maximum avatars to show before overflow */
  maxVisible?: number;
  /** Label text (e.g., "Viewing", "Also viewing") */
  label?: string;
  /** Show label text */
  showLabel?: boolean;
  /** Avatar size */
  size?: 'sm' | 'md';
}

/**
 * Compact indicator showing who is viewing the current entity.
 *
 * @example
 * ```tsx
 * <EntityViewers viewers={viewerList} />
 * <EntityViewers viewers={viewers} label="Also viewing" showLabel />
 * <EntityViewers viewers={viewers} maxVisible={5} />
 * ```
 */
export function EntityViewers({
  viewers,
  maxVisible = 4,
  label = 'Viewing',
  showLabel = false,
  size = 'sm',
  className,
  ...props
}: EntityViewersProps): React.JSX.Element | null {
  // Don't render if no viewers
  if (viewers.length === 0) {
    return null;
  }

  const visibleViewers = viewers.slice(0, maxVisible);
  const hiddenCount = viewers.length - maxVisible;

  const avatarSize = size === 'sm' ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn('inline-flex items-center gap-2', className)}
          role="status"
          aria-label={`${viewers.length} ${viewers.length === 1 ? 'person' : 'people'} viewing`}
          {...props}
        >
          {showLabel && (
            <span className="text-xs text-muted-foreground">{label}</span>
          )}
          <div className="flex items-center -space-x-1.5">
            {visibleViewers.map((viewer) => (
              <Avatar
                key={viewer.userId}
                className={cn(
                  avatarSize,
                  'ring-2 ring-background border border-blue-200'
                )}
              >
                {viewer.avatarUrl && (
                  <AvatarImage src={viewer.avatarUrl} alt={viewer.username} />
                )}
                <AvatarFallback userName={viewer.username} />
              </Avatar>
            ))}
            {hiddenCount > 0 && (
              <div
                className={cn(
                  avatarSize,
                  'rounded-full bg-muted flex items-center justify-center',
                  'ring-2 ring-background',
                  'font-medium text-muted-foreground'
                )}
              >
                +{hiddenCount}
              </div>
            )}
          </div>
          <EyeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="text-sm">
        <div className="space-y-1.5">
          <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
            {viewers.length} {viewers.length === 1 ? 'person' : 'people'} viewing
          </p>
          <ul className="space-y-1">
            {viewers.map((viewer) => (
              <li key={viewer.userId} className="flex items-center gap-2">
                <Avatar className="h-5 w-5 text-[10px]">
                  {viewer.avatarUrl && (
                    <AvatarImage src={viewer.avatarUrl} alt={viewer.username} />
                  )}
                  <AvatarFallback userName={viewer.username} />
                </Avatar>
                <span>{viewer.username}</span>
                <span className="text-muted-foreground text-xs">
                  {formatViewingDuration(viewer.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function EyeIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
