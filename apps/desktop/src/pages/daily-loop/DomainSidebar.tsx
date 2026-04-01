import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Target, FolderKanban, Rocket, Heart, Dumbbell, GraduationCap,
  Briefcase, Home, Palette, Plus, Pencil, Archive, Trash2, FileText, X,
  ArrowUp, ArrowRight, ArrowDown,
  type LucideIcon,
} from 'lucide-react';
import { useVault } from '../../context/VaultContext';
import { ContextMenu, type ContextMenuItem } from '../../components/ContextMenu';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Icon mapping ────────────────────────────────────────────

const DOMAIN_ICONS: Record<string, LucideIcon> = {
  health: Dumbbell, fitness: Dumbbell, wellness: Heart,
  family: Home, personal: Heart, relationships: Heart,
  career: Briefcase, work: Briefcase, startup: Rocket,
  business: Briefcase, education: GraduationCap,
  learning: GraduationCap, creative: Palette, finance: Briefcase,
  wealth: Briefcase, home: Home,
};

function iconForDomain(domain: string): LucideIcon {
  const lower = domain.toLowerCase();
  for (const [keyword, icon] of Object.entries(DOMAIN_ICONS)) {
    if (lower.includes(keyword)) {return icon;}
  }
  return Target;
}

// ── Types ───────────────────────────────────────────────────

interface GoalSummary {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'var(--semantic-error, #dc2626)',
  medium: 'var(--progress-mid, #C9A227)',
  low: 'var(--text-muted, #9ca3af)',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

interface ContextMenuState {
  x: number;
  y: number;
  type: 'domain' | 'goal';
  domain?: string;
  goalId?: string;
  goalTitle?: string;
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

interface DomainSidebarProps {
  dataVersion?: number;
  onMutation?: () => void;
}

// ── Component ───────────────────────────────────────────────

export function DomainSidebar({ dataVersion = 0, onMutation }: DomainSidebarProps): React.ReactElement {
  const { currentVault } = useVault();
  const vaultId = currentVault?.id;

  // Data
  const [goals, setGoals] = useState<GoalSummary[]>([]);

  // UI state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmState | null>(null);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDomain, setNewGoalDomain] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');
  const [newGoalPriority, setNewGoalPriority] = useState('medium');
  const [editingNotes, setEditingNotes] = useState<{ goalId: string; title: string; notes: string } | null>(null);
  const [viewingNotes, setViewingNotes] = useState<{ goalId: string; title: string; notes: string } | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const addTitleRef = useRef<HTMLInputElement>(null);

  // ── Fetch goals ─────────────────────────────────────────

  useEffect(() => {
    if (!vaultId) {return;}
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const raw = await invoke<Array<{
          id: string; title: string; status?: string; priority?: string;
          type?: string; goalType?: string; description?: string;
        }>>('list_goals', { vaultId });
        if (!cancelled) {
          setGoals(
            raw
              .map((g) => ({
                id: g.id,
                title: g.title || g.id,
                domain: g.type || g.goalType || g.description || 'Uncategorized',
                status: g.status || 'active',
                priority: g.priority || 'medium',
              }))
              .filter((g) => g.status !== 'archived'),
          );
        }
      } catch {
        if (!cancelled) {setGoals([]);}
      }
    }

    load();
    return () => { cancelled = true; };
  }, [vaultId, dataVersion]);

  // Auto-focus edit inputs
  useEffect(() => {
    if (editingGoalId || editingDomain) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingGoalId, editingDomain]);

  useEffect(() => {
    if (showAddGoal) {
      addTitleRef.current?.focus();
    }
  }, [showAddGoal]);

  // ── Group by domain ─────────────────────────────────────

  const byDomain = goals.reduce<Record<string, GoalSummary[]>>((acc, g) => {
    const d = g.domain || 'Uncategorized';
    if (!acc[d]) {acc[d] = [];}
    acc[d].push(g);
    return acc;
  }, {});

  const domainNames = Object.keys(byDomain);

  // ── Mutations ───────────────────────────────────────────

  const mutate = useCallback(() => {
    onMutation?.();
  }, [onMutation]);

  const handleSaveGoalTitle = useCallback(async () => {
    if (!vaultId || !editingGoalId || !editValue.trim()) {
      setEditingGoalId(null);
      return;
    }
    try {
      await invoke('update_goal', {
        vaultId,
        goalId: editingGoalId,
        data: { title: editValue.trim() },
      });
      mutate();
    } catch (err) {
      console.error('Failed to update goal title:', err);
    }
    setEditingGoalId(null);
  }, [vaultId, editingGoalId, editValue, mutate]);

  const handleSaveDomainRename = useCallback(async () => {
    if (!vaultId || !editingDomain || !editValue.trim() || editValue.trim() === editingDomain) {
      setEditingDomain(null);
      return;
    }
    try {
      await invoke('rename_domain', {
        vaultId,
        oldType: editingDomain,
        newType: editValue.trim(),
      });
      mutate();
    } catch (err) {
      console.error('Failed to rename domain:', err);
    }
    setEditingDomain(null);
  }, [vaultId, editingDomain, editValue, mutate]);

  const handleDeleteGoal = useCallback(async (goalId: string) => {
    if (!vaultId) {return;}
    try {
      await invoke('delete_goal', { vaultId, goalId });
      mutate();
    } catch (err) {
      console.error('Failed to delete goal:', err);
    }
  }, [vaultId, mutate]);

  const handleArchiveGoal = useCallback(async (goalId: string) => {
    if (!vaultId) {return;}
    try {
      await invoke('archive_goal', { vaultId, goalId });
      mutate();
    } catch (err) {
      console.error('Failed to archive goal:', err);
    }
  }, [vaultId, mutate]);

  const handleChangePriority = useCallback(async (goalId: string, newPriority: string) => {
    if (!vaultId) {return;}
    try {
      await invoke('update_goal', {
        vaultId,
        goalId,
        data: { priority: newPriority },
      });
      mutate();
    } catch (err) {
      console.error('Failed to change priority:', err);
    }
  }, [vaultId, mutate]);

  const handleChangeGoalDomain = useCallback(async (goalId: string, newType: string) => {
    if (!vaultId) {return;}
    try {
      await invoke('update_goal', {
        vaultId,
        goalId,
        data: { goalType: newType },
      });
      mutate();
    } catch (err) {
      console.error('Failed to change goal domain:', err);
    }
  }, [vaultId, mutate]);

  const handleAddGoal = useCallback(async () => {
    if (!vaultId || !newGoalTitle.trim()) {return;}
    const domain = newGoalDomain === '__other__' ? newDomainName.trim() : newGoalDomain;
    if (!domain) {return;}
    try {
      await invoke('create_goal', {
        vaultId,
        data: {
          title: newGoalTitle.trim(),
          goalType: domain,
          deadline: newGoalDeadline || undefined,
          priority: newGoalPriority,
          tags: [domain],
        },
      });
      setShowAddGoal(false);
      setNewGoalTitle('');
      setNewGoalDomain('');
      setNewDomainName('');
      setNewGoalDeadline('');
      setNewGoalPriority('medium');
      mutate();
    } catch (err) {
      console.error('Failed to create goal:', err);
    }
  }, [vaultId, newGoalTitle, newGoalDomain, newDomainName, newGoalDeadline, newGoalPriority, mutate]);

  const handleViewGoal = useCallback(async (goalId: string, title: string) => {
    if (!vaultId) {return;}
    try {
      const goal = await invoke<{ notes?: string }>('get_goal', { vaultId, goalId });
      setViewingNotes({ goalId, title, notes: goal.notes ?? '' });
    } catch (err) {
      console.error('Failed to load goal:', err);
    }
  }, [vaultId]);

  const handleOpenNotes = useCallback(async (goalId: string, title: string) => {
    if (!vaultId) {return;}
    try {
      const goal = await invoke<{ notes?: string }>('get_goal', { vaultId, goalId });
      setEditingNotes({ goalId, title, notes: goal.notes ?? '' });
    } catch (err) {
      console.error('Failed to load goal notes:', err);
    }
  }, [vaultId]);

  const handleSaveNotes = useCallback(async (content: string) => {
    if (!vaultId || !editingNotes) {return;}
    try {
      await invoke('update_goal', {
        vaultId,
        goalId: editingNotes.goalId,
        data: { notes: content },
      });
      setEditingNotes(null);
      mutate();
    } catch (err) {
      console.error('Failed to save goal notes:', err);
    }
  }, [vaultId, editingNotes, mutate]);

  // ── Context menu builders ───────────────────────────────

  const buildDomainMenuItems = (domain: string): ContextMenuItem[] => [
    {
      label: 'Rename Domain',
      icon: Pencil,
      onClick: () => {
        setEditingDomain(domain);
        setEditValue(domain);
      },
    },
  ];

  const buildGoalMenuItems = (goal: GoalSummary): ContextMenuItem[] => [
    {
      label: 'Rename',
      icon: Pencil,
      onClick: () => {
        setEditingGoalId(goal.id);
        setEditValue(goal.title);
      },
    },
    {
      label: 'Edit Notes',
      icon: FileText,
      onClick: () => handleOpenNotes(goal.id, goal.title),
    },
    {
      label: 'Change Domain',
      icon: FolderKanban,
      onClick: () => {
        // Show a simple prompt-style domain picker via the add-goal domain select
        const newDomain = window.prompt('Move to domain:', goal.domain);
        if (newDomain && newDomain !== goal.domain) {
          handleChangeGoalDomain(goal.id, newDomain);
        }
      },
    },
    { label: '', onClick: () => {}, separator: true },
    ...(goal.priority !== 'high' ? [{
      label: 'High Priority',
      icon: ArrowUp,
      onClick: () => handleChangePriority(goal.id, 'high'),
    }] : []) as ContextMenuItem[],
    ...(goal.priority !== 'medium' ? [{
      label: 'Medium Priority',
      icon: ArrowRight,
      onClick: () => handleChangePriority(goal.id, 'medium'),
    }] : []) as ContextMenuItem[],
    ...(goal.priority !== 'low' ? [{
      label: 'Low Priority',
      icon: ArrowDown,
      onClick: () => handleChangePriority(goal.id, 'low'),
    }] : []) as ContextMenuItem[],
    { label: '', onClick: () => {}, separator: true },
    {
      label: 'Archive',
      icon: Archive,
      onClick: () => handleArchiveGoal(goal.id),
    },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      onClick: () => {
        setConfirmAction({
          title: 'Delete Goal',
          message: `Are you sure you want to delete "${goal.title}"? This cannot be undone.`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: () => {
            handleDeleteGoal(goal.id);
            setConfirmAction(null);
          },
        });
      },
    },
  ];

  // ── Key handlers ────────────────────────────────────────

  const handleEditKeyDown = (e: React.KeyboardEvent, save: () => void): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      setEditingGoalId(null);
      setEditingDomain(null);
    }
  };

  // ── Render ──────────────────────────────────────────────

  return (
    <aside
      className="flex w-60 shrink-0 flex-col overflow-y-auto border-r p-4"
      style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--bg-subtle)' }}
    >
      <h2 className="mb-4 font-serif text-lg font-normal" style={{ color: 'var(--text-secondary)' }}>
        Domains
      </h2>

      <div className="flex-1">
        {Object.entries(byDomain).map(([domain, domainGoals]) => {
          const DomainIcon = iconForDomain(domain);
          const isEditingThisDomain = editingDomain === domain;

          return (
            <div key={domain} className="mb-4">
              {/* Domain header */}
              <div
                className="mb-1 flex items-center gap-1.5"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, type: 'domain', domain });
                }}
              >
                <DomainIcon className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                {isEditingThisDomain ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleSaveDomainRename}
                    onKeyDown={(e) => handleEditKeyDown(e, handleSaveDomainRename)}
                    className="w-full rounded border border-border bg-surface px-1 font-mono text-xs font-medium uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  />
                ) : (
                  <span className="cursor-default font-mono text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    {domain}
                  </span>
                )}
              </div>

              {/* Goals list */}
              <ul className="space-y-0.5 pl-5">
                {domainGoals.map((g) => {
                  const isEditing = editingGoalId === g.id;
                  return (
                    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
                    <li
                      key={g.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded py-0.5 hover:bg-surface-warm"
                      onMouseUp={(e) => { if (e.button === 0 && !contextMenu) {handleViewGoal(g.id, g.title);} }}
                      onDoubleClick={() => {
                        setEditingGoalId(g.id);
                        setEditValue(g.title);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          type: 'goal',
                          goalId: g.id,
                          goalTitle: g.title,
                          domain: g.domain,
                        });
                      }}
                    >
                      <span
                        className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: PRIORITY_COLORS[g.priority] || PRIORITY_COLORS.medium }}
                        title={`${PRIORITY_LABELS[g.priority] || 'Medium'} priority`}
                      />
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleSaveGoalTitle}
                          onKeyDown={(e) => handleEditKeyDown(e, handleSaveGoalTitle)}
                          className="w-full rounded border border-border bg-surface px-1 text-sm"
                          style={{ color: 'var(--text-primary)' }}
                        />
                      ) : (
                        <span className="truncate text-sm" style={{ color: 'var(--text-secondary)' }}>
                          {g.title}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        {goals.length === 0 && !showAddGoal && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No goals yet. Add a goal to get started.
          </p>
        )}
      </div>

      {/* Add Goal form */}
      {showAddGoal ? (
        <div className="mt-2 space-y-2 rounded-lg border border-border-light bg-surface p-3">
          <input
            ref={addTitleRef}
            type="text"
            placeholder="Goal title"
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {handleAddGoal();}
              if (e.key === 'Escape') {setShowAddGoal(false);}
            }}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          <select
            value={newGoalDomain}
            onChange={(e) => setNewGoalDomain(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="">Select domain...</option>
            {domainNames.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
            <option value="__other__">Other...</option>
          </select>
          {newGoalDomain === '__other__' && (
            <input
              type="text"
              placeholder="New domain name"
              value={newDomainName}
              onChange={(e) => setNewDomainName(e.target.value)}
              className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
              style={{ color: 'var(--text-primary)' }}
            />
          )}
          <input
            type="date"
            placeholder="Deadline"
            value={newGoalDeadline}
            onChange={(e) => setNewGoalDeadline(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: 'var(--text-primary)' }}
          />
          <select
            value={newGoalPriority}
            onChange={(e) => setNewGoalPriority(e.target.value)}
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            style={{ color: 'var(--text-primary)' }}
          >
            <option value="low">Low priority</option>
            <option value="medium">Medium priority</option>
            <option value="high">High priority</option>
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleAddGoal}
              disabled={!newGoalTitle.trim() || (!newGoalDomain || (newGoalDomain === '__other__' && !newDomainName.trim()))}
              className="flex-1 rounded-md bg-text-primary px-2 py-1 text-sm text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Add Goal
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddGoal(false);
                setNewGoalTitle('');
                setNewGoalDomain('');
                setNewDomainName('');
                setNewGoalDeadline('');
                setNewGoalPriority('medium');
              }}
              className="rounded-md border border-border px-2 py-1 text-sm transition-colors hover:bg-surface-warm"
              style={{ color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddGoal(true)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-sm transition-colors hover:bg-surface-warm"
          style={{ color: 'var(--text-muted)' }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Goal
        </button>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={
            contextMenu.type === 'domain'
              ? buildDomainMenuItems(contextMenu.domain!)
              : buildGoalMenuItems(
                  goals.find((g) => g.id === contextMenu.goalId) ?? {
                    id: contextMenu.goalId!,
                    title: contextMenu.goalTitle!,
                    domain: contextMenu.domain!,
                    status: 'active',
                  },
                )
          }
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Confirm dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Goal preview modal */}
      {viewingNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" role="button" tabIndex={0} aria-label="Close" onClick={() => setViewingNotes(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') {setViewingNotes(null);} }} />
          <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border-light bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
              <h3 className="font-serif text-lg text-text-primary">{viewingNotes.title}</h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setViewingNotes(null);
                    handleOpenNotes(viewingNotes.goalId, viewingNotes.title);
                  }}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewingNotes(null)}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {viewingNotes.notes ? (
                <div className="prose max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewingNotes.notes}</ReactMarkdown>
                </div>
              ) : (
                <p className="italic text-text-muted">No notes yet. Click the pencil icon to add notes.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Notes editor modal */}
      {editingNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" role="button" tabIndex={0} aria-label="Close" onClick={() => setEditingNotes(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') {setEditingNotes(null);} }} />
          <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border-light bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
              <h3 className="font-serif text-lg text-text-primary">{editingNotes.title}</h3>
              <button
                type="button"
                onClick={() => setEditingNotes(null)}
                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-warm hover:text-text-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <MarkdownEditor
                value={editingNotes.notes}
                onSave={handleSaveNotes}
                placeholder="Write notes about this goal..."
                minHeight={300}
                label="Goal Notes"
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
