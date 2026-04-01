import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { DailyStats } from '@goalrate-app/shared';
import type { UseDailyLoopReturn } from '../../hooks/useDailyLoop';
import { OutcomeCard } from './OutcomeCard';
import { TaskRow } from './TaskRow';
import { PlanGenerateButton } from './PlanGenerateButton';
import { CheckInDialog } from './CheckInDialog';

/** Convert a task_slug_id into a human-readable label: "task_mvp_core_feature" → "MVP core feature" */
function humanizeTaskId(id: string): string {
  return id
    .replace(/^task_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/, (c) => c.toUpperCase());
}

/** Pick the progress color based on completion percentage */
function progressColor(pct: number): string {
  if (pct <= 33) {return 'var(--progress-low)';}
  if (pct <= 74) {return 'var(--progress-mid)';}
  return 'var(--progress-high)';
}

/** Compute a 7-day average completion rate from recent stats, excluding today */
function weeklyAverage(stats: DailyStats[], todayDate: string): number | null {
  const past = stats.filter((s) => s.date !== todayDate && s.plannedCount > 0);
  if (past.length < 2) {return null;}
  const totalCompleted = past.reduce((sum, s) => sum + s.completedCount, 0);
  const totalPlanned = past.reduce((sum, s) => sum + s.plannedCount, 0);
  if (totalPlanned === 0) {return null;}
  return Math.round((totalCompleted / totalPlanned) * 100);
}

// ── Progress Bar ──────────────────────────────────────────────

interface DailyProgressBarProps {
  completed: number;
  total: number;
  recentStats: DailyStats[];
  todayDate: string;
}

function DailyProgressBar({ completed, total, recentStats, todayDate }: DailyProgressBarProps): React.ReactElement {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const avg = weeklyAverage(recentStats, todayDate);

  return (
    <div className="mb-6 mt-2">
      {/* Bar track */}
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border-light)' }}>
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${pct}%`,
              backgroundColor: progressColor(pct),
            }}
          />
        </div>
        <span
          className="font-mono text-xs font-medium tabular-nums"
          style={{ color: progressColor(pct) }}
        >
          {pct}%
        </span>
      </div>
      {/* 7-day average */}
      {avg !== null && (
        <p className="mt-1 font-mono text-[11px] text-text-muted">
          7-day avg: {avg}%
        </p>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

interface TodaysPlanProps {
  dailyLoop: UseDailyLoopReturn;
}

export function TodaysPlan({ dailyLoop }: TodaysPlanProps): React.ReactElement {
  const { plan, outcomes, isLoading, error, date, checkIn, taskTitles, recentStats } = dailyLoop;
  const [showCheckIn, setShowCheckIn] = useState(false);

  // Completed tasks are persisted on the plan in the DB
  const completedTasks = new Set(plan?.completedTaskIds ?? []);

  const totalCount = plan?.taskOrder?.length ?? 0;
  const completedCount = plan?.completedTaskIds?.length ?? 0;

  // Preserve AI task ordering — only move completed tasks to the bottom
  const sortedTaskOrder = [...(plan?.taskOrder ?? [])].sort((a, b) => {
    const aCompleted = completedTasks.has(a) ? 1 : 0;
    const bCompleted = completedTasks.has(b) ? 1 : 0;
    if (aCompleted !== bCompleted) {return aCompleted - bCompleted;}

    // Within same completion status, preserve original AI ordering
    return 0;
  });

  if (isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-text-muted">Loading...</p>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-8 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-normal" style={{ color: 'var(--text-primary)' }}>Today&apos;s Plan</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {date}
            {plan && totalCount > 0 && (
              <span className="text-text-muted">
                {' '}&middot; {completedCount} of {totalCount} done
              </span>
            )}
          </p>
        </div>
        {plan && !checkIn && (
          <button
            onClick={() => setShowCheckIn(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-warm"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Check In
          </button>
        )}
      </div>

      {/* Completion progress bar */}
      {plan && totalCount > 0 && (
        <DailyProgressBar
          completed={completedCount}
          total={totalCount}
          recentStats={recentStats}
          todayDate={date}
        />
      )}

      {/* Spacer when no progress bar */}
      {(!plan || totalCount === 0) && <div className="mb-6" />}

      {error && (
        <div className="mb-4 rounded-lg border border-semantic-error/30 bg-semantic-error/5 p-3 text-sm text-semantic-error">
          {error}
        </div>
      )}

      {/* No plan state */}
      {!plan && <PlanGenerateButton dailyLoop={dailyLoop} />}

      {/* Plan content */}
      {plan && (
        <div className="space-y-6">
          {/* Top 3 Outcomes */}
          {outcomes.length > 0 && (
            <section>
              <h2 className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                Top 3 Outcomes
              </h2>
              <div className="grid gap-3 lg:grid-cols-3">
                {outcomes.map((outcome, i) => (
                  <OutcomeCard key={outcome.id} outcome={outcome} index={i} completedTaskIds={completedTasks} />
                ))}
              </div>
            </section>
          )}

          {/* Ordered Tasks */}
          <section>
            <h2 className="mb-3 font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
              Tasks
            </h2>
            {sortedTaskOrder.length > 0 ? (
              <div className="rounded-lg border border-border-light bg-surface">
                {sortedTaskOrder.map((taskId) => (
                  <TaskRow
                    key={taskId}
                    taskId={taskId}
                    title={taskTitles[taskId] || humanizeTaskId(taskId)}
                    isCompleted={completedTasks.has(taskId)}
                    onComplete={() => dailyLoop.toggleTaskCompletion(plan.id, taskId)}
                    onDefer={() => {
                      dailyLoop.deferTask(taskId);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No tasks in today's plan. Generate a plan to get started.
              </p>
            )}
          </section>
        </div>
      )}

      <CheckInDialog
        dailyLoop={dailyLoop}
        completedTasks={completedTasks}
        open={showCheckIn}
        onClose={() => setShowCheckIn(false)}
      />
    </main>
  );
}
