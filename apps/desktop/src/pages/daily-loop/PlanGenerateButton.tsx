import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { UseDailyLoopReturn } from '../../hooks/useDailyLoop';
import { useVault } from '../../context/VaultContext';
import * as dailyLoopIpc from '../../lib/dailyLoopIpc';
import { DEFAULT_AI_MODEL } from '../../lib/dailyLoopIpc';
import { GoalRateIcon } from '../../components/GoalRateIcon';

interface PlanGenerateButtonProps {
  dailyLoop: UseDailyLoopReturn;
}

export function PlanGenerateButton({ dailyLoop }: PlanGenerateButtonProps): React.ReactElement {
  const { currentVault } = useVault();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleGenerate = async (): Promise<void> => {
    const vaultId = currentVault?.id;
    if (!vaultId) {
      setGenError('No vault open. Create or open a vault first.');
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    try {
      const result = await dailyLoopIpc.generatePlan(
        vaultId,
        DEFAULT_AI_MODEL,
        dailyLoop.date,
      );
      if (result.taskTitles) {
        dailyLoop.mergeTaskTitles(result.taskTitles);
      }
      await dailyLoop.refresh();
    } catch (err) {
      const e = err as Record<string, unknown>;
      setGenError(
        err instanceof Error ? err.message
        : typeof err === 'string' ? err
        : typeof e?.message === 'string' ? e.message
        : JSON.stringify(err),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--surface-warm)' }}>
        <GoalRateIcon className="h-10 w-10" />
      </div>
      <h2 className="mb-2 font-serif text-2xl text-text-primary">Ready to plan your day?</h2>
      <p className="mb-6 max-w-sm text-center text-sm text-text-secondary">
        Your AI Chief of Staff will analyze your goals, tasks, and recent patterns to create today's
        plan.
      </p>
      <button
        onClick={handleGenerate}
        disabled={isGenerating || !currentVault?.id}
        className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        style={{ backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' }}
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating plan...
          </>
        ) : (
          <>
            <GoalRateIcon className="h-4 w-4" />
            Generate Today's Plan
          </>
        )}
      </button>
      {genError && (
        <p className="mt-3 max-w-sm text-center text-sm text-semantic-error">{genError}</p>
      )}
    </div>
  );
}
