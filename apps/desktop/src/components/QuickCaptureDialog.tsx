import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Zap } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { attachTauriEventListener } from '../lib/tauriEvents';

export function QuickCaptureDialog(): React.ReactElement | null {
  const { currentVault } = useVault();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return attachTauriEventListener(
      'quick-capture',
      () => {
        setOpen(true);
        setTitle('');
      },
      {
        onError: (err) => {
          console.error('Failed to register quick-capture listener:', err);
        },
      },
    );
  }, []);

  useEffect(() => {
    if (open) {
      // Focus input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const text = title.trim();
    const vaultId = currentVault?.id;
    if (!text || !vaultId) {return;}

    try {
      const goals = await invoke<Array<{ id: string }>>('list_goals', {
        vaultId,
      });

      if (goals.length > 0) {
        await invoke('create_goal_task', {
          vaultId,
          goalId: goals[0].id,
          data: {
            title: text,
            column: 'todo',
            priority: 'medium',
            points: 1,
          },
        });
      }

      setTitle('');
      setOpen(false);
    } catch (err) {
      console.error('Quick capture failed:', err);
    }
  }, [title, currentVault]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [handleSubmit],
  );

  if (!open) {return null;}

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        onClick={() => setOpen(false)}
        aria-label="Close quick capture"
        tabIndex={-1}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-goals-light">
            <Zap className="h-4 w-4 text-accent-goals" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Quick capture — type a task and press Enter"
            className="flex-1 bg-transparent text-base text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>
        <p className="mt-2 text-right text-xs text-text-muted">
          Enter to add · Esc to dismiss
        </p>
      </div>
    </div>
  );
}
