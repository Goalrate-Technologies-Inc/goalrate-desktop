/**
 * Markdown Editor Component
 * A simple textarea-based markdown editor with preview toggle
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, Textarea } from '@goalrate-app/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@goalrate-app/ui/navigation';
import { Edit3, Eye, Save, Loader2, Undo2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MAX_UNDO_DEPTH = 50;

interface MarkdownEditorProps {
  /** Initial markdown content */
  value: string;
  /** Callback when content changes */
  onChange?: (value: string) => void;
  /** Callback when save is requested */
  onSave?: (value: string) => Promise<void>;
  /** Placeholder text */
  placeholder?: string;
  /** Minimum height of the editor */
  minHeight?: number;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Label for the editor section */
  label?: string;
  /** Autosave after changes settle */
  autosave?: boolean;
  /** Debounce window for autosave */
  autosaveDelayMs?: number;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder = 'Write your notes here using Markdown...',
  minHeight = 200,
  readOnly = false,
  label = 'Notes',
  autosave = true,
  autosaveDelayMs = 300,
}: MarkdownEditorProps): React.ReactElement {
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const localValueRef = useRef(value);
  const lastSavedValueRef = useRef(value);
  const undoStackRef = useRef<string[]>([]);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  const pushUndoSnapshot = useCallback((snapshot: string) => {
    const stack = undoStackRef.current;
    if (stack.at(-1) === snapshot) {
      return;
    }
    stack.push(snapshot);
    if (stack.length > MAX_UNDO_DEPTH) {
      stack.shift();
    }
    setUndoDepth(stack.length);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      pushUndoSnapshot(localValue);
      localValueRef.current = newValue;
      setLocalValue(newValue);
      setHasChanges(newValue !== lastSavedValueRef.current);
      setSaveError(null);
      onChange?.(newValue);
    },
    [localValue, onChange, pushUndoSnapshot]
  );

  const handleSave = useCallback(async () => {
    if (!onSave || !hasChanges) {
      return;
    }

    const valueToSave = localValueRef.current;
    setIsSaving(true);
    setSaveError(null);
    let savePromise: Promise<void> | null = null;
    try {
      savePromise = onSave(valueToSave);
      savePromiseRef.current = savePromise;
      await savePromise;
      if (savePromiseRef.current === savePromise) {
        lastSavedValueRef.current = valueToSave;
        setHasChanges(localValueRef.current !== valueToSave);
      }
    } catch (err) {
      if (savePromise !== null && savePromiseRef.current !== savePromise) {
        return;
      }
      console.error('Failed to save:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
      setHasChanges(true);
    } finally {
      if (savePromise === null || savePromiseRef.current === savePromise) {
        setIsSaving(false);
      }
    }
  }, [onSave, hasChanges]);

  useEffect(() => {
    if (!autosave || readOnly || !onSave || !hasChanges) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void handleSave();
    }, autosaveDelayMs);
    return () => window.clearTimeout(timeout);
  }, [autosave, autosaveDelayMs, handleSave, hasChanges, localValue, onSave, readOnly]);

  const handleUndo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (previous === undefined) {
      return;
    }
    setUndoDepth(undoStackRef.current.length);
    localValueRef.current = previous;
    setLocalValue(previous);
    setHasChanges(previous !== lastSavedValueRef.current);
    setSaveError(null);
    onChange?.(previous);
  }, [onChange]);

  // Handle Cmd/Ctrl+S to save
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        <div className="flex items-center gap-2">
          {saveError && (
            <span className="text-xs text-semantic-error">{saveError}</span>
          )}
          {isSaving && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleUndo}
            disabled={undoDepth === 0 || readOnly}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          {onSave && hasChanges && (
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="gap-1.5"
              title="Save"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue={readOnly ? 'preview' : 'edit'} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="edit" disabled={readOnly} className="gap-1.5">
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </TabsTrigger>
          <TabsTrigger value="preview" className="gap-1.5">
            <Eye className="h-3.5 w-3.5" />
            Preview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="mt-2">
          <Textarea
            value={localValue}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="font-mono text-sm resize-y"
            style={{ minHeight }}
            disabled={readOnly}
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <div
            className="prose max-w-none p-4 rounded-md border bg-muted/30 overflow-auto"
            style={{ minHeight }}
          >
            {localValue ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{localValue}</ReactMarkdown>
            ) : (
              <p className="text-muted-foreground italic">No content yet</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
