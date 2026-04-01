import * as React from 'react';
import type { FocusItem } from '@goalrate-app/shared';
import { Target, Layers } from 'lucide-react';
import { Card, CardContent } from '../primitives/card';
import { Badge } from '../feedback/badge';
import { CompletionRing } from '../feedback/CompletionRing';
import { FocusItemActions } from './FocusItemActions';
import { cn } from '../utils';

export interface FocusItemCardProps {
  item: FocusItem;
  onComplete: (itemSource: string) => void;
  onDefer: (itemSource: string, toDate: string) => void;
  showScore?: boolean;
  variant?: 'card' | 'compact';
  isCompleting?: boolean;
  isDeferring?: boolean;
  className?: string;
}

/**
 * FocusItemCard - Displays a single focus item
 * Supports card (full) and compact (minimal) variants
 */
export function FocusItemCard({
  item,
  onComplete,
  onDefer,
  showScore = false,
  variant = 'card',
  isCompleting = false,
  isDeferring = false,
  className,
}: FocusItemCardProps): React.ReactElement {
  const isCompleted = item.status === 'done';
  const isGoalTask = item.type === 'goal_task';

  // Format completion time if available
  const completionTime = React.useMemo(() => {
    if (!item.completedAt) {
      return null;
    }
    const date = new Date(item.completedAt);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [item.completedAt]);

  const [shouldAnimateCompletion, setShouldAnimateCompletion] = React.useState(false);

  React.useEffect(() => {
    if (!item.completedAt || typeof window === 'undefined') {
      setShouldAnimateCompletion(false);
      return;
    }
    const completedAt = new Date(item.completedAt).getTime();
    const delta = Date.now() - completedAt;
    if (delta < 0 || delta >= 4000) {
      setShouldAnimateCompletion(false);
      return;
    }
    setShouldAnimateCompletion(true);
    const timeout = window.setTimeout(() => {
      setShouldAnimateCompletion(false);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [item.completedAt]);

  // Render compact variant for completed items
  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex items-center justify-between py-2 px-3 rounded-md',
          isCompleted && 'bg-gray-50',
          className
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {isCompleted && (
            <CompletionRing size={18} animate={shouldAnimateCompletion} />
          )}
          <span
            className={cn(
              'text-sm truncate',
              isCompleted && 'text-gray-500 line-through'
            )}
          >
            {item.title}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-400">
            {item.points}pt{item.points !== 1 ? 's' : ''}
          </span>
          {completionTime && (
            <span className="text-xs text-gray-400">{completionTime}</span>
          )}
        </div>
      </div>
    );
  }

  // Render card variant for pending/in-progress items
  return (
    <Card
      className={cn(
        'transition-all duration-200',
        isGoalTask
          ? 'border-l-4 border-l-purple-500 hover:shadow-md'
          : 'border-l-4 border-l-blue-500 hover:shadow-md',
        className
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Header with type icon and title */}
            <div className="flex items-center gap-2 mb-1">
              {isGoalTask ? (
                <Target className="h-4 w-4 text-purple-500 flex-shrink-0" />
              ) : (
                <Layers className="h-4 w-4 text-blue-500 flex-shrink-0" />
              )}
              <h4 className="font-medium text-gray-900 truncate">
                {item.title}
              </h4>
            </div>

            {/* Context (goal/project name) */}
            {(item.goalTitle || item.projectTitle) && (
              <p className="text-xs text-gray-500 mb-2 truncate">
                {item.goalTitle || item.projectTitle}
              </p>
            )}

            {/* Reason */}
            <p className="text-sm text-gray-600 mb-3">{item.reason}</p>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {item.points} pt{item.points !== 1 ? 's' : ''}
              </Badge>
              {showScore && (
                <Badge variant="secondary" className="text-xs">
                  Score: {item.score}
                </Badge>
              )}
              <Badge
                variant={
                  item.type === 'goal_task'
                    ? 'default'
                    : 'outline'
                }
                className={cn(
                  'text-xs',
                  item.type === 'goal_task'
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-100'
                    : 'border-blue-200 text-blue-700'
                )}
              >
                {item.type === 'goal_task' ? 'Goal' : 'Story'}
              </Badge>
            </div>
          </div>

          {/* Actions */}
          <div className="flex-shrink-0">
            <FocusItemActions
              itemSource={item.source}
              onComplete={onComplete}
              onDefer={onDefer}
              isCompleting={isCompleting}
              isDeferring={isDeferring}
              size="default"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
