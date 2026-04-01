import { AlertTriangle } from 'lucide-react';

interface DeferralConfrontation {
  taskId: string;
  deferralCount: number;
  reasoning: string;
}

interface DeferralBannerProps {
  confrontations: DeferralConfrontation[];
}

export function DeferralBanner({ confrontations }: DeferralBannerProps): React.ReactElement | null {
  if (confrontations.length === 0) {return null;}

  return (
    <div className="space-y-2">
      {confrontations.map((c) => (
        <div
          key={c.taskId}
          className="flex items-start gap-3 rounded-lg border border-progress-low/30 bg-progress-low-light p-3"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-progress-low" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">
              Deferred {c.deferralCount} times
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">{c.reasoning}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
