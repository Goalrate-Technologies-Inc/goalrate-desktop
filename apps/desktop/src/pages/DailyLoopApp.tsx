import { useCallback, useEffect, useState } from 'react';
import { Settings, ChevronDown, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useDailyLoop } from '../hooks/useDailyLoop';
import { useVault } from '../context/VaultContext';
import { DomainSidebar } from './daily-loop/DomainSidebar';
import { TodaysPlan } from './daily-loop/TodaysPlan';
import { AiChatPanel } from './daily-loop/AiChatPanel';
import { IntakeFlow } from './daily-loop/IntakeFlow';
import { SettingsPanel } from './daily-loop/SettingsPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function DailyLoopApp(): React.ReactElement {
  const dailyLoop = useDailyLoop();
  const { currentVault, vaults, openVault, closeVault, refreshVaults } = useVault();
  const [showSettings, setShowSettings] = useState(false);
  const [vaultToRemove, setVaultToRemove] = useState<{ id: string; name: string } | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [goalCheck, setGoalCheck] = useState<{ vaultId?: string; hasGoals: boolean | null }>({ hasGoals: null });
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

  const hasGoals = goalCheck.vaultId === vaultId ? goalCheck.hasGoals : null;
  const needsIntake = !vaultId || hasGoals === false;
  const isLoading = !!vaultId && hasGoals === null;

  const handleIntakeComplete = useCallback(async () => {
    setGoalCheck({ vaultId, hasGoals: true });
    await dailyLoop.refresh();
  }, [vaultId, dailyLoop]);

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
      className="daily-loop-theme flex h-screen flex-col"
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
          <DomainSidebar dataVersion={dailyLoop.dataVersion} onMutation={() => dailyLoop.refresh()} />
          <TodaysPlan dailyLoop={dailyLoop} />
          <AiChatPanel dailyLoop={dailyLoop} />
        </div>
      )}

      {/* Settings slide-over */}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
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
