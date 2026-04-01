import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Key, Info, Trash2, Check } from 'lucide-react';

interface SettingsPanelProps {
  onClose: () => void;
}

interface ApiKeyStatus {
  anthropic: boolean;
  openai: boolean;
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.ReactElement {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [keySaved, setKeySaved] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<ApiKeyStatus>({ anthropic: false, openai: false });

  // Load saved key status on mount
  useEffect(() => {
    invoke<ApiKeyStatus>('check_api_keys')
      .then((result) => {
        setSavedKeys(result);
      })
      .catch((err) => console.error('[SettingsPanel] Failed to check API keys:', err));
  }, []);

  const handleSaveAnthropicKey = useCallback(async () => {
    if (!anthropicKey.trim()) {return;}
    try {
      await invoke('set_anthropic_api_key', { apiKey: anthropicKey.trim() });
      setAnthropicKey('');
      setSavedKeys((prev) => ({ ...prev, anthropic: true }));
      setKeySaved('Anthropic key saved');
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error('[SettingsPanel] Failed to save Anthropic key:', err);
    }
  }, [anthropicKey]);

  const handleSaveOpenaiKey = useCallback(async () => {
    if (!openaiKey.trim()) {return;}
    try {
      await invoke('set_openai_api_key', { apiKey: openaiKey.trim() });
      setOpenaiKey('');
      setSavedKeys((prev) => ({ ...prev, openai: true }));
      setKeySaved('OpenAI key saved');
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error('Failed to save OpenAI key:', err);
    }
  }, [openaiKey]);

  const handleRemoveAnthropicKey = useCallback(async () => {
    try {
      await invoke('clear_anthropic_api_key');
      setSavedKeys((prev) => ({ ...prev, anthropic: false }));
      setKeySaved('Anthropic key removed');
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error('Failed to remove Anthropic key:', err);
    }
  }, []);

  const handleRemoveOpenaiKey = useCallback(async () => {
    try {
      await invoke('clear_openai_api_key');
      setSavedKeys((prev) => ({ ...prev, openai: false }));
      setKeySaved('OpenAI key removed');
      setTimeout(() => setKeySaved(null), 3000);
    } catch (err) {
      console.error('Failed to remove OpenAI key:', err);
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {onClose();}
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
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
        style={{ backgroundColor: 'var(--bg)', borderColor: 'var(--border-light)' }}
      >
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--border-light)' }}>
          <h2 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>Settings</h2>
          <button onClick={onClose} className="rounded p-1">
            <X className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          </button>
        </div>

        <div className="space-y-6 p-4">
          {/* AI Provider Keys */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Key className="h-3.5 w-3.5" style={{ color: 'var(--accent-goals)' }} />
              <h3 className="font-mono text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                AI Provider
              </h3>
            </div>
            <div className="space-y-3">
              {/* Anthropic */}
              <div>
                <span className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>Anthropic API Key</span>
                {savedKeys.anthropic ? (
                  <div className="flex items-center justify-between rounded-md border px-2 py-1.5"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3" style={{ color: 'var(--progress-high)' }} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>sk-ant-•••••••</span>
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
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={handleSaveAnthropicKey}
                      disabled={!anthropicKey.trim()}
                      className="rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-30"
                      style={{ backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              {/* OpenAI */}
              <div>
                <span className="mb-1 block text-xs" style={{ color: 'var(--text-secondary)' }}>OpenAI API Key</span>
                {savedKeys.openai ? (
                  <div className="flex items-center justify-between rounded-md border px-2 py-1.5"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Check className="h-3 w-3" style={{ color: 'var(--progress-high)' }} />
                      <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>sk-•••••••</span>
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
                      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={handleSaveOpenaiKey}
                      disabled={!openaiKey.trim()}
                      className="rounded-md px-2 py-1.5 text-xs font-medium disabled:opacity-30"
                      style={{ backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' }}
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
              {keySaved && (
                <p className="text-xs" style={{ color: 'var(--progress-high)' }}>{keySaved}</p>
              )}
            </div>
          </section>

          {/* About */}
          <section>
            <div className="mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" style={{ color: 'var(--accent-projects)' }} />
              <h3 className="font-mono text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                About
              </h3>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              GoalRate is your AI Chief of Staff. It generates daily plans, tracks deferrals,
              and learns your patterns over time. All data is stored locally in your vault.
            </p>
            <p className="mt-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>v0.1.0</p>
          </section>
        </div>
      </div>
    </div>
  );
}
