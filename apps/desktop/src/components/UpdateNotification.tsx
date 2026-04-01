import type { UpdateState } from '../types/update';
import { Button } from '@goalrate-app/ui/primitives';
import { cn } from '@goalrate-app/ui/utils';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';

/**
 * Props for the UpdateNotification component
 */
export interface UpdateNotificationProps {
  /** Current state of the update system */
  state: UpdateState;
  /** Called when user clicks Download */
  onDownload: () => void;
  /** Called when user clicks Install/Restart */
  onInstall: () => void;
  /** Called when user dismisses the notification */
  onDismiss: () => void;
}

const TOAST_BASE_CLASS =
  'fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-lg animate-slide-in-right';

const TOAST_ICON_CLASS =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border';

/**
 * Toast-style notification component for displaying update status
 *
 * Renders different UI based on the update state:
 * - available: Shows version info with Download/Later buttons
 * - downloading: Shows progress bar with percentage
 * - ready: Shows "Restart Now" / "Later" buttons
 * - error: Shows error message with dismiss button
 */
export function UpdateNotification({
  state,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateNotificationProps): React.ReactElement | null {
  // Don't render anything for idle, not-available, or checking states
  if (state.status === 'idle' || state.status === 'not-available' || state.status === 'checking') {
    return null;
  }

  // Error state
  if (state.status === 'error') {
    return (
      <div className={cn(TOAST_BASE_CLASS, 'border-destructive/35')}>
        <div className="flex items-start gap-3">
          <div className={cn(TOAST_ICON_CLASS, 'border-destructive/30 bg-destructive/10 text-destructive')}>
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Update Error</h3>
            <p className="mt-1 text-sm text-muted-foreground">{state.error}</p>
          </div>
          <Button
            onClick={onDismiss}
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Update available state
  if (state.status === 'available' && state.info) {
    return (
      <div className={cn(TOAST_BASE_CLASS, 'border-divider')}>
        <div className="flex items-start gap-3">
          <div className={cn(TOAST_ICON_CLASS, 'border-info/25 bg-info/10 text-info')}>
            <Download className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Update Available</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Version {state.info.version} is now available.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/90">
              Current version: {state.info.currentVersion}
            </p>
            <div className="mt-3 flex gap-2">
              <Button onClick={onDownload} size="sm">
                Download
              </Button>
              <Button onClick={onDismiss} variant="outline" size="sm">
                Later
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Downloading state
  if (state.status === 'downloading') {
    return (
      <div className={cn(TOAST_BASE_CLASS, 'border-divider')}>
        <div className="flex items-start gap-3">
          <div className={cn(TOAST_ICON_CLASS, 'border-info/25 bg-info/10 text-info')}>
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Downloading Update</h3>
            <div className="mt-2">
              <div className="h-2 overflow-hidden rounded-full border border-divider/70 bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${state.progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground/90">{state.progress}% complete</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Ready to install state
  if (state.status === 'ready') {
    return (
      <div className={cn(TOAST_BASE_CLASS, 'border-success/35')}>
        <div className="flex items-start gap-3">
          <div className={cn(TOAST_ICON_CLASS, 'border-success/30 bg-success/10 text-success')}>
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground">Update Ready</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Restart the application to apply the update.
            </p>
            <div className="mt-3 flex gap-2">
              <Button onClick={onInstall} variant="success" size="sm">
                <RefreshCw className="h-4 w-4" />
                Restart Now
              </Button>
              <Button onClick={onDismiss} variant="outline" size="sm">
                Later
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
