import * as React from 'react';
import { cn } from '../utils/cn';
import { Avatar, AvatarImage, AvatarFallback } from '../data-display/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '../overlay/tooltip';

// ============================================================================
// TYPES
// ============================================================================

export interface EntityEditorData {
  userId: string;
  username: string;
  avatarUrl?: string;
  fieldName?: string;
  startedAt: Date;
}

// ============================================================================
// HELPERS
// ============================================================================

function formatEditingDuration(startedAt: Date): string {
  const now = new Date();
  const diff = now.getTime() - startedAt.getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) {
    return 'Just started';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function formatFieldName(fieldName?: string): string {
  if (!fieldName) {
    return 'this item';
  }
  // Convert camelCase to Title Case with spaces
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim()
    .toLowerCase();
}

// ============================================================================
// COMPONENT
// ============================================================================

export interface EntityEditorsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** List of users editing this entity */
  editors: EntityEditorData[];
  /** Field to highlight conflicts for */
  highlightedField?: string;
  /** Maximum avatars to show before overflow */
  maxVisible?: number;
  /** Variant style */
  variant?: 'default' | 'warning' | 'compact';
}

/**
 * Warning indicator showing who is editing the current entity.
 *
 * @example
 * ```tsx
 * <EntityEditors editors={editorList} />
 * <EntityEditors editors={editors} highlightedField="title" variant="warning" />
 * <EntityEditors editors={editors} variant="compact" />
 * ```
 */
export function EntityEditors({
  editors,
  highlightedField,
  maxVisible = 3,
  variant = 'default',
  className,
  ...props
}: EntityEditorsProps): React.JSX.Element | null {
  // Don't render if no editors
  if (editors.length === 0) {
    return null;
  }

  // Check if someone is editing the highlighted field
  const conflictingEditors = highlightedField
    ? editors.filter((e) => e.fieldName === highlightedField)
    : [];

  const hasFieldConflict = conflictingEditors.length > 0;

  const visibleEditors = editors.slice(0, maxVisible);
  const hiddenCount = editors.length - maxVisible;

  // Compact variant - just an icon badge
  if (variant === 'compact') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center justify-center',
              'h-6 w-6 rounded-full',
              hasFieldConflict
                ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
              className
            )}
            role="status"
            aria-label={`${editors.length} ${editors.length === 1 ? 'person' : 'people'} editing`}
            {...props}
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <EditorTooltipContent editors={editors} />
        </TooltipContent>
      </Tooltip>
    );
  }

  // Default and warning variants
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'inline-flex items-center gap-2 px-2.5 py-1 rounded-full',
            variant === 'warning' || hasFieldConflict
              ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              : 'bg-muted text-muted-foreground',
            hasFieldConflict &&
              'ring-1 ring-yellow-400 dark:ring-yellow-600',
            className
          )}
          role="status"
          aria-label={`${editors.length} ${editors.length === 1 ? 'person' : 'people'} editing`}
          {...props}
        >
          <PencilIcon className="h-3.5 w-3.5" />

          <div className="flex items-center -space-x-1.5">
            {visibleEditors.map((editor) => (
              <Avatar
                key={editor.userId}
                className={cn(
                  'h-5 w-5 text-[10px]',
                  'ring-2',
                  variant === 'warning' || hasFieldConflict
                    ? 'ring-yellow-50 dark:ring-yellow-900/30'
                    : 'ring-muted'
                )}
              >
                {editor.avatarUrl && (
                  <AvatarImage src={editor.avatarUrl} alt={editor.username} />
                )}
                <AvatarFallback userName={editor.username} />
              </Avatar>
            ))}
            {hiddenCount > 0 && (
              <div
                className={cn(
                  'h-5 w-5 rounded-full flex items-center justify-center',
                  'text-[10px] font-medium ring-2',
                  variant === 'warning' || hasFieldConflict
                    ? 'bg-yellow-100 ring-yellow-50 dark:bg-yellow-800/50 dark:ring-yellow-900/30'
                    : 'bg-muted ring-muted'
                )}
              >
                +{hiddenCount}
              </div>
            )}
          </div>

          <span className="text-xs font-medium">
            {editors.length === 1 ? 'editing' : `${editors.length} editing`}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="text-sm">
        <EditorTooltipContent
          editors={editors}
          highlightedField={highlightedField}
        />
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

interface EditorTooltipContentProps {
  editors: EntityEditorData[];
  highlightedField?: string;
}

function EditorTooltipContent({
  editors,
  highlightedField,
}: EditorTooltipContentProps): React.JSX.Element {
  const conflictingEditors = highlightedField
    ? editors.filter((e) => e.fieldName === highlightedField)
    : [];

  return (
    <div className="space-y-2">
      <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
        {editors.length} {editors.length === 1 ? 'person' : 'people'} editing
      </p>

      {conflictingEditors.length > 0 && (
        <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 rounded">
          {conflictingEditors.map((e) => e.username).join(', ')}{' '}
          {conflictingEditors.length === 1 ? 'is' : 'are'} editing this field
        </div>
      )}

      <ul className="space-y-1.5">
        {editors.map((editor) => (
          <li key={editor.userId} className="flex items-center gap-2">
            <Avatar className="h-5 w-5 text-[10px]">
              {editor.avatarUrl && (
                <AvatarImage src={editor.avatarUrl} alt={editor.username} />
              )}
              <AvatarFallback userName={editor.username} />
            </Avatar>
            <div className="flex-1 min-w-0">
              <span className="font-medium">{editor.username}</span>
              {editor.fieldName && (
                <span className="text-muted-foreground">
                  {' '}
                  editing {formatFieldName(editor.fieldName)}
                </span>
              )}
            </div>
            <span className="text-muted-foreground text-xs">
              {formatEditingDuration(editor.startedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ============================================================================
// ICONS
// ============================================================================

function PencilIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}
