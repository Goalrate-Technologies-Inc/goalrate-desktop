import { useEffect, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  children?: ReactNode;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  danger?: boolean;
  wide?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  children,
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  danger = false,
  wide = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  useEffect(() => {
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {onCancel();}
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} />

      {/* Dialog */}
      <div
        className={`relative w-full ${
          wide ? 'max-w-lg' : 'max-w-sm'
        } rounded-lg border border-border-light bg-surface p-6 shadow-lg`}
      >
        <h3 className="font-serif text-lg text-text-primary">{title}</h3>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        {children}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-warm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-md px-3 py-1.5 text-sm text-white transition-colors ${
              danger
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-text-primary hover:opacity-90'
            } disabled:opacity-40`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
