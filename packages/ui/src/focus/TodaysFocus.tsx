import * as React from 'react';
import type { FocusDay, FocusVelocity, FocusItem, FocusMood, SummaryInsight, VelocityTrendDirection } from '@goalrate-app/shared';
import { RefreshCw, Loader2, ClipboardList, Flame, CalendarDays } from 'lucide-react';
import { Button } from '../primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card';
import { Skeleton } from '../feedback/skeleton';
import { FocusProgress } from './FocusProgress';
import { FocusItemCard } from './FocusItemCard';
import { FocusEmptyState } from './FocusEmptyState';
import { EndOfDaySummary } from './EndOfDaySummary';
import { VelocityStats } from './VelocityStats';
import { cn } from '../utils';

export interface TodaysFocusProps {
  focusDay: FocusDay | null;
  loading?: boolean;
  showSkeleton?: boolean;
  onComplete: (itemSource: string) => void;
  onDefer: (itemSource: string, toDate: string) => void;
  onRefresh?: () => void;
  onGenerate?: () => void;
  showVelocity?: boolean;
  velocity?: FocusVelocity;
  velocityTrend?: VelocityTrendDirection;
  completingItems?: string[];
  deferringItems?: string[];
  className?: string;
  // Summary view props
  showSummary?: boolean;
  onShowSummary?: () => void;
  onHideSummary?: () => void;
  summaryInsights?: SummaryInsight[];
  onMoodChange?: (mood: FocusMood) => void;
  onReflectionChange?: (reflection: string) => void;
  onSaveSummary?: () => void;
  isSavingSummary?: boolean;
}

/**
 * TodaysFocus - Main container for the Today's Focus view
 * Displays prioritized tasks with hybrid layout (cards for pending, compact for completed)
 */
export function TodaysFocus({
  focusDay,
  loading = false,
  showSkeleton = true,
  onComplete,
  onDefer,
  onRefresh,
  onGenerate,
  showVelocity = false,
  velocity,
  velocityTrend,
  completingItems = [],
  deferringItems = [],
  className,
  // Summary props
  showSummary = false,
  onShowSummary,
  onHideSummary,
  summaryInsights = [],
  onMoodChange,
  onReflectionChange,
  onSaveSummary,
  isSavingSummary = false,
}: TodaysFocusProps): React.ReactElement | null {
  const weeklyTrend = velocity?.weeklyTrend ?? [];
  const weeklyActiveDays = weeklyTrend.filter((value) => value > 0).length;

  // Format today's date
  const formattedDate = React.useMemo(() => {
    const today = new Date();
    return today.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  // Split items into pending and completed
  const { pendingItems, completedItems } = React.useMemo(() => {
    if (!focusDay?.items) {
      return { pendingItems: [], completedItems: [] };
    }

    const pending: FocusItem[] = [];
    const completed: FocusItem[] = [];

    for (const item of focusDay.items) {
      if (item.status === 'done') {
        completed.push(item);
      } else {
        pending.push(item);
      }
    }

    // Sort completed by completedAt descending (most recent first)
    completed.sort((a, b) => {
      if (!a.completedAt || !b.completedAt) {
        return 0;
      }
      return new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime();
    });

    return { pendingItems: pending, completedItems: completed };
  }, [focusDay?.items]);

  const streakVisualization = velocity ? (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1">
        <Flame className="h-3.5 w-3.5 text-orange-500" />
        <span className="font-semibold text-foreground">
          {velocity.currentStreak}
        </span>
        <span>day streak</span>
      </div>
      {weeklyTrend.length === 7 && (
        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1">
          <CalendarDays className="h-3.5 w-3.5 text-sky-500" />
          <div className="flex items-center gap-1">
            {weeklyTrend.map((value, index) => (
              <span
                key={`weekly-${index}`}
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  value > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                )}
              />
            ))}
          </div>
          <span className="font-semibold text-foreground">
            {weeklyActiveDays}/7
          </span>
          <span>days</span>
        </div>
      )}
    </div>
  ) : null;

  // Loading skeleton
  if (loading) {
    if (!showSkeleton) {
      return null;
    }
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-8 w-8" />
          </div>
          <Skeleton className="h-4 w-48 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Empty state when no focus day exists
  if (!focusDay) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl">Today&apos;s Focus</CardTitle>
          </div>
          <p className="text-sm text-gray-500">{formattedDate}</p>
          {streakVisualization}
        </CardHeader>
        <CardContent>
          <FocusEmptyState type="not-generated" onGenerate={onGenerate} />
        </CardContent>
      </Card>
    );
  }

  // Check if all items completed
  const allCompleted = focusDay.items.length > 0 && pendingItems.length === 0;

  // Check if no candidates (empty items)
  const noCandidates = focusDay.items.length === 0;

  // Show summary view if requested
  if (showSummary && focusDay) {
    return (
      <EndOfDaySummary
        focusDay={focusDay}
        velocity={velocity}
        insights={summaryInsights}
        onMoodChange={onMoodChange}
        onReflectionChange={onReflectionChange}
        onSave={onSaveSummary}
        onBack={onHideSummary}
        isSaving={isSavingSummary}
        className={className}
      />
    );
  }

  return (
    <Card className={cn('w-full', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Today&apos;s Focus</CardTitle>
          <div className="flex items-center gap-2">
            {/* View Summary button - show when there are items */}
            {onShowSummary && focusDay.items.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onShowSummary}
                className="h-8 text-xs"
                title="View daily summary"
              >
                <ClipboardList className="h-3.5 w-3.5 mr-1" />
                Summary
              </Button>
            )}
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                disabled={loading}
                className="h-8 w-8 p-0"
                title="Refresh focus list"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-500">{formattedDate}</p>
        {streakVisualization}
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Progress bar */}
        <FocusProgress
          plannedPoints={focusDay.plannedPoints}
          completedPoints={focusDay.completedPoints}
          totalItems={focusDay.items.length}
          completedItems={focusDay.completedItems}
        />

        {/* Velocity stats (optional) */}
        {showVelocity && velocity && (
          <div className="border-t pt-4">
            <VelocityStats
              velocity={velocity}
              trend={velocityTrend}
              compact
            />
          </div>
        )}

        {/* Empty states */}
        {noCandidates && <FocusEmptyState type="no-candidates" />}
        {allCompleted && !noCandidates && (
          <FocusEmptyState type="all-completed" />
        )}

        {/* Pending items (card layout) */}
        {pendingItems.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-700 uppercase tracking-wide">
              To Do ({pendingItems.length})
            </h3>
            <div className="space-y-3">
              {pendingItems.map((item) => (
                <FocusItemCard
                  key={item.source}
                  item={item}
                  variant="card"
                  onComplete={onComplete}
                  onDefer={onDefer}
                  isCompleting={completingItems.includes(item.source)}
                  isDeferring={deferringItems.includes(item.source)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Completed items (compact layout) */}
        {completedItems.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
              Completed ({completedItems.length})
            </h3>
            <div className="divide-y divide-gray-100">
              {completedItems.map((item) => (
                <FocusItemCard
                  key={item.source}
                  item={item}
                  variant="compact"
                  onComplete={onComplete}
                  onDefer={onDefer}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
