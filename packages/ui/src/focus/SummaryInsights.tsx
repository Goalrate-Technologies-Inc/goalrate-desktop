import * as React from 'react';
import type { SummaryInsight } from '@goalrate-app/shared';
import { Flame, Trophy, BarChart3, Star } from 'lucide-react';
import { cn } from '../utils';

export interface SummaryInsightsProps {
  insights: SummaryInsight[];
  className?: string;
}

const iconMap: Record<NonNullable<SummaryInsight['icon']>, React.ReactNode> = {
  fire: <Flame className="h-4 w-4" />,
  trophy: <Trophy className="h-4 w-4" />,
  chart: <BarChart3 className="h-4 w-4" />,
  star: <Star className="h-4 w-4" />,
};

const typeStyles: Record<SummaryInsight['type'], { bg: string; text: string; border: string }> = {
  streak: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
  },
  achievement: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-200',
  },
  comparison: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
  },
  encouragement: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
  },
};

/**
 * SummaryInsights - Displays motivational insights for the end-of-day summary
 */
export function SummaryInsights({
  insights,
  className,
}: SummaryInsightsProps): React.ReactElement {
  if (insights.length === 0) {
    return <></>;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {insights.map((insight, index) => {
        const styles = typeStyles[insight.type];
        const icon = insight.icon ? iconMap[insight.icon] : null;

        return (
          <div
            key={`${insight.type}-${index}`}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg border',
              styles.bg,
              styles.border
            )}
          >
            {icon && (
              <span className={cn('flex-shrink-0', styles.text)}>
                {icon}
              </span>
            )}
            <p className={cn('text-sm font-medium', styles.text)}>
              {insight.message}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * StreakBadge - Standalone streak display for use outside insights
 */
export interface StreakBadgeProps {
  days: number;
  isRecord?: boolean;
  className?: string;
}

export function StreakBadge({
  days,
  isRecord = false,
  className,
}: StreakBadgeProps): React.ReactElement {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-full',
        isRecord
          ? 'bg-gradient-to-r from-orange-400 to-red-500 text-white'
          : 'bg-orange-100 text-orange-700',
        className
      )}
    >
      <Flame className="h-4 w-4" />
      <span className="text-sm font-semibold">
        {days} day{days !== 1 ? 's' : ''}
      </span>
      {isRecord && (
        <span className="text-xs opacity-90">Best!</span>
      )}
    </div>
  );
}
