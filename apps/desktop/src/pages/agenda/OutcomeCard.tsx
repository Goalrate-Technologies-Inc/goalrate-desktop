import { Trophy } from 'lucide-react';
import type { Outcome } from '@goalrate-app/shared';

interface OutcomeCardProps {
  outcome: Outcome;
  index: number;
  completedTaskIds?: Set<string>;
}

export function OutcomeCard({ outcome, index, completedTaskIds }: OutcomeCardProps): React.ReactElement {
  const total = outcome.linkedTaskIds.length;
  const completed = completedTaskIds
    ? outcome.linkedTaskIds.filter((id) => completedTaskIds.has(id)).length
    : 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-border-light bg-surface p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-goals-light">
          <Trophy className="h-3.5 w-3.5 text-accent-goals" />
        </div>
        <span className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
          Outcome {index + 1}
        </span>
      </div>
      <h3 className="font-serif text-xl font-normal text-text-primary">{outcome.title}</h3>
      {total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">
              {completed} of {total} task{total !== 1 ? 's' : ''} done
            </p>
            <span
              className="font-mono text-xs font-medium tabular-nums"
              style={{ color: pct <= 33 ? 'var(--progress-low)' : pct <= 74 ? 'var(--progress-mid)' : 'var(--progress-high)' }}
            >
              {pct}%
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border-light)' }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${pct}%`,
                backgroundColor: pct <= 33 ? 'var(--progress-low)' : pct <= 74 ? 'var(--progress-mid)' : 'var(--progress-high)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
