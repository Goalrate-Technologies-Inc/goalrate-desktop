# @goalrate-app/core

Core business logic package for Goalrate. Contains platform-agnostic domain algorithms for focus generation, health tracking, task prioritization, and date utilities.

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/core": "workspace:*"
  }
}
```

## Quick Start

```typescript
// Import from main package
import {
  generateFocusDay,
  determineHealthStatus,
  classifyAndSort,
  calculateDaysUntilDue,
} from '@goalrate-app/core';

// Or import from specific modules
import { scoreFocusCandidate } from '@goalrate-app/core/focus';
import { getGoalHealthStatus } from '@goalrate-app/core/health';
import { groupByQuadrant } from '@goalrate-app/core/prioritization';
import { toISODateString } from '@goalrate-app/core/utils';
```

## API Reference

### Focus Module

The focus module handles Today's Focus generation - an intelligent daily task prioritization system.

#### Scoring Functions

```typescript
import { scoreFocusCandidate, scoreAllCandidates, getTopCandidates } from '@goalrate-app/core/focus';

// Score a single candidate
const result = scoreFocusCandidate(candidate, new Date());
// Returns: { candidate, score, breakdown }

// Score multiple candidates
const scored = scoreAllCandidates(candidates, new Date());

// Get top N candidates by score
const top5 = getTopCandidates(candidates, 5, new Date());
```

#### Generator Functions

```typescript
import {
  gatherCandidatesFromGoals,
  gatherCandidatesFromStories,
  generateFocusList,
  generateFocusDay,
  completeFocusItem,
  deferFocusItem,
} from '@goalrate-app/core/focus';

// Gather candidates from goals
const goalCandidates = gatherCandidatesFromGoals(goals, { includeCompleted: false });

// Gather candidates from stories
const storyCandidates = gatherCandidatesFromStories(stories, { sprintId: 'sprint_123' });

// Generate prioritized focus list
const focusList = generateFocusList(candidates, { pointCapacity: 15, today: new Date() });

// Generate complete FocusDay object
const focusDay = generateFocusDay(candidates, 6); // 6 hours available
// Returns: { id, date, items, plannedPoints, completedPoints, ... }

// Mark item as completed
const updated = completeFocusItem(focusDay, 'task_123');

// Defer item to another date
const deferred = deferFocusItem(focusDay, 'task_123', '2026-01-20');
```

#### Velocity Functions

```typescript
import {
  calculateVelocity,
  calculateAveragePointsPerDay,
  calculateCurrentStreak,
  calculateWeeklyTrend,
  determineTrendDirection,
  isHealthyVelocity,
} from '@goalrate-app/core/focus';

// Calculate full velocity metrics from history
const velocity = calculateVelocity(focusDays);
// Returns: { averagePointsPerDay, averageCompletionRate, currentStreak, longestStreak, ... }

// Calculate specific metrics
const avgPoints = calculateAveragePointsPerDay(focusDays);
const streak = calculateCurrentStreak(focusDays, new Date());
const weeklyTrend = calculateWeeklyTrend(focusDays); // Last 7 days

// Determine trend direction
const direction = determineTrendDirection(weeklyTrend); // 'up' | 'down' | 'stable'

// Check if velocity is healthy
const healthy = isHealthyVelocity(velocity); // boolean
```

#### Summary Functions

```typescript
import {
  generateEndOfDaySummary,
  calculateCompletionPercentage,
  generateSummaryInsights,
  suggestMood,
  isSummaryReady,
} from '@goalrate-app/core/focus';

// Generate end-of-day summary
const summary = generateEndOfDaySummary(focusDay, velocity);
// Returns: { completionPercentage, completedItems, deferredItems, insights, ... }

// Calculate completion percentage
const percentage = calculateCompletionPercentage(focusDay);

// Generate insights based on performance
const insights = generateSummaryInsights(focusDay, velocity);

// Suggest mood based on completion
const mood = suggestMood(percentage); // 'great' | 'good' | 'okay' | 'low'

// Check if all items are done/deferred
const ready = isSummaryReady(focusDay);
```

### Health Module

The health module tracks progress and determines health status for goals and projects.

#### Progress Functions

```typescript
import {
  calculateExpectedProgress,
  getDaysFromDeadline,
  isDeadlinePast,
  calculateProgressFromItems,
  calculateProgressFromPoints,
} from '@goalrate-app/core/health';

// Calculate expected progress based on timeline
const expected = calculateExpectedProgress(deadline, startDate, today);
// Returns: 0-100 percentage

// Get days until/past deadline
const days = getDaysFromDeadline(deadline, today);
// Positive = days remaining, Negative = days overdue

// Check if deadline has passed
const overdue = isDeadlinePast(deadline, today);

// Calculate progress from completed items
const progress = calculateProgressFromItems(completedCount, totalCount);

// Calculate progress from story points
const pointProgress = calculateProgressFromPoints(completedPoints, totalPoints);
```

#### Status Functions

```typescript
import {
  determineHealthStatus,
  getHealthStatusLabel,
  getHealthStatusColor,
  getGoalHealthStatus,
  getProjectHealthStatus,
} from '@goalrate-app/core/health';

// Determine health status (10 levels)
const status = determineHealthStatus(actualProgress, expectedProgress, deadline, today);
// Returns: 'completed' | 'aheadStrong' | 'ahead' | 'onTrack' | 'slightlyBehind' |
//          'behind' | 'atRisk' | 'critical' | 'overdue' | 'notStarted'

// Get human-readable label
const label = getHealthStatusLabel(status, progress);
// Returns: "45% - On track"

// Get semantic color key
const color = getHealthStatusColor(status);
// Returns: 'success' | 'warning' | 'danger' | 'muted' | 'info'

// Get full goal health status
const goalHealth = getGoalHealthStatus(goal, today);
// Returns: { status, color, label, progress, daysRemaining, ... }

// Get full project health status
const projectHealth = getProjectHealthStatus(board, today);
```

### Prioritization Module

The prioritization module implements Eisenhower Matrix classification for task prioritization.

#### Scoring Functions

```typescript
import {
  calculateUrgencyScore,
  calculateImportanceScore,
  calculatePriorityScore,
  getUrgencyLevel,
  getImportanceLevel,
} from '@goalrate-app/core/prioritization';

// Calculate urgency score (0-100)
const urgency = calculateUrgencyScore(daysUntilDue, thresholds);

// Calculate importance score (0-100)
const importance = calculateImportanceScore(item);

// Get urgency/importance levels
const urgencyLevel = getUrgencyLevel(urgencyScore); // 'critical' | 'high' | 'medium' | 'low'
const importanceLevel = getImportanceLevel(importanceScore);
```

#### Classification Functions

```typescript
import {
  determineQuadrant,
  classifyItem,
  classifyAndSort,
  groupByQuadrant,
  getTodaysFocusItems,
} from '@goalrate-app/core/prioritization';

// Determine Eisenhower quadrant
const quadrant = determineQuadrant(urgencyScore, importanceScore);
// Returns: 'do_first' | 'schedule' | 'delegate' | 'eliminate'

// Classify a single item
const classified = classifyItem(item, today);
// Returns: { ...item, urgency, importance, quadrant, priorityScore }

// Classify and sort multiple items
const sorted = classifyAndSort(items, { today, ascending: false });

// Group items by quadrant
const grouped = groupByQuadrant(classifiedItems);
// Returns: { do_first: [...], schedule: [...], delegate: [...], eliminate: [...] }

// Get items for today's focus
const focusItems = getTodaysFocusItems(items, 5); // Top 5 items
```

#### Converter Functions

```typescript
import {
  goalsToPrioritizable,
  storiesToPrioritizable,
  tasksToPrioritizable,
  dailyTasksToPrioritizable,
  combineEntities,
} from '@goalrate-app/core/prioritization';

// Convert different entity types to prioritizable format
const prioritizableGoals = goalsToPrioritizable(goals);
const prioritizableStories = storiesToPrioritizable(stories);
const prioritizableTasks = tasksToPrioritizable(tasks);

// Combine multiple entity types
const allItems = combineEntities([goals, stories, tasks]);
```

### Utils Module

The utils module provides date calculation helpers used across the application.

```typescript
import {
  normalizeToStartOfDay,
  daysBetween,
  parseDate,
  calculateDaysUntilDue,
  isOverdue,
  isDueToday,
  isDueWithin,
  toISODateString,
  formatDaysUntilDue,
} from '@goalrate-app/core/utils';

// Normalize date to midnight
const normalized = normalizeToStartOfDay(new Date());

// Calculate days between two dates
const days = daysBetween(startDate, endDate);

// Safely parse date string
const date = parseDate('2026-01-20'); // Returns Date or null

// Calculate days until due
const daysLeft = calculateDaysUntilDue('2026-01-25', new Date());

// Check deadline status
const overdue = isOverdue('2026-01-15', new Date());
const dueToday = isDueToday('2026-01-19', new Date());
const dueThisWeek = isDueWithin('2026-01-22', 7, new Date());

// Format date as ISO string (YYYY-MM-DD)
const isoDate = toISODateString(new Date()); // '2026-01-19'

// Format days until due for display
const display = formatDaysUntilDue(3); // 'in 3 days'
const overdueDisplay = formatDaysUntilDue(-2); // '2 days overdue'
```

## Package Structure

```
src/
├── index.ts              # Main entry - re-exports all modules
├── focus/                # Today's Focus algorithm
│   ├── index.ts          # Module exports
│   ├── generator.ts      # Focus list generation
│   ├── scoring.ts        # Candidate scoring
│   ├── reasons.ts        # Human-readable reasons
│   ├── velocity.ts       # Velocity calculations
│   └── summary.ts        # End-of-day summary
├── health/               # Progress tracking
│   ├── index.ts          # Module exports
│   ├── progress.ts       # Progress calculations
│   └── status.ts         # Health status determination
├── prioritization/       # Eisenhower Matrix
│   ├── index.ts          # Module exports
│   ├── eisenhower.ts     # Quadrant classification
│   ├── scoring.ts        # Urgency/importance scoring
│   └── converters.ts     # Entity type converters
└── utils/
    ├── index.ts          # Module exports
    └── dates.ts          # Date utilities
```

## Dependencies

- `@goalrate-app/shared` - Shared types and constants

## Development

```bash
# Build the package
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Exports

This package provides the following export paths:

| Path | Description |
|------|-------------|
| `@goalrate-app/core` | All modules combined |
| `@goalrate-app/core/focus` | Focus generation and scoring |
| `@goalrate-app/core/health` | Progress and health status |
| `@goalrate-app/core/prioritization` | Eisenhower Matrix classification |
| `@goalrate-app/core/utils` | Date utility functions |

## Design Principles

1. **Pure Functions**: All functions are pure with no side effects
2. **Date Injection**: Functions accept optional `today` parameter for testability
3. **Semantic Colors**: Health status returns color keys, not CSS classes
4. **Type Location**: Domain types live in `@goalrate-app/shared`, algorithm types stay local

## Related Packages

- `@goalrate-app/shared` - Type definitions used by this package
- `@goalrate-app/storage` - Uses core functions for data operations
- `@goalrate-app/ui` - Uses core functions for display calculations
