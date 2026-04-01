import { useState, useEffect } from 'react';
import { Check, MoveRight, AlertTriangle } from 'lucide-react';

interface TaskRowProps {
  taskId: string;
  title: string;
  deferralCount?: number;
  isCompleted?: boolean;
  onComplete?: () => void;
  onDefer?: () => void;
}

export function TaskRow({
  title,
  deferralCount = 0,
  isCompleted = false,
  onComplete,
  onDefer,
}: TaskRowProps): React.ReactElement {
  const [justDeferred, setJustDeferred] = useState(false);
  // Optimistic UI: toggle immediately, sync with prop on next render
  const [optimisticCompleted, setOptimisticCompleted] = useState(isCompleted);

  // Sync optimistic state when the prop changes (after backend confirms)
  useEffect(() => {
    setOptimisticCompleted(isCompleted);
  }, [isCompleted]);

  // Auto-clear the "just deferred" state after 2 seconds
  useEffect(() => {
    if (!justDeferred) {return;}
    const timer = setTimeout(() => setJustDeferred(false), 2000);
    return () => clearTimeout(timer);
  }, [justDeferred]);

  const handleComplete = (): void => {
    setOptimisticCompleted((prev) => !prev);
    onComplete?.();
  };

  const handleDefer = (): void => {
    if (onDefer) {
      onDefer();
      setJustDeferred(true);
    }
  };

  return (
    <div
      className={`group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-warm ${
        optimisticCompleted ? 'opacity-50' : ''
      } ${justDeferred ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        onClick={handleComplete}
        className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${
          optimisticCompleted
            ? 'border-progress-high bg-progress-high text-white'
            : 'border-border hover:border-text-secondary hover:bg-surface-strong'
        }`}
        aria-label={optimisticCompleted ? `Mark "${title}" incomplete` : `Mark "${title}" complete`}
        role="checkbox"
        aria-checked={optimisticCompleted}
      >
        {optimisticCompleted && <Check className="h-3 w-3" />}
      </button>

      <span
        className={`flex-1 text-sm ${
          optimisticCompleted ? 'text-text-muted line-through' : 'text-text-primary'
        }`}
      >
        {title}
      </span>

      {justDeferred && (
        <span className="rounded-full bg-surface-strong px-2 py-0.5 font-mono text-xs text-text-muted transition-opacity">
          Deferred to tomorrow
        </span>
      )}

      {!justDeferred && deferralCount > 0 && (
        <span className="flex items-center gap-1 rounded-full bg-progress-low-light px-2 py-0.5">
          {deferralCount >= 3 && <AlertTriangle className="h-3 w-3 text-progress-low" />}
          <span className="font-mono text-xs text-progress-low">
            {deferralCount}x deferred
          </span>
        </span>
      )}

      {!optimisticCompleted && !justDeferred && onDefer && (
        <button
          type="button"
          onClick={handleDefer}
          className="invisible rounded p-1 text-text-muted transition-colors hover:bg-surface-strong hover:text-text-secondary group-hover:visible"
          title="Defer to tomorrow"
        >
          <MoveRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
