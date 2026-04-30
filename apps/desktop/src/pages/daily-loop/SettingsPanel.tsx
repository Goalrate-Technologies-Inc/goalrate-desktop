import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  Key,
  Info,
  Trash2,
  Check,
  RotateCcw,
  Loader2,
  AlertTriangle,
  FileText,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useVault } from "../../context/VaultContext";
import {
  pathsAffectRecoveryIssues,
  pathsAffectRecoverySnapshots,
  vaultUpdatePaths,
  type VaultLibraryUpdatedPayload,
} from "../../lib/vaultWatcherEvents";
import { attachTauriEventListener } from "../../lib/tauriEvents";
import { SubscriptionSettingsSection } from "./SubscriptionPanel";

const SHOW_PROVIDER_KEYS =
  import.meta.env.DEV &&
  import.meta.env.VITE_GOALRATE_SHOW_PROVIDER_KEYS !== "false";

interface SettingsPanelProps {
  onClose: () => void;
  onVaultRestored?: () => void | Promise<void>;
}

interface ApiKeyStatus {
  anthropic: boolean;
  openai: boolean;
}

interface SnapshotRestoreResult {
  restoredPath: string;
  snapshotPath: string;
}

interface SnapshotHistoryEntry {
  createdAt: string;
  actor: string;
  action: string;
  targetPath: string;
  snapshotPath: string;
}

interface VaultErrorLogEntry {
  createdAt: string;
  filePath: string;
  message: string;
}

interface SnapshotPreview {
  targetPath: string;
  snapshotPath: string;
  currentExists: boolean;
  addedLines: number;
  removedLines: number;
  unchangedLines: number;
  currentExcerpt: string;
  restoredExcerpt: string;
}

type RestoreRequest =
  | { kind: "latest" }
  | { kind: "snapshot"; snapshot: SnapshotHistoryEntry };

function errorMessage(
  err: unknown,
  fallback = "Unable to restore the latest snapshot.",
): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  if (typeof err === "string") {
    return err;
  }
  return fallback;
}

function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SnapshotPreviewDetails({
  preview,
  isLoading,
  error,
}: {
  preview: SnapshotPreview | null;
  isLoading: boolean;
  error: string | null;
}): React.ReactElement {
  if (isLoading) {
    return (
      <div className="mt-4 flex items-center gap-2 border-t border-border-light pt-3 text-xs text-text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading snapshot preview...
      </div>
    );
  }

  if (error) {
    return (
      <p className="mt-4 border-t border-border-light pt-3 text-xs text-red-600">
        {error}
      </p>
    );
  }

  if (!preview) {
    return (
      <p className="mt-4 border-t border-border-light pt-3 text-xs text-text-muted">
        No preview is available for this snapshot.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border-light pt-3">
      <div className="flex items-start justify-between gap-3 text-xs">
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">
            {preview.targetPath}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-muted">
            {preview.snapshotPath}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-text-secondary">
          +{preview.addedLines} / -{preview.removedLines} lines
        </span>
      </div>

      {!preview.currentExists && (
        <p className="text-xs text-text-secondary">
          Current file is missing; restore will recreate it.
        </p>
      )}

      <div className="space-y-2">
        <div>
          <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Current
          </p>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-warm p-2 font-mono text-[11px] text-text-secondary">
            {preview.currentExcerpt || "(empty)"}
          </pre>
        </div>
        <div>
          <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-text-muted">
            Restored Snapshot
          </p>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-warm p-2 font-mono text-[11px] text-text-secondary">
            {preview.restoredExcerpt || "(empty)"}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({
  onClose,
  onVaultRestored,
}: SettingsPanelProps): React.ReactElement {
  const { currentVault } = useVault();
  const currentVaultId = currentVault?.id;
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [keySaved, setKeySaved] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [snapshotPreview, setSnapshotPreview] = useState<SnapshotPreview | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<RestoreRequest | null>(
    null,
  );
  const [snapshotHistory, setSnapshotHistory] = useState<
    SnapshotHistoryEntry[]
  >([]);
  const [errorLogEntries, setErrorLogEntries] = useState<VaultErrorLogEntry[]>(
    [],
  );
  const [isLoadingErrorLogEntries, setIsLoadingErrorLogEntries] =
    useState(false);
  const [errorLogEntryError, setErrorLogEntryError] = useState<string | null>(
    null,
  );
  const [savedKeys, setSavedKeys] = useState<ApiKeyStatus>({
    anthropic: false,
    openai: false,
  });

  // Load saved key status on mount
  useEffect(() => {
    if (!SHOW_PROVIDER_KEYS) {
      return;
    }

    invoke<ApiKeyStatus>("check_api_keys")
      .then((result) => {
        setSavedKeys(result);
      })
      .catch((err) =>
        console.error("[SettingsPanel] Failed to check API keys:", err),
      );
  }, []);

  const handleSaveAnthropicKey = useCallback(async () => {
    if (!anthropicKey.trim()) {
      return;
    }
    try {
      await invoke("set_anthropic_api_key", { apiKey: anthropicKey.trim() });
      setAnthropicKey("");
      setSavedKeys((prev) => ({ ...prev, anthropic: true }));
      setKeySaved("Anthropic key saved");
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error("[SettingsPanel] Failed to save Anthropic key:", err);
    }
  }, [anthropicKey]);

  const handleSaveOpenaiKey = useCallback(async () => {
    if (!openaiKey.trim()) {
      return;
    }
    try {
      await invoke("set_openai_api_key", { apiKey: openaiKey.trim() });
      setOpenaiKey("");
      setSavedKeys((prev) => ({ ...prev, openai: true }));
      setKeySaved("OpenAI key saved");
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error("Failed to save OpenAI key:", err);
    }
  }, [openaiKey]);

  const handleRemoveAnthropicKey = useCallback(async () => {
    try {
      await invoke("clear_anthropic_api_key");
      setSavedKeys((prev) => ({ ...prev, anthropic: false }));
      setKeySaved("Anthropic key removed");
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error("Failed to remove Anthropic key:", err);
    }
  }, []);

  const handleRemoveOpenaiKey = useCallback(async () => {
    try {
      await invoke("clear_openai_api_key");
      setSavedKeys((prev) => ({ ...prev, openai: false }));
      setKeySaved("OpenAI key removed");
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error("Failed to remove OpenAI key:", err);
    }
  }, []);

  const handleOpenPrivacyPolicy = useCallback(async () => {
    try {
      await invoke("open_privacy_policy");
    } catch (err) {
      console.error("Failed to open privacy policy:", err);
    }
  }, []);

  const handleOpenSupport = useCallback(async () => {
    try {
      await invoke("open_support_page");
    } catch (err) {
      console.error("Failed to open support page:", err);
    }
  }, []);

  const loadSnapshotHistory = useCallback(async () => {
    if (!currentVaultId) {
      setSnapshotHistory([]);
      return;
    }

    setIsLoadingSnapshots(true);
    try {
      const snapshots = await invoke<SnapshotHistoryEntry[]>(
        "list_vault_snapshots",
        { vaultId: currentVaultId },
      );
      setSnapshotHistory(snapshots);
    } catch (err) {
      console.error("Failed to load vault snapshots:", err);
      setRestoreError(errorMessage(err));
    } finally {
      setIsLoadingSnapshots(false);
    }
  }, [currentVaultId]);

  const loadErrorLogEntries = useCallback(async () => {
    if (!currentVaultId) {
      setErrorLogEntries([]);
      setErrorLogEntryError(null);
      return;
    }

    setIsLoadingErrorLogEntries(true);
    setErrorLogEntryError(null);
    try {
      const entries = await invoke<VaultErrorLogEntry[]>(
        "list_vault_error_log_entries",
        { vaultId: currentVaultId, limit: 5 },
      );
      setErrorLogEntries(entries);
    } catch (err) {
      console.error("Failed to load vault issue log:", err);
      setErrorLogEntryError(
        errorMessage(err, "Unable to load recent vault issues."),
      );
    } finally {
      setIsLoadingErrorLogEntries(false);
    }
  }, [currentVaultId]);

  const handleOpenErrorLog = useCallback(async () => {
    if (!currentVaultId) {
      return;
    }

    setErrorLogEntryError(null);
    try {
      await invoke("open_vault_error_log", { vaultId: currentVaultId });
    } catch (err) {
      console.error("Failed to open vault issue log:", err);
      setErrorLogEntryError(errorMessage(err, "Unable to open logs/errors.md."));
    }
  }, [currentVaultId]);

  const handleOpenIssueFile = useCallback(
    async (path: string) => {
      if (!currentVaultId) {
        return;
      }

      setErrorLogEntryError(null);
      try {
        await invoke("open_vault_issue_file", { vaultId: currentVaultId, path });
      } catch (err) {
        console.error("Failed to open vault issue file:", err);
        setErrorLogEntryError(errorMessage(err, `Unable to open ${path}.`));
      }
    },
    [currentVaultId],
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadSnapshotHistory();
    });
  }, [loadSnapshotHistory]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadErrorLogEntries();
    });
  }, [loadErrorLogEntries]);

  useEffect(() => {
    if (!currentVaultId) {
      return;
    }

    return attachTauriEventListener<VaultLibraryUpdatedPayload>(
      "vault-library-updated",
      (event) => {
        if (event.payload?.vaultId === currentVaultId) {
          const paths = vaultUpdatePaths(event.payload);
          if (pathsAffectRecoverySnapshots(paths)) {
            void loadSnapshotHistory();
          }
          if (pathsAffectRecoveryIssues(paths)) {
            void loadErrorLogEntries();
          }
        }
      },
      {
        onError: (err) => {
          console.error(
            "[SettingsPanel] Failed to listen for vault changes:",
            err,
          );
        },
      },
    );
  }, [currentVaultId, loadErrorLogEntries, loadSnapshotHistory]);

  useEffect(() => {
    if (!currentVaultId || !pendingRestore) {
      queueMicrotask(() => {
        setSnapshotPreview(null);
        setPreviewError(null);
        setIsLoadingPreview(false);
      });
      return;
    }

    const snapshotPath =
      pendingRestore.kind === "latest"
        ? snapshotHistory[0]?.snapshotPath
        : pendingRestore.snapshot.snapshotPath;

    if (!snapshotPath) {
      queueMicrotask(() => {
        setSnapshotPreview(null);
        setPreviewError(null);
        setIsLoadingPreview(false);
      });
      return;
    }

    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      setSnapshotPreview(null);
      setPreviewError(null);
      setIsLoadingPreview(true);

      invoke<SnapshotPreview | null>("preview_vault_snapshot", {
        vaultId: currentVaultId,
        snapshotPath,
      })
        .then((preview) => {
          if (!isCancelled) {
            setSnapshotPreview(preview);
          }
        })
        .catch((err) => {
          console.error("Failed to preview vault snapshot:", err);
          if (!isCancelled) {
            setPreviewError(
              errorMessage(err, "Unable to load snapshot preview."),
            );
          }
        })
        .finally(() => {
          if (!isCancelled) {
            setIsLoadingPreview(false);
          }
        });
    });

    return () => {
      isCancelled = true;
    };
  }, [currentVaultId, pendingRestore, snapshotHistory]);

  const handleConfirmRestore = useCallback(async () => {
    if (!currentVaultId || isRestoring || !pendingRestore) {
      return;
    }

    setIsRestoring(true);
    setRestoreMessage(null);
    setRestoreError(null);

    try {
      const result =
        pendingRestore.kind === "latest"
          ? await invoke<SnapshotRestoreResult | null>(
              "restore_latest_vault_snapshot",
              { vaultId: currentVaultId },
            )
          : await invoke<SnapshotRestoreResult | null>(
              "restore_vault_snapshot",
              {
                vaultId: currentVaultId,
                snapshotPath: pendingRestore.snapshot.snapshotPath,
              },
            );
      if (!result) {
        setRestoreMessage("No snapshot available to restore.");
        return;
      }

      await onVaultRestored?.();
      await loadSnapshotHistory();
      setRestoreMessage(`Restored ${result.restoredPath}`);
    } catch (err) {
      console.error("Failed to restore vault snapshot:", err);
      setRestoreError(errorMessage(err));
    } finally {
      setIsRestoring(false);
      setPendingRestore(null);
      setSnapshotPreview(null);
      setPreviewError(null);
      setIsLoadingPreview(false);
    }
  }, [
    currentVaultId,
    isRestoring,
    loadSnapshotHistory,
    onVaultRestored,
    pendingRestore,
  ]);

  const handleCancelRestore = useCallback(() => {
    setPendingRestore(null);
    setSnapshotPreview(null);
    setPreviewError(null);
    setIsLoadingPreview(false);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        aria-label="Close settings"
        tabIndex={-1}
      />
      <div
        className="relative w-80 overflow-y-auto border-l shadow-lg"
        style={{
          backgroundColor: "var(--bg)",
          borderColor: "var(--border-light)",
        }}
      >
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: "var(--border-light)" }}
        >
          <h2
            className="font-serif text-lg"
            style={{ color: "var(--text-primary)" }}
          >
            Settings
          </h2>
          <button onClick={onClose} className="rounded p-1">
            <X className="h-4 w-4" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <div className="space-y-6 p-4">
          <SubscriptionSettingsSection />

          {/* AI Provider Keys */}
          {SHOW_PROVIDER_KEYS && (
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Key
                className="h-3.5 w-3.5"
                style={{ color: "var(--accent-goals)" }}
              />
              <h3
                className="font-mono text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                AI Provider
              </h3>
            </div>
            <div className="space-y-3">
              {/* Anthropic */}
              <div>
                <span
                  className="mb-1 block text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Anthropic API Key
                </span>
                {savedKeys.anthropic ? (
                  <div
                    className="flex items-center justify-between rounded-md border px-2 py-1.5"
                    style={{
                      borderColor: "var(--border)",
                      backgroundColor: "var(--surface)",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Check
                        className="h-3 w-3"
                        style={{ color: "var(--progress-high)" }}
                      />
                      <span
                        className="font-mono text-xs"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        sk-ant-•••••••
                      </span>
                    </div>
                    <button
                      onClick={handleRemoveAnthropicKey}
                      className="rounded p-0.5 transition-colors hover:bg-red-100"
                      title="Remove Anthropic key"
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={anthropicKey}
                      onChange={(e) => setAnthropicKey(e.target.value)}
                      placeholder="sk-ant-..."
                      className="flex-1 rounded-md border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent-goals"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--surface)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button
                      onClick={handleSaveAnthropicKey}
                      disabled={!anthropicKey.trim()}
                      className="rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-30"
                      style={{
                        backgroundColor: "var(--btn-bg)",
                        color: "var(--btn-text)",
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              {/* OpenAI */}
              <div>
                <span
                  className="mb-1 block text-xs"
                  style={{ color: "var(--text-secondary)" }}
                >
                  OpenAI API Key
                </span>
                {savedKeys.openai ? (
                  <div
                    className="flex items-center justify-between rounded-md border px-2 py-1.5"
                    style={{
                      borderColor: "var(--border)",
                      backgroundColor: "var(--surface)",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Check
                        className="h-3 w-3"
                        style={{ color: "var(--progress-high)" }}
                      />
                      <span
                        className="font-mono text-xs"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        sk-•••••••
                      </span>
                    </div>
                    <button
                      onClick={handleRemoveOpenaiKey}
                      className="rounded p-0.5 transition-colors hover:bg-red-100"
                      title="Remove OpenAI key"
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <input
                      type="password"
                      value={openaiKey}
                      onChange={(e) => setOpenaiKey(e.target.value)}
                      placeholder="sk-..."
                      className="flex-1 rounded-md border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent-goals"
                      style={{
                        borderColor: "var(--border)",
                        backgroundColor: "var(--surface)",
                        color: "var(--text-primary)",
                      }}
                    />
                    <button
                      onClick={handleSaveOpenaiKey}
                      disabled={!openaiKey.trim()}
                      className="rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-30"
                      style={{
                        backgroundColor: "var(--btn-bg)",
                        color: "var(--btn-text)",
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              {keySaved && (
                <p
                  className="text-xs"
                  style={{ color: "var(--progress-high)" }}
                >
                  {keySaved}
                </p>
              )}
              <p className="text-xs leading-relaxed text-text-muted">
                Provider keys are stored in the system keychain. GoalRate sends
                planning context to remote AI providers only when you use AI
                features, and Memory context follows your onboarding consent.
              </p>
            </div>
          </section>
          )}

          {/* Privacy and Support */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <ShieldCheck
                className="h-3.5 w-3.5"
                style={{ color: "var(--accent-projects)" }}
              />
              <h3
                className="font-mono text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Privacy & Support
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleOpenPrivacyPolicy}
                className="inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
                style={{ borderColor: "var(--border)" }}
              >
                Privacy
                <ExternalLink className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={handleOpenSupport}
                className="inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary"
                style={{ borderColor: "var(--border)" }}
              >
                Support
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </section>

          {/* Vault Recovery */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <RotateCcw
                className="h-3.5 w-3.5"
                style={{ color: "var(--accent-projects)" }}
              />
              <h3
                className="font-mono text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Vault Recovery
              </h3>
            </div>
            <p
              className="mb-3 text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Review markdown snapshots and restore the version you need. The
              current file is snapshotted first, so the restore remains
              recoverable.
            </p>

            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-progress-low" />
                  <p
                    className="font-mono text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Recent Issues
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      void loadErrorLogEntries();
                    }}
                    disabled={!currentVaultId || isLoadingErrorLogEntries}
                    aria-label="Refresh recent issues"
                    title="Refresh recent issues"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary disabled:opacity-40"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        isLoadingErrorLogEntries ? "animate-spin" : ""
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenErrorLog}
                    disabled={!currentVaultId}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary disabled:opacity-40"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <FileText className="h-3 w-3" />
                    Open logs/errors.md
                  </button>
                </div>
              </div>
              {isLoadingErrorLogEntries ? (
                <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading issues...
                </div>
              ) : errorLogEntryError ? (
                <p className="py-2 text-xs text-red-600">
                  {errorLogEntryError}
                </p>
              ) : errorLogEntries.length === 0 ? (
                <p className="py-2 text-xs text-text-muted">
                  No vault issues logged.
                </p>
              ) : (
                errorLogEntries.map((entry) => (
                  <div
                    key={`${entry.createdAt}-${entry.filePath}-${entry.message}`}
                    className="rounded-md border p-2"
                    style={{
                      borderColor: "var(--border-light)",
                      backgroundColor: "var(--surface)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium text-text-primary">
                        {entry.filePath}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void handleOpenIssueFile(entry.filePath);
                        }}
                        aria-label={`Open ${entry.filePath}`}
                        className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-warm hover:text-text-primary disabled:opacity-40"
                        style={{ borderColor: "var(--border)" }}
                      >
                        Open
                      </button>
                    </div>
                    <p className="mt-1 break-words text-xs text-text-secondary">
                      {entry.message}
                    </p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {formatSnapshotTime(entry.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => setPendingRestore({ kind: "latest" })}
              disabled={!currentVaultId || isRestoring}
              className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: "var(--border)",
                backgroundColor: "var(--surface)",
                color: "var(--text-primary)",
              }}
            >
              {isRestoring ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Restore latest snapshot
            </button>

            <div className="mt-3 space-y-2">
              <p
                className="font-mono text-[11px] font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Snapshot History
              </p>
              {isLoadingSnapshots ? (
                <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading snapshots...
                </div>
              ) : snapshotHistory.length === 0 ? (
                <p className="py-2 text-xs text-text-muted">
                  No snapshots yet.
                </p>
              ) : (
                snapshotHistory.slice(0, 5).map((snapshot) => (
                  <div
                    key={snapshot.snapshotPath}
                    className="rounded-md border p-2"
                    style={{
                      borderColor: "var(--border-light)",
                      backgroundColor: "var(--surface)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-text-primary">
                          {snapshot.targetPath}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-text-muted">
                          {snapshot.action} by {snapshot.actor}
                        </p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          {formatSnapshotTime(snapshot.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setPendingRestore({ kind: "snapshot", snapshot })
                        }
                        disabled={isRestoring}
                        aria-label={`Restore ${snapshot.targetPath} snapshot`}
                        className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40"
                        style={{
                          borderColor: "var(--border)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {restoreMessage && (
              <p
                className="mt-2 text-xs"
                style={{ color: "var(--progress-high)" }}
              >
                {restoreMessage}
              </p>
            )}
            {restoreError && (
              <p className="mt-2 text-xs text-red-600">{restoreError}</p>
            )}
          </section>

          {/* About */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Info
                className="h-3.5 w-3.5"
                style={{ color: "var(--accent-projects)" }}
              />
              <h3
                className="font-mono text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                About
              </h3>
            </div>
            <p
              className="text-xs leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              GoalRate includes an Assistant that generates your Agenda, tracks
              deferrals, and learns your patterns over time. All data is stored
              locally in your vault.
            </p>
            <p
              className="mt-2 font-mono text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              v0.1.0
            </p>
          </section>
        </div>
      </div>
    </div>
      {pendingRestore && (
        <ConfirmDialog
          title="Restore Snapshot"
          message={
            pendingRestore.kind === "latest"
              ? "Restore the most recent vault markdown snapshot? GoalRate will snapshot the current file before replacing it."
              : `Restore ${pendingRestore.snapshot.targetPath} from ${formatSnapshotTime(
                  pendingRestore.snapshot.createdAt,
                )}? GoalRate will snapshot the current file before replacing it.`
          }
          confirmLabel="Restore"
          confirmDisabled={isLoadingPreview}
          wide
          onConfirm={handleConfirmRestore}
          onCancel={handleCancelRestore}
        >
          <SnapshotPreviewDetails
            preview={snapshotPreview}
            isLoading={isLoadingPreview}
            error={previewError}
          />
        </ConfirmDialog>
      )}
    </>
  );
}
