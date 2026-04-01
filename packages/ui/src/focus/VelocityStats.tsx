import * as React from 'react';
import type { FocusVelocity, VelocityTrendDirection } from '@goalrate-app/shared';
import { Flame, TrendingUp, TrendingDown, Minus, Target, Calendar } from 'lucide-react';
import { cn } from '../utils';

export interface VelocityStatsProps {
  velocity: FocusVelocity;
  trend?: VelocityTrendDirection;
  compact?: boolean;
  showTrend?: boolean;
  className?: string;
}

/**
 * Determine trend direction from weekly trend data
 */
function getTrendFromWeeklyData(weeklyTrend: number[]): VelocityTrendDirection {
  if (weeklyTrend.length < 4) {
    return 'stable';
  }

  const midpoint = Math.floor(weeklyTrend.length / 2);
  const firstHalf = weeklyTrend.slice(0, midpoint);
  const secondHalf = weeklyTrend.slice(midpoint);

  const firstAvg = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length || 0;
  const secondAvg = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length || 0;

  if (firstAvg === 0 && secondAvg === 0) {
    return 'stable';
  }
  if (firstAvg === 0) {
    return secondAvg > 0 ? 'up' : 'stable';
  }

  const percentChange = ((secondAvg - firstAvg) / firstAvg) * 100;

  if (percentChange >= 10) {
    return 'up';
  }
  if (percentChange <= -10) {
    return 'down';
  }
  return 'stable';
}

/**
 * VelocityStats - Compact display of velocity metrics
 * Shows average points/day, completion rate, current streak, and trend
 */
export function VelocityStats({
  velocity,
  trend,
  compact = false,
  showTrend = true,
  className,
}: VelocityStatsProps): React.ReactElement {
  const calculatedTrend = trend ?? getTrendFromWeeklyData(velocity.weeklyTrend);

  const TrendIcon = calculatedTrend === 'up'
    ? TrendingUp
    : calculatedTrend === 'down'
      ? TrendingDown
      : Minus;

  const trendColor = calculatedTrend === 'up'
    ? 'text-green-600'
    : calculatedTrend === 'down'
      ? 'text-red-600'
      : 'text-gray-500';

  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-4 text-sm text-gray-600',
          className
        )}
      >
        <span className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-gray-400" />
          {velocity.averagePointsPerDay.toFixed(1)} pts/day
        </span>
        <span className="flex items-center gap-1.5">
          <Flame className={cn('h-3.5 w-3.5', velocity.currentStreak > 0 ? 'text-orange-500' : 'text-gray-400')} />
          {velocity.currentStreak} day{velocity.currentStreak !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
          {Math.round(velocity.averageCompletionRate)}%
        </span>
        {showTrend && (
          <span className={cn('flex items-center gap-1', trendColor)}>
            <TrendIcon className="h-3.5 w-3.5" />
            {calculatedTrend === 'up' ? 'Improving' : calculatedTrend === 'down' ? 'Slowing' : 'Steady'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-2 sm:grid-cols-4 gap-4', className)}>
      {/* Average Points */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide">
          <Target className="h-3 w-3" />
          Avg Points
        </div>
        <div className="text-xl font-semibold text-gray-900">
          {velocity.averagePointsPerDay.toFixed(1)}
          <span className="text-sm font-normal text-gray-500 ml-1">pts/day</span>
        </div>
      </div>

      {/* Completion Rate */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide">
          <Calendar className="h-3 w-3" />
          Completion
        </div>
        <div className="text-xl font-semibold text-gray-900">
          {Math.round(velocity.averageCompletionRate)}%
        </div>
      </div>

      {/* Current Streak */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide">
          <Flame className={cn('h-3 w-3', velocity.currentStreak > 0 ? 'text-orange-500' : '')} />
          Streak
        </div>
        <div className="text-xl font-semibold text-gray-900">
          {velocity.currentStreak}
          <span className="text-sm font-normal text-gray-500 ml-1">
            day{velocity.currentStreak !== 1 ? 's' : ''}
          </span>
          {velocity.longestStreak > velocity.currentStreak && (
            <span className="text-xs text-gray-400 ml-2">
              (best: {velocity.longestStreak})
            </span>
          )}
        </div>
      </div>

      {/* Trend */}
      {showTrend && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wide">
            <TrendIcon className={cn('h-3 w-3', trendColor)} />
            Trend
          </div>
          <div className={cn('text-xl font-semibold', trendColor)}>
            {calculatedTrend === 'up' ? 'Improving' : calculatedTrend === 'down' ? 'Slowing' : 'Steady'}
          </div>
        </div>
      )}
    </div>
  );
}

export default VelocityStats;
