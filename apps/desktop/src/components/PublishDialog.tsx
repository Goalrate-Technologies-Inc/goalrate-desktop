import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@goalrate-app/ui/overlay';
import { Button, Input, Label, Textarea } from '@goalrate-app/ui/primitives';
import { Badge } from '@goalrate-app/ui/feedback';
import { Loader2, UploadCloud, X } from 'lucide-react';
import { authenticatedRequest, hasAccessToken, isOnline } from '../lib/apiClient';

type PublishSourceType = 'goal' | 'goal_task' | 'milestone' | 'task';

type PublishDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: PublishSourceType;
  sourceId: string;
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  defaultTimeSpentMinutes?: number;
  defaultProgress?: number;
  defaultStreakCount?: number;
  onPublished?: () => void;
};

type UploadPresignResponse = {
  upload_url: string;
  public_url: string;
  key: string;
  expires_in: number;
};

const parseTags = (raw: string): string[] =>
  raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const parseOptionalNumber = (value: string): number | undefined => {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function PublishDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  defaultTitle,
  defaultDescription,
  defaultTags,
  defaultTimeSpentMinutes,
  defaultProgress,
  defaultStreakCount,
  onPublished,
}: PublishDialogProps): React.ReactElement {
  const [title, setTitle] = useState(defaultTitle ?? '');
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [tags, setTags] = useState((defaultTags ?? []).join(', '));
  const [timeSpent, setTimeSpent] = useState(
    defaultTimeSpentMinutes ? String(defaultTimeSpentMinutes) : ''
  );
  const [progress, setProgress] = useState(
    defaultProgress !== undefined ? String(defaultProgress) : ''
  );
  const [streakCount, setStreakCount] = useState(
    defaultStreakCount !== undefined ? String(defaultStreakCount) : ''
  );
  const [files, setFiles] = useState<File[]>([]);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canPublish = useMemo(() => !accessError && !isCheckingAccess, [accessError, isCheckingAccess]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle(defaultTitle ?? '');
    setDescription(defaultDescription ?? '');
    setTags((defaultTags ?? []).join(', '));
    setTimeSpent(defaultTimeSpentMinutes ? String(defaultTimeSpentMinutes) : '');
    setProgress(defaultProgress !== undefined ? String(defaultProgress) : '');
    setStreakCount(defaultStreakCount !== undefined ? String(defaultStreakCount) : '');
    setFiles([]);
    setPublishError(null);
  }, [
    open,
    defaultTitle,
    defaultDescription,
    defaultTags,
    defaultTimeSpentMinutes,
    defaultProgress,
    defaultStreakCount,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const checkAccess = async (): Promise<void> => {
      setIsCheckingAccess(true);
      setAccessError(null);

      if (!isOnline()) {
        setAccessError('Connect to the internet to publish.');
        setIsCheckingAccess(false);
        return;
      }

      if (!hasAccessToken()) {
        setAccessError('Sign in to publish to the web feed.');
        setIsCheckingAccess(false);
        return;
      }

      try {
        const result = await authenticatedRequest((client) =>
          client.get<{ available: boolean }>('/api/subscriptions/me/features/public_publish')
        );
        if (!result.data.available) {
          setAccessError('Publishing requires a Pro, Team, or Enterprise plan.');
        }
      } catch (err) {
        setAccessError(err instanceof Error ? err.message : 'Unable to verify subscription.');
      } finally {
        setIsCheckingAccess(false);
      }
    };

    void checkAccess();
  }, [open]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length === 0) {
      return;
    }
    setFiles((prev) => {
      const existing = new Map(prev.map((file) => [`${file.name}:${file.size}`, file]));
      nextFiles.forEach((file) => {
        existing.set(`${file.name}:${file.size}`, file);
      });
      return Array.from(existing.values());
    });
    event.target.value = '';
  };

  const handleRemoveFile = (index: number): void => {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handlePublish = useCallback(async (): Promise<void> => {
    if (!sourceId) {
      setPublishError('Missing source information for publishing.');
      return;
    }
    if (!title.trim()) {
      setPublishError('Please add a title before publishing.');
      return;
    }
    if (!canPublish) {
      setPublishError(accessError || 'Publishing is currently unavailable.');
      return;
    }

    setIsPublishing(true);
    setPublishError(null);

    try {
      const uploadedMedia = [];
      for (const file of files) {
        const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
        const presign = await authenticatedRequest((client) =>
          client.post<UploadPresignResponse>('/api/uploads/presign', {
            file_name: file.name,
            content_type: file.type || 'application/octet-stream',
            media_type: mediaType,
            size_bytes: file.size,
          })
        );
        const uploadResponse = await fetch(presign.data.upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${file.name}`);
        }
        uploadedMedia.push({
          url: presign.data.public_url,
          media_type: mediaType,
          size_bytes: file.size,
        });
      }

      const payload = {
        source_type: sourceType,
        source_id: sourceId,
        title: title.trim(),
        description: description.trim() || undefined,
        time_spent_minutes: parseOptionalNumber(timeSpent),
        tags: parseTags(tags),
        media: uploadedMedia,
        progress: parseOptionalNumber(progress),
        streak_count: parseOptionalNumber(streakCount),
      };

      await authenticatedRequest((client) =>
        client.post('/api/publications', payload)
      );

      onPublished?.();
      onOpenChange(false);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish.');
    } finally {
      setIsPublishing(false);
    }
  }, [
    accessError,
    canPublish,
    description,
    files,
    onOpenChange,
    onPublished,
    progress,
    sourceId,
    sourceType,
    streakCount,
    tags,
    timeSpent,
    title,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Publish to the web feed</DialogTitle>
          <DialogDescription>
            Add the details you want to share. You are always in control of what goes public.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {accessError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {accessError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="publish-title">Title</Label>
            <Input
              id="publish-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Give this publication a strong headline"
              disabled={isPublishing}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-description">Description</Label>
            <Textarea
              id="publish-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add context, highlights, or a story behind the work"
              rows={4}
              disabled={isPublishing}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="publish-time">Time spent (minutes)</Label>
              <Input
                id="publish-time"
                type="number"
                min="0"
                value={timeSpent}
                onChange={(event) => setTimeSpent(event.target.value)}
                disabled={isPublishing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="publish-progress">Progress (%)</Label>
              <Input
                id="publish-progress"
                type="number"
                min="0"
                max="100"
                value={progress}
                onChange={(event) => setProgress(event.target.value)}
                disabled={isPublishing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="publish-streak">Streak</Label>
              <Input
                id="publish-streak"
                type="number"
                min="0"
                value={streakCount}
                onChange={(event) => setStreakCount(event.target.value)}
                disabled={isPublishing}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="publish-tags">Tags</Label>
            <Input
              id="publish-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="design, launch, milestone"
              disabled={isPublishing}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Media</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isPublishing}
                className="gap-2"
              >
                <UploadCloud className="h-4 w-4" />
                Add media
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/*,video/*"
                multiple
                onChange={handleFileChange}
              />
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <Badge key={`${file.name}:${file.size}`} className="gap-1">
                    <span className="max-w-[160px] truncate">{file.name}</span>
                    <button
                      type="button"
                      className="ml-1 inline-flex"
                      onClick={() => handleRemoveFile(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {publishError && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              {publishError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPublishing}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing || isCheckingAccess || Boolean(accessError)}
          >
            {isPublishing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Publishing...
              </>
            ) : (
              'Publish now'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
