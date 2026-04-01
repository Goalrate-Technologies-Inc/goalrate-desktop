/**
 * ConflictResolutionDialog
 * Modal dialog for resolving sync conflicts between local and server data
 */

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '../overlay/dialog';
import { Button } from '../primitives/button';
import { cn } from '../utils/cn';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Sync conflict data structure
 */
export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  vaultId: string;
  localChanges: Record<string, unknown>;
  localVersion: number;
  serverData: Record<string, unknown>;
  serverVersion: number;
  conflictingFields: string[];
  detectedAt: Date;
  // LWW fields
  localTimestamp?: string;
  serverTimestamp?: string;
  autoResolvable?: boolean;
  autoResolution?: 'local' | 'server';
}

export type ConflictResolutionStrategy = 'local' | 'server' | 'merged';

export interface ConflictResolutionDialogProps {
  /** The conflict to resolve */
  conflict: SyncConflict | null;
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog requests to be closed */
  onOpenChange?: (open: boolean) => void;
  /** Called when a resolution strategy is selected */
  onResolve: (strategy: ConflictResolutionStrategy, mergedData?: Record<string, unknown>) => void;
  /** Called when the conflict is dismissed without resolution */
  onDismiss?: () => void;
  /** Whether resolution is in progress */
  isResolving?: boolean;
  /** Custom field labels for display */
  fieldLabels?: Record<string, string>;
  /** Entity type label for display (e.g., "Project", "Goal") */
  entityTypeLabel?: string;
  /** Show LWW suggestion when conflict is auto-resolvable (default: true) */
  showLWWSuggestion?: boolean;
  /** Called when user clicks the LWW auto-resolve button */
  onAutoResolve?: () => void;
}

// ============================================================================
// ICONS
// ============================================================================

const AlertTriangleIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="text-yellow-500"
  >
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const ArrowLeftIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5" />
    <path d="m12 19-7-7 7-7" />
  </svg>
);

const ArrowRightIcon = (): React.JSX.Element => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface FieldDiffProps {
  fieldName: string;
  localValue: unknown;
  serverValue: unknown;
  isConflicting: boolean;
  label?: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '(empty)';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function FieldDiff({
  fieldName,
  localValue,
  serverValue,
  isConflicting,
  label,
}: FieldDiffProps): React.JSX.Element {
  const displayLabel = label || fieldName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  return (
    <div
      className={cn(
        'rounded-md border p-3',
        isConflicting
          ? 'border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-900/20'
          : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50',
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{displayLabel}</span>
        {isConflicting && (
          <span className="rounded-full bg-yellow-200 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
            Conflict
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-900/30">
          <div className="mb-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            Your Changes
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm text-blue-800 dark:text-blue-200">
            {formatValue(localValue)}
          </pre>
        </div>
        <div className="rounded border border-green-200 bg-green-50 p-2 dark:border-green-800 dark:bg-green-900/30">
          <div className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">
            Server Version
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm text-green-800 dark:text-green-200">
            {formatValue(serverValue)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Dialog for resolving sync conflicts between local and server data
 *
 * @example
 * ```tsx
 * <ConflictResolutionDialog
 *   conflict={conflict}
 *   open={hasConflict}
 *   onResolve={(strategy) => {
 *     if (strategy === 'local') {
 *       // Re-apply local changes with new base version
 *       reapplyChanges(conflict.localChanges, conflict.serverVersion);
 *     } else {
 *       // Accept server version (no action needed)
 *     }
 *     clearConflict();
 *   }}
 *   onDismiss={clearConflict}
 * />
 * ```
 */
export function ConflictResolutionDialog({
  conflict,
  open,
  onOpenChange,
  onResolve,
  onDismiss,
  isResolving = false,
  fieldLabels = {},
  entityTypeLabel,
  showLWWSuggestion = true,
  onAutoResolve,
}: ConflictResolutionDialogProps): React.JSX.Element | null {
  // Handle no conflict case
  if (!conflict) {
    return null;
  }

  const entityLabel = entityTypeLabel || conflict.entityType.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  // Check if LWW suggestion should be shown
  const hasLWWSuggestion = showLWWSuggestion && conflict.autoResolvable && conflict.autoResolution;
  const lwwWinnerText = conflict.autoResolution === 'local' ? 'your changes' : 'the server version';

  // Handle LWW auto-resolve click
  const handleAutoResolve = (): void => {
    if (onAutoResolve) {
      onAutoResolve();
    } else if (conflict.autoResolution) {
      onResolve(conflict.autoResolution);
    }
  };

  // Get all fields that have changes
  const changedFields = Object.keys(conflict.localChanges);

  // Handle resolution selection
  const handleResolveLocal = (): void => {
    onResolve('local');
  };

  const handleResolveServer = (): void => {
    onResolve('server');
  };

  const handleDismiss = (): void => {
    onDismiss?.();
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangleIcon />
            <div>
              <DialogTitle>Sync Conflict Detected</DialogTitle>
              <DialogDescription>
                Your changes to this {entityLabel.toLowerCase()} conflict with changes made by
                another user. Choose how to resolve this conflict.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Version Info */}
        <div className="flex items-center justify-between rounded-md bg-gray-100 px-4 py-2 text-sm dark:bg-gray-800">
          <span className="text-gray-600 dark:text-gray-400">
            Your version: <span className="font-medium text-gray-900 dark:text-gray-100">v{conflict.localVersion}</span>
          </span>
          <span className="text-gray-400 dark:text-gray-500">vs</span>
          <span className="text-gray-600 dark:text-gray-400">
            Server version: <span className="font-medium text-gray-900 dark:text-gray-100">v{conflict.serverVersion}</span>
          </span>
        </div>

        {/* LWW Suggestion */}
        {hasLWWSuggestion && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/30">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Suggestion:</strong> Based on timestamps, {lwwWinnerText} is more recent.
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAutoResolve}
                disabled={isResolving}
                className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-800"
              >
                Apply Suggestion
              </Button>
            </div>
          </div>
        )}

        {/* Field Diffs */}
        <div className="max-h-[300px] space-y-3 overflow-y-auto">
          {changedFields.map((field) => (
            <FieldDiff
              key={field}
              fieldName={field}
              localValue={conflict.localChanges[field]}
              serverValue={conflict.serverData[field]}
              isConflicting={conflict.conflictingFields.includes(field)}
              label={fieldLabels[field]}
            />
          ))}
        </div>

        {/* Warning */}
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-200">
          <strong>Warning:</strong> Choosing &quot;Use Server Version&quot; will discard your local
          changes. This action cannot be undone.
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={handleDismiss} disabled={isResolving}>
            Decide Later
          </Button>
          <Button
            variant="outline"
            onClick={handleResolveServer}
            disabled={isResolving}
            className="gap-2"
          >
            <ArrowRightIcon />
            Use Server Version
          </Button>
          <Button
            variant="default"
            onClick={handleResolveLocal}
            disabled={isResolving}
            className="gap-2"
          >
            <ArrowLeftIcon />
            Keep My Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
