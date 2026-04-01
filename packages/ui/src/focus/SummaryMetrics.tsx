import * as React from 'react';
import { Check, Clock, FastForward, Target } from 'lucide-react';
import { Card, CardContent } from '../primitives/card';
import { cn } from '../utils';

export interface SummaryMetricsProps {
  completedPoints: number;
  plannedPoints: number;
  completedItems: number;
  totalItems: number;
  deferredCount?: number;
  completionPercentage: number;
  className?: string;
}

interface MetricCardProps {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string | number;
  subValue?: string;
}

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  subValue,
}: MetricCardProps): React.ReactElement {
  return (
    <Card className="bg-white">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'p-2 rounded-lg',
              iconColor
            )}
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wide">
              {label}
            </p>
            <p className="text-xl font-semibold text-gray-900">{value}</p>
            {subValue && (
              <p className="text-xs text-gray-500">{subValue}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * SummaryMetrics - Displays completion metrics in a card grid
 */
export function SummaryMetrics({
  completedPoints,
  plannedPoints,
  completedItems,
  totalItems,
  deferredCount = 0,
  completionPercentage,
  className,
}: SummaryMetricsProps): React.ReactElement {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-4', className)}>
      <MetricCard
        icon={<Target className="h-4 w-4 text-purple-600" />}
        iconColor="bg-purple-100"
        label="Points"
        value={`${completedPoints}/${plannedPoints}`}
        subValue={`${completionPercentage}% complete`}
      />
      <MetricCard
        icon={<Check className="h-4 w-4 text-green-600" />}
        iconColor="bg-green-100"
        label="Items"
        value={`${completedItems}/${totalItems}`}
        subValue="completed"
      />
      {deferredCount > 0 && (
        <MetricCard
          icon={<FastForward className="h-4 w-4 text-yellow-600" />}
          iconColor="bg-yellow-100"
          label="Deferred"
          value={deferredCount}
          subValue="moved to later"
        />
      )}
      <MetricCard
        icon={<Clock className="h-4 w-4 text-blue-600" />}
        iconColor="bg-blue-100"
        label="Rate"
        value={`${completionPercentage}%`}
        subValue="completion rate"
      />
    </div>
  );
}

/**
 * CompletionRing - Circular progress indicator for completion percentage
 */
export interface CompletionRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function CompletionRing({
  percentage,
  size = 120,
  strokeWidth = 8,
  className,
}: CompletionRingProps): React.ReactElement {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  // Determine color based on percentage
  const getColor = (): string => {
    if (percentage >= 80) {
      return 'text-green-500';
    }
    if (percentage >= 50) {
      return 'text-yellow-500';
    }
    return 'text-purple-500';
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-gray-200"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn('transition-all duration-500 ease-out', getColor())}
        />
      </svg>
      {/* Percentage text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{percentage}%</span>
      </div>
    </div>
  );
}
