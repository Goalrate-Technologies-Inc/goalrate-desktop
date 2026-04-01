/**
 * Summary Generation
 * End-of-day summary generation for focus review and reflection
 */

import type {
  FocusDay,
  FocusItem,
  FocusVelocity,
  EndOfDaySummaryData,
  SummaryInsight,
  FocusMood,
} from '@goalrate-app/shared';

// ============================================================================
// COMPLETION CALCULATION
// ============================================================================

/**
 * Calculate completion percentage from a focus day
 */
export function calculateCompletionPercentage(focusDay: FocusDay): number {
  if (focusDay.plannedPoints === 0) {
    return focusDay.completedItems > 0 ? 100 : 0;
  }
  return Math.round((focusDay.completedPoints / focusDay.plannedPoints) * 100);
}

/**
 * Count deferred items from a focus day
 */
export function countDeferredItems(focusDay: FocusDay): number {
  return focusDay.items.filter((item) => item.status === 'deferred').length;
}

/**
 * Get completed items from a focus day, sorted by completion time
 */
export function getCompletedItems(focusDay: FocusDay): FocusItem[] {
  return focusDay.items
    .filter((item) => item.status === 'done')
    .sort((a, b) => {
      if (!a.completedAt || !b.completedAt) {
        return 0;
      }
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });
}

/**
 * Get top N completed items by points
 */
export function getTopCompletedItems(focusDay: FocusDay, limit = 5): FocusItem[] {
  return focusDay.items
    .filter((item) => item.status === 'done')
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

// ============================================================================
// COMPARISON CALCULATION
// ============================================================================

/**
 * Calculate percentage difference from average
 * Returns positive number if above average, negative if below
 */
export function calculateComparisonToAverage(
  completedPoints: number,
  averagePointsPerDay: number
): number {
  if (averagePointsPerDay === 0) {
    return completedPoints > 0 ? 100 : 0;
  }
  return Math.round(((completedPoints - averagePointsPerDay) / averagePointsPerDay) * 100);
}

/**
 * Generate comparison insight text
 */
export function getComparisonInsight(
  todayCompleted: number,
  averagePerDay: number
): string {
  if (averagePerDay === 0) {
    return todayCompleted > 0
      ? "Great start! You completed your first tracked day."
      : "No points completed yet.";
  }

  const diff = calculateComparisonToAverage(todayCompleted, averagePerDay);

  if (diff >= 50) {
    return `Outstanding! ${diff}% above your daily average.`;
  } else if (diff >= 20) {
    return `Excellent work! ${diff}% above your average.`;
  } else if (diff >= 0) {
    return `Solid day! Right at or above your average.`;
  } else if (diff >= -20) {
    return `Slightly below average, but still productive.`;
  } else {
    return `Lower than usual, but tomorrow is a fresh start.`;
  }
}

// ============================================================================
// ENCOURAGEMENT GENERATION
// ============================================================================

/**
 * Generate encouragement message based on performance
 */
export function generateEncouragement(
  completionPercentage: number,
  streakDays?: number
): string {
  // Streak-based messages take priority for significant streaks
  if (streakDays && streakDays >= 7) {
    if (completionPercentage >= 80) {
      return `${streakDays}-day streak and crushing it! Keep the momentum going!`;
    }
    return `${streakDays} days strong! Every day counts.`;
  }

  if (streakDays && streakDays >= 3) {
    if (completionPercentage >= 80) {
      return `Building a great habit with ${streakDays} days in a row!`;
    }
  }

  // Completion-based messages
  if (completionPercentage >= 100) {
    return "Perfect day! You completed everything on your focus list.";
  } else if (completionPercentage >= 80) {
    return "Excellent work! You made serious progress today.";
  } else if (completionPercentage >= 60) {
    return "Good effort! You tackled the most important items.";
  } else if (completionPercentage >= 40) {
    return "Solid progress. Some days are harder than others.";
  } else if (completionPercentage >= 20) {
    return "You showed up and made progress. That matters.";
  } else if (completionPercentage > 0) {
    return "Every step forward counts. Rest up for tomorrow.";
  } else {
    return "Tomorrow is a new opportunity. You've got this!";
  }
}

// ============================================================================
// INSIGHTS GENERATION
// ============================================================================

/**
 * Generate all insights for the end-of-day summary
 */
export function generateSummaryInsights(
  focusDay: FocusDay,
  velocity?: FocusVelocity
): SummaryInsight[] {
  const insights: SummaryInsight[] = [];
  const completionPercentage = calculateCompletionPercentage(focusDay);

  // Achievement insight for perfect days
  if (completionPercentage >= 100) {
    insights.push({
      type: 'achievement',
      message: 'Perfect day! All planned items completed.',
      icon: 'trophy',
    });
  }

  // Streak insight
  if (velocity?.currentStreak && velocity.currentStreak >= 2) {
    insights.push({
      type: 'streak',
      message: `${velocity.currentStreak}-day streak! ${
        velocity.currentStreak >= velocity.longestStreak
          ? "That's your best streak yet!"
          : `Your record is ${velocity.longestStreak} days.`
      }`,
      icon: 'fire',
    });
  }

  // Comparison insight
  if (velocity?.averagePointsPerDay && velocity.averagePointsPerDay > 0) {
    const comparison = calculateComparisonToAverage(
      focusDay.completedPoints,
      velocity.averagePointsPerDay
    );

    if (comparison >= 20) {
      insights.push({
        type: 'comparison',
        message: `${comparison}% above your daily average!`,
        icon: 'chart',
      });
    }
  }

  // Encouragement (always show one)
  insights.push({
    type: 'encouragement',
    message: generateEncouragement(completionPercentage, velocity?.currentStreak),
    icon: 'star',
  });

  return insights;
}

// ============================================================================
// MAIN SUMMARY GENERATION
// ============================================================================

/**
 * Generate complete end-of-day summary data
 */
export function generateEndOfDaySummary(
  focusDay: FocusDay,
  velocity?: FocusVelocity
): EndOfDaySummaryData {
  const completionPercentage = calculateCompletionPercentage(focusDay);
  const deferredCount = countDeferredItems(focusDay);
  const topCompletedItems = getTopCompletedItems(focusDay, 5);

  const comparisonToAverage = velocity?.averagePointsPerDay
    ? calculateComparisonToAverage(focusDay.completedPoints, velocity.averagePointsPerDay)
    : undefined;

  return {
    date: focusDay.date,
    plannedPoints: focusDay.plannedPoints,
    completedPoints: focusDay.completedPoints,
    completionPercentage,
    completedItems: focusDay.completedItems,
    totalItems: focusDay.items.length,
    deferredCount,
    mood: focusDay.mood,
    reflection: focusDay.reflection,
    topCompletedItems,
    streakDays: velocity?.currentStreak,
    comparisonToAverage,
  };
}

/**
 * Update focus day with mood and reflection
 */
export function updateFocusDayReflection(
  focusDay: FocusDay,
  mood?: FocusMood,
  reflection?: string
): FocusDay {
  return {
    ...focusDay,
    mood: mood ?? focusDay.mood,
    reflection: reflection ?? focusDay.reflection,
  };
}

/**
 * Check if a focus day is ready for summary view
 * (all items completed or it's past a certain time)
 */
export function isSummaryReady(focusDay: FocusDay): boolean {
  // Summary is ready if all items are either done or deferred
  const activeItems = focusDay.items.filter(
    (item) => item.status === 'pending' || item.status === 'in_progress'
  );
  return activeItems.length === 0;
}

/**
 * Get suggested mood based on completion percentage
 */
export function suggestMood(completionPercentage: number): FocusMood {
  if (completionPercentage >= 90) {
    return 'great';
  }
  if (completionPercentage >= 70) {
    return 'good';
  }
  if (completionPercentage >= 40) {
    return 'okay';
  }
  return 'low';
}
