import * as React from 'react';
import type {
  FocusDay,
  FocusVelocity,
  FocusMood,
  SummaryInsight,
  FocusItem,
} from '@goalrate-app/shared';
import { Calendar, ArrowLeft, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../primitives/card';
import { Button } from '../primitives/button';
import { Separator } from '../primitives/separator';
import { FocusItemCard } from './FocusItemCard';
import { MoodSelector } from './MoodSelector';
import { ReflectionInput } from './ReflectionInput';
import { SummaryMetrics, CompletionRing } from './SummaryMetrics';
import { SummaryInsights } from './SummaryInsights';
import { cn } from '../utils';

export interface EndOfDaySummaryProps {
  focusDay: FocusDay;
  velocity?: FocusVelocity;
  insights?: SummaryInsight[];
  onMoodChange?: (mood: FocusMood) => void;
  onReflectionChange?: (reflection: string) => void;
  onSave?: () => void;
  onBack?: () => void;
  isSaving?: boolean;
  className?: string;
}

/**
 * EndOfDaySummary - Main component for reviewing daily accomplishments
 */
export function EndOfDaySummary({
  focusDay,
  velocity,
  insights = [],
  onMoodChange,
  onReflectionChange,
  onSave,
  onBack,
  isSaving = false,
  className,
}: EndOfDaySummaryProps): React.ReactElement {
  // Local state for form values
  const [mood, setMood] = React.useState<FocusMood | undefined>(focusDay.mood);
  const [reflection, setReflection] = React.useState(focusDay.reflection ?? '');

  // Calculate metrics
  const completedItems = focusDay.items.filter((item) => item.status === 'done');
  const deferredCount = focusDay.items.filter((item) => item.status === 'deferred').length;
  const completionPercentage =
    focusDay.plannedPoints > 0
      ? Math.round((focusDay.completedPoints / focusDay.plannedPoints) * 100)
      : 0;

  // Format date for display
  const formattedDate = React.useMemo(() => {
    const date = new Date(focusDay.date);
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, [focusDay.date]);

  // Handle mood change
  const handleMoodChange = React.useCallback(
    (newMood: FocusMood): void => {
      setMood(newMood);
      onMoodChange?.(newMood);
    },
    [onMoodChange]
  );

  // Handle reflection change
  const handleReflectionChange = React.useCallback(
    (newReflection: string): void => {
      setReflection(newReflection);
      onReflectionChange?.(newReflection);
    },
    [onReflectionChange]
  );

  // Noop handlers for completed items (they can't be changed in summary)
  const noopComplete = React.useCallback((): void => {}, []);
  const noopDefer = React.useCallback((): void => {}, []);

  return (
    <div className={cn('space-y-6', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Summary</h1>
            <div className="flex items-center gap-2 text-gray-500">
              <Calendar className="h-4 w-4" />
              <span className="text-sm">{formattedDate}</span>
            </div>
          </div>
        </div>

        {onSave && (
          <Button
            onClick={onSave}
            disabled={isSaving}
            variant="goals"
          >
            {isSaving ? 'Saving...' : 'Save Summary'}
          </Button>
        )}
      </div>

      {/* Completion Ring and Metrics */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <CompletionRing
              percentage={completionPercentage}
              size={140}
              className="flex-shrink-0"
            />
            <div className="flex-1 w-full">
              <SummaryMetrics
                completedPoints={focusDay.completedPoints}
                plannedPoints={focusDay.plannedPoints}
                completedItems={focusDay.completedItems}
                totalItems={focusDay.items.length}
                deferredCount={deferredCount}
                completionPercentage={completionPercentage}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Insights */}
      {insights.length > 0 && (
        <SummaryInsights insights={insights} />
      )}

      {/* Completed Items */}
      {completedItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              Completed Today ({completedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {completedItems.map((item: FocusItem) => (
                <FocusItemCard
                  key={item.source}
                  item={item}
                  variant="compact"
                  onComplete={noopComplete}
                  onDefer={noopDefer}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reflection Section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">End of Day Reflection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <MoodSelector
            value={mood}
            onChange={handleMoodChange}
          />

          <Separator />

          <ReflectionInput
            value={reflection}
            onChange={handleReflectionChange}
          />
        </CardContent>
      </Card>

      {/* Velocity Stats (if available) */}
      {velocity && (
        <Card className="bg-gray-50">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-500 uppercase">Avg/Day</p>
                <p className="text-lg font-semibold">
                  {velocity.averagePointsPerDay.toFixed(1)} pts
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Completion</p>
                <p className="text-lg font-semibold">
                  {velocity.averageCompletionRate.toFixed(0)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Current Streak</p>
                <p className="text-lg font-semibold">
                  {velocity.currentStreak} day{velocity.currentStreak !== 1 ? 's' : ''}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">Best Streak</p>
                <p className="text-lg font-semibold">
                  {velocity.longestStreak} day{velocity.longestStreak !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
