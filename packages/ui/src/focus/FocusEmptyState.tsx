import * as React from 'react';
import { Button } from '../primitives/button';
import { cn } from '../utils';

export type FocusEmptyStateType =
  | 'no-candidates'
  | 'not-generated'
  | 'all-completed';

export interface FocusEmptyStateProps {
  type: FocusEmptyStateType;
  className?: string;
  onGenerate?: () => void;
}

const EMPTY_STATE_CONTENT: Record<
  FocusEmptyStateType,
  { icon: string; title: string; description: string }
> = {
  'no-candidates': {
    icon: '🎯',
    title: 'No tasks available',
    description:
      'All your tasks are either completed or not ready for focus. Add new tasks to your goals or projects to get started.',
  },
  'not-generated': {
    icon: '✨',
    title: 'Ready to focus?',
    description:
      'Generate your focus list to see your prioritized tasks for today based on deadlines, priorities, and blockers.',
  },
  'all-completed': {
    icon: '🎉',
    title: 'All done for today!',
    description:
      'Amazing work! You\'ve completed all your focus items. Take a well-deserved break or add more tasks if you\'re feeling productive.',
  },
};

/**
 * FocusEmptyState - Displays a friendly message when no focus items exist
 */
export function FocusEmptyState({
  type,
  className,
  onGenerate,
}: FocusEmptyStateProps): React.ReactElement {
  const content = EMPTY_STATE_CONTENT[type];

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-12 px-6 text-center',
        className
      )}
    >
      <span className="text-5xl mb-4" role="img" aria-label={content.title}>
        {content.icon}
      </span>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {content.title}
      </h3>
      <p className="text-sm text-gray-500 max-w-sm mb-6">{content.description}</p>
      {type === 'not-generated' && onGenerate && (
        <Button onClick={onGenerate} variant="goals" size="sm">
          Generate Focus List
        </Button>
      )}
    </div>
  );
}
