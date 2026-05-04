import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { UseAgendaReturn } from "../../hooks/useAgenda";
import { useVault } from "../../context/VaultContext";
import * as agendaIpc from "../../lib/agendaIpc";
import { DEFAULT_AI_MODEL } from "../../lib/agendaIpc";
import { GoalRateIcon } from "../../components/GoalRateIcon";
import { useSubscription } from "../../context/SubscriptionContext";
import { PlusUpgradePanel } from "./SubscriptionPanel";

interface PlanGenerateButtonProps {
  agenda: UseAgendaReturn;
}

export function PlanGenerateButton({
  agenda,
}: PlanGenerateButtonProps): React.ReactElement {
  const { currentVault } = useVault();
  const { allowsAi, isLoading: isLoadingSubscription } = useSubscription();
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const handleCreateManualAgenda = async (): Promise<void> => {
    const vaultId = currentVault?.id;
    if (!vaultId) {
      setGenError("No vault open. Create or open a vault first.");
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    try {
      await agenda.createPlan();
    } catch (err) {
      const e = err as Record<string, unknown>;
      setGenError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : typeof e?.message === "string"
              ? e.message
              : JSON.stringify(err),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateWithAi = async (): Promise<void> => {
    const vaultId = currentVault?.id;
    if (!vaultId) {
      setGenError("No vault open. Create or open a vault first.");
      return;
    }

    if (!allowsAi) {
      await handleCreateManualAgenda();
      return;
    }

    setIsGenerating(true);
    setGenError(null);
    try {
      const result = await agendaIpc.generatePlan(
        vaultId,
        DEFAULT_AI_MODEL,
        agenda.date,
      );
      if (result.taskTitles) {
        agenda.mergeTaskTitles(result.taskTitles);
      }
      await agenda.refresh();
    } catch (err) {
      const e = err as Record<string, unknown>;
      setGenError(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : typeof e?.message === "string"
              ? e.message
              : JSON.stringify(err),
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div
        className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl"
        style={{ backgroundColor: "var(--surface-warm)" }}
      >
        <GoalRateIcon className="h-10 w-10" />
      </div>
      <h2 className="mb-2 font-serif text-2xl text-text-primary">
        Ready to plan your day?
      </h2>
      <p className="mb-6 max-w-sm text-center text-sm text-text-secondary">
        {allowsAi
          ? "The Assistant will analyze your goals, tasks, and recent patterns to create today's Agenda."
          : "Create a local Agenda for free, then add and arrange tasks by hand."}
      </p>
      <div className="flex flex-col items-center gap-3">
        <button
          onClick={allowsAi ? handleGenerateWithAi : handleCreateManualAgenda}
          disabled={
            isGenerating ||
            !currentVault?.id ||
            (allowsAi && isLoadingSubscription)
          }
          className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "var(--btn-bg)", color: "var(--btn-text)" }}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {allowsAi ? "Generating Agenda..." : "Creating Agenda..."}
            </>
          ) : (
            <>
              {allowsAi ? (
                <GoalRateIcon className="h-4 w-4" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              {allowsAi ? "Generate Agenda" : "Create Agenda"}
            </>
          )}
        </button>
      </div>
      {!allowsAi && (
        <div className="mt-6 w-full max-w-sm">
          <PlusUpgradePanel compact />
        </div>
      )}
      {genError && (
        <p className="mt-3 max-w-sm text-center text-sm text-semantic-error">
          {genError}
        </p>
      )}
    </div>
  );
}
