import * as React from 'react';
import type { FocusVelocity, VelocityTrendDirection } from '@goalrate-app/shared';
import { ChevronDown, ChevronUp, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card';
import { Button } from '../primitives/button';
import { VelocityStats } from './VelocityStats';
import { VelocityTrendChart } from './VelocityTrendChart';
import { cn } from '../utils';

export interface VelocityCardProps {
  velocity: FocusVelocity;
  trend?: VelocityTrendDirection;
  defaultExpanded?: boolean;
  collapsible?: boolean;
  title?: string;
  className?: string;
}

/**
 * VelocityCard - Expandable card showing velocity stats and trend chart
 * Provides a comprehensive view of focus velocity metrics
 */
export function VelocityCard({
  velocity,
  trend,
  defaultExpanded = false,
  collapsible = true,
  title = 'Your Velocity',
  className,
}: VelocityCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  const toggleExpanded = (): void => {
    if (collapsible) {
      setIsExpanded(!isExpanded);
    }
  };

  // Check if there's meaningful data to show
  const hasData = velocity.totalDaysTracked > 0;

  if (!hasData) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-gray-400" />
            <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500">
            Complete some focus items to see your velocity stats!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-gray-400" />
            <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
          </div>
          {collapsible && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleExpanded}
              className="h-6 w-6 p-0"
              aria-label={isExpanded ? 'Collapse velocity details' : 'Expand velocity details'}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Always show compact stats when collapsed */}
        {!isExpanded && (
          <VelocityStats velocity={velocity} trend={trend} compact />
        )}

        {/* Show expanded stats and chart when expanded */}
        {isExpanded && (
          <>
            <VelocityStats velocity={velocity} trend={trend} />

            <div className="pt-2 border-t">
              <h4 className="text-xs text-gray-500 uppercase tracking-wide mb-3">
                Last 7 Days
              </h4>
              <VelocityTrendChart
                data={velocity.weeklyTrend}
                height={100}
                showAverage
              />
            </div>

            {/* Additional context */}
            <div className="pt-2 text-xs text-gray-400">
              Based on {velocity.totalDaysTracked} day{velocity.totalDaysTracked !== 1 ? 's' : ''} of tracking
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default VelocityCard;
