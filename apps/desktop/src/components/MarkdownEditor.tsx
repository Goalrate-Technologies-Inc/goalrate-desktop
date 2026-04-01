/**
 * Markdown Editor Component
 * A simple textarea-based markdown editor with preview toggle
 */

import { useState, useCallback } from 'react';
import { Button, Textarea } from '@goalrate-app/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@goalrate-app/ui/navigation';
import { Edit3, Eye, Save, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  placeholder = 'Write your notes here using Markdown...',
  minHeight = 200,
  readOnly = false,
  label = 'Notes',
}: MarkdownEditorProps): React.ReactElement {
  const [localValue, setLocalValue] = useState(value);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);
      setHasChanges(newValue !== value);
      onChange?.(newValue);
    },
    [onChange, value]
  );

  const handleSave = useCallback(async () => {
    if (!onSave || !hasChanges) {
      return;
    }

    setIsSaving(true);
    try {
      await onSave(localValue);
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setIsSaving(false);
    }
  }, [onSave, localValue, hasChanges]);

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
        {onSave && hasChanges && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="gap-1.5"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save
              </>
            )}
          </Button>
        )}
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
          <p className="mt-1 text-xs text-muted-foreground">
            Supports Markdown formatting. Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+S to save.
          </p>
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
