import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, ChevronDown, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useAgenda } from '../hooks/useAgenda';
import { useVault } from '../context/VaultContext';
import { DomainSidebar } from './agenda/DomainSidebar';
import { TodaysPlan } from './agenda/TodaysPlan';
import { AiChatPanel } from './agenda/AiChatPanel';
import { IntakeFlow } from './agenda/IntakeFlow';
import { SettingsPanel } from './agenda/SettingsPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  vaultRefreshStatusLabel,
  vaultUpdatePaths,
  type VaultLibraryUpdatedPayload,
} from '../lib/vaultWatcherEvents';
import { attachTauriEventListener } from '../lib/tauriEvents';

interface VaultRefreshStatus {
  label: string;
  refreshedAt: Date;
}

interface GoalNotesRequest {
  requestId: number;
  goalId: string;
  title: string;
}

function formatRefreshTime(value: Date): string {
  const hours = value.getHours();
  const minutes = String(value.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes} ${period}`;
}

export function AgendaApp(): React.ReactElement {
  const agenda = useAgenda();
  const { currentVault, vaults, openVault, closeVault, refreshVaults } = useVault();
  const [showSettings, setShowSettings] = useState(false);
  const [vaultToRemove, setVaultToRemove] = useState<{ id: string; name: string } | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [goalCheck, setGoalCheck] = useState<{ vaultId?: string; hasGoals: boolean | null }>({ hasGoals: null });
  const [vaultRefreshStatus, setVaultRefreshStatus] = useState<VaultRefreshStatus | null>(null);
  const [goalNotesRequest, setGoalNotesRequest] = useState<GoalNotesRequest | null>(null);
  const vaultRefreshTimerRef = useRef<number | null>(null);
  const goalNotesRequestIdRef = useRef(0);
  const vaultId = currentVault?.id;

  // Check if user needs intake flow (no goals exist); resets on vault change
  useEffect(() => {
    if (!vaultId) {return;}

    let cancelled = false;

    async function check(): Promise<void> {
      try {
        const goals = await invoke<Array<{ id: string }>>('list_goals', { vaultId });
        if (!cancelled) {
          setGoalCheck({ vaultId, hasGoals: goals.length > 0 });
        }
      } catch {
        if (!cancelled) {
          setGoalCheck({ vaultId, hasGoals: false });
        }
      }
    }
    check();
    return () => { cancelled = true; };
  }, [vaultId]);

  useEffect(() => {
    if (!vaultId) {return;}

    const detach = attachTauriEventListener<VaultLibraryUpdatedPayload>(
      'vault-library-updated',
      (event) => {
        if (event.payload?.vaultId !== vaultId) {
          return;
        }

        setVaultRefreshStatus({
          label: vaultRefreshStatusLabel(vaultUpdatePaths(event.payload)),
          refreshedAt: new Date(),
        });
        if (vaultRefreshTimerRef.current !== null) {
          window.clearTimeout(vaultRefreshTimerRef.current);
        }
        vaultRefreshTimerRef.current = window.setTimeout(() => {
          setVaultRefreshStatus(null);
          vaultRefreshTimerRef.current = null;
        }, 3000);
      },
      {
        onError: (err) => {
          console.error('[AgendaApp] Failed to listen for vault changes:', err);
        },
      },
    );

    return () => {
      detach();
      if (vaultRefreshTimerRef.current !== null) {
        window.clearTimeout(vaultRefreshTimerRef.current);
        vaultRefreshTimerRef.current = null;
      }
    };
  }, [vaultId]);

  const hasGoals = goalCheck.vaultId === vaultId ? goalCheck.hasGoals : null;
  const needsIntake = !vaultId || hasGoals === false;
  const isLoading = !!vaultId && hasGoals === null;

  const handleIntakeComplete = useCallback(async () => {
    setGoalCheck({ vaultId, hasGoals: true });
    await agenda.refresh();
  }, [vaultId, agenda]);

  const handleVaultRestored = useCallback(async () => {
    if (vaultId) {
      const goals = await invoke<Array<{ id: string }>>('list_goals', { vaultId });
      setGoalCheck({ vaultId, hasGoals: goals.length > 0 });
    }
    await agenda.refresh();
  }, [vaultId, agenda]);

  const handleOpenGoalNotes = useCallback((goalId: string, title: string) => {
    goalNotesRequestIdRef.current += 1;
    setGoalNotesRequest({
      requestId: goalNotesRequestIdRef.current,
      goalId,
      title,
    });
  }, []);

  const handleSelectVault = useCallback(
    async (vaultPath: string) => {
      try {
        await openVault(vaultPath);
        setShowVaultPicker(false);
      } catch (err) {
        console.error('Failed to open vault:', err);
      }
    },
    [openVault],
  );

  const handleRemoveVault = useCallback(async () => {
    if (!vaultToRemove) {return;}
    try {
      // If removing the current vault, close it first
      if (vaultToRemove.id === currentVault?.id) {
        await closeVault();
      }
      await invoke('delete_vault', { vaultId: vaultToRemove.id });
      await refreshVaults();
      setVaultToRemove(null);
      setShowVaultPicker(false);
    } catch (err) {
      console.error('Failed to remove vault:', err);
    }
  }, [vaultToRemove, currentVault, closeVault, refreshVaults]);

  return (
    <div
      className="agenda-theme flex h-screen flex-col"
      style={{ fontFamily: "'Geist', system-ui, sans-serif", backgroundColor: 'var(--bg)' }}
    >
      {/* Header — always visible */}
      <header
        className="flex h-11 shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg)' }}
      >
        <div className="flex items-center gap-3 pl-16">
          {/* Vault selector */}
          <div className="relative">
            <button
              onClick={() => setShowVaultPicker((prev) => !prev)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'transparent' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              {currentVault?.name ?? 'No vault'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {showVaultPicker && vaults.length > 0 && (
              <div
                className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-lg border p-1 shadow-md"
                style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--surface)' }}
              >
                {vaults.map((v) => (
                  <div key={v.id} className="group flex items-center rounded-md transition-colors hover:bg-surface-warm">
                    <button
                      onClick={() => handleSelectVault(v.path)}
                      className="flex flex-1 items-center rounded-md px-3 py-1.5 text-left text-sm"
                      style={{ color: v.id === currentVault?.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                    >
                      {v.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setVaultToRemove({ id: v.id, name: v.name });
                      }}
                      className="invisible mr-1 rounded p-1 text-text-muted transition-colors hover:text-red-600 group-hover:visible"
                      title="Remove vault"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {vaultRefreshStatus && (
            <span
              aria-live="polite"
              title={`Last refreshed at ${formatRefreshTime(vaultRefreshStatus.refreshedAt)}`}
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
              style={{
                borderColor: 'var(--border-light)',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--surface)',
              }}
            >
              {vaultRefreshStatus.label}
            </span>
          )}
        </div>

        <button
          onClick={() => setShowSettings(true)}
          className="rounded-md p-1.5 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          title="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </header>

      {/* Main content */}
      {isLoading && (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</p>
        </div>
      )}

      {!isLoading && needsIntake && (
        <div className="flex flex-1 items-center justify-center">
          <IntakeFlow
            onComplete={handleIntakeComplete}
            hasVault={!!currentVault?.id}
          />
        </div>
      )}

      {!isLoading && !needsIntake && (
        <div className="flex min-h-0 flex-1">
          <DomainSidebar
            dataVersion={agenda.dataVersion}
            onMutation={() => agenda.refresh()}
            openGoalRequest={goalNotesRequest}
          />
          <TodaysPlan
            agenda={agenda}
            onOpenGoalNotes={handleOpenGoalNotes}
          />
          <AiChatPanel agenda={agenda} />
        </div>
      )}

      {/* Settings slide-over */}
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onVaultRestored={handleVaultRestored}
        />
      )}

      {/* Remove vault confirmation */}
      {vaultToRemove && (
        <ConfirmDialog
          title="Remove Vault"
          message={`Remove "${vaultToRemove.name}" from GoalRate? The vault files on disk will not be deleted.`}
          confirmLabel="Remove"
          danger
          onConfirm={handleRemoveVault}
          onCancel={() => setVaultToRemove(null)}
        />
      )}
    </div>
  );
}
