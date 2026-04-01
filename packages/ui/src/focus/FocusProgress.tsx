import * as React from 'react';
import { Progress } from '../feedback/progress';
import { cn } from '../utils';

export interface FocusProgressProps {
  plannedPoints: number;
  completedPoints: number;
  totalItems: number;
  completedItems: number;
  className?: string;
}

/**
 * FocusProgress - Visual indicator of daily focus progress
 * Shows points completed vs planned with a progress bar
 */
export function FocusProgress({
  plannedPoints,
  completedPoints,
  totalItems,
  completedItems,
  className,
}: FocusProgressProps): React.ReactElement {
  const percentage = plannedPoints > 0
    ? Math.round((completedPoints / plannedPoints) * 100)
    : 0;

  // Determine variant based on completion percentage
  // default (0-33%) -> warning (34-66%) -> success (67-100%)
  const getProgressVariant = (): 'default' | 'warning' | 'success' => {
    if (percentage >= 67) {
      return 'success';
    }
    if (percentage >= 34) {
      return 'warning';
    }
    return 'default';
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-gray-700">
          Progress: {completedPoints}/{plannedPoints} points ({percentage}%)
        </span>
        <span className="text-gray-500">
          {completedItems}/{totalItems} items
        </span>
      </div>
      <Progress
        value={percentage}
        variant={getProgressVariant()}
        className="h-2"
      />
    </div>
  );
}
