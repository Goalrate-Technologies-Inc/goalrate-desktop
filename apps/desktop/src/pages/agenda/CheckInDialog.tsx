import { useCallback, useState } from "react";
import { Check, X, CalendarCheck, ArrowRight, Loader2 } from "lucide-react";
import type { UseAgendaReturn } from "../../hooks/useAgenda";

interface CheckInDialogProps {
  agenda: UseAgendaReturn;
  completedTasks: Set<string>;
  open: boolean;
  onClose: () => void;
}

export function CheckInDialog({
  agenda,
  completedTasks,
  open,
  onClose,
}: CheckInDialogProps): React.ReactElement | null {
  const { plan, taskTitles } = agenda;
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const taskOrder = plan?.taskOrder ?? [];
  const doneTasks = taskOrder.filter((id) => completedTasks.has(id));
  const remainingTasks = taskOrder.filter((id) => !completedTasks.has(id));

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Defer remaining tasks to tomorrow
      for (const taskId of remainingTasks) {
        await agenda.deferTask(taskId);
      }

      // Create check-in with completed task IDs
      await agenda.createCheckIn(doneTasks, notes || undefined);

      setNotes("");
      onClose();
    } catch {
      // Error handled in hook
    } finally {
      setIsSubmitting(false);
    }
  }, [remainingTasks, doneTasks, notes, agenda, onClose]);

  if (!open) {
    return null;
  }

  const taskLabel = (id: string): string =>
    taskTitles[id] ||
    id
      .replace(/^task_/, "")
      .replace(/_/g, " ")
      .replace(/\b\w/, (c) => c.toUpperCase());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-lg rounded-xl bg-surface p-6 shadow-lg">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-accent-goals" />
            <h2 className="font-serif text-xl text-text-primary">
              End-of-Day Check-In
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-surface-warm"
          >
            <X className="h-4 w-4 text-text-muted" />
          </button>
        </div>

        <div className="mb-4 max-h-72 space-y-4 overflow-y-auto">
          {/* Completed tasks */}
          {doneTasks.length > 0 && (
            <section>
              <h3 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-progress-high">
                Completed ({doneTasks.length})
              </h3>
              <ul className="space-y-1">
                {doneTasks.map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-progress-high bg-progress-high text-white">
                      <Check className="h-3 w-3" />
                    </div>
                    <span className="text-sm text-text-muted line-through">
                      {taskLabel(id)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Remaining tasks → deferred to tomorrow */}
          {remainingTasks.length > 0 && (
            <section>
              <h3 className="mb-2 font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
                Moving to tomorrow ({remainingTasks.length})
              </h3>
              <ul className="space-y-1">
                {remainingTasks.map((id) => (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    <ArrowRight className="h-4 w-4 shrink-0 text-text-muted" />
                    <span className="text-sm text-text-secondary">
                      {taskLabel(id)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {taskOrder.length === 0 && (
            <p className="text-sm text-text-muted">No tasks in the Agenda.</p>
          )}
        </div>

        {/* Reflections */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any reflections on today? (optional)"
          rows={3}
          className="mb-4 w-full resize-none rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-goals focus:outline-none"
        />

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary hover:bg-surface-warm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-text-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-text-secondary disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Complete Check-In"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
