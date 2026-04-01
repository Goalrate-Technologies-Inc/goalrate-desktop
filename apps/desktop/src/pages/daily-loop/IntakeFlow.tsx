import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, Plus, X, Target } from 'lucide-react';
import { GoalRateIcon } from '../../components/GoalRateIcon';
import { useVault } from '../../context/VaultContext';

interface IntakeFlowProps {
  onComplete: () => void;
  hasVault: boolean;
}

interface DomainEntry {
  id: string;
  name: string;
}

interface GoalEntry {
  id: string;
  domain: string;
  title: string;
  deadline: string;
}

interface TaskEntry {
  id: string;
  goalId: string;
  title: string;
}

let nextId = 0;
function genId(): string {
  return `intake_${++nextId}`;
}

/* Shared inline-style objects to keep JSX readable */
const S = {
  heading: { color: 'var(--text-primary)' } as const,
  body: { color: 'var(--text-secondary)' } as const,
  muted: { color: 'var(--text-muted)' } as const,
  accent: { color: 'var(--accent-goals)' } as const,
  input: { borderColor: 'var(--border)', color: 'var(--text-primary)', backgroundColor: 'var(--surface)' } as const,
  inputSecondary: { borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface)' } as const,
  btn: { backgroundColor: 'var(--btn-bg)', color: 'var(--btn-text)' } as const,
  btnOutline: { borderColor: 'var(--border)', color: 'var(--text-secondary)' } as const,
  error: { color: 'var(--semantic-error)' } as const,
};

export function IntakeFlow({ onComplete, hasVault }: IntakeFlowProps): React.ReactElement {
  const { currentVault, createVault } = useVault();
  const [step, setStep] = useState(hasVault ? 1 : 0);
  const [vaultName, setVaultName] = useState('My Vault');
  const [domains, setDomains] = useState<DomainEntry[]>([
    { id: genId(), name: '' },
    { id: genId(), name: '' },
  ]);
  const [goals, setGoals] = useState<GoalEntry[]>([]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addDomain = useCallback(() => {
    if (domains.length >= 6) {return;}
    setDomains((prev) => [...prev, { id: genId(), name: '' }]);
  }, [domains.length]);

  const removeDomain = useCallback((id: string) => {
    setDomains((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const updateDomain = useCallback((id: string, name: string) => {
    setDomains((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
  }, []);

  const validDomains = domains.filter((d) => d.name.trim().length > 0);

  const addGoal = useCallback((domain: string) => {
    setGoals((prev) => [...prev, { id: genId(), domain, title: '', deadline: '' }]);
  }, []);

  const updateGoal = useCallback((id: string, field: 'title' | 'deadline', value: string) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
  }, []);

  const removeGoal = useCallback((id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    setTasks((prev) => prev.filter((t) => t.goalId !== id));
  }, []);

  const addTask = useCallback((goalId: string) => {
    setTasks((prev) => [...prev, { id: genId(), goalId, title: '' }]);
  }, []);

  const updateTask = useCallback((id: string, title: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCreateVault = useCallback(async () => {
    if (!vaultName.trim()) {return;}
    try {
      // Path is resolved on the Rust side when omitted
      await createVault(vaultName.trim());
      setStep(1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'string' ? err : typeof (err as Record<string, unknown>)?.message === 'string' ? (err as Record<string, unknown>).message as string : JSON.stringify(err));
    }
  }, [vaultName, createVault]);

  const goToGoals = useCallback(() => {
    if (validDomains.length === 0) {return;}
    // Seed one goal per domain if none exist
    if (goals.length === 0) {
      setGoals(validDomains.map((d) => ({ id: genId(), domain: d.name, title: '', deadline: '' })));
    }
    setStep(2);
  }, [validDomains, goals.length]);

  const goToTasks = useCallback(() => {
    const validGoals = goals.filter((g) => g.title.trim().length > 0);
    if (validGoals.length === 0) {return;}
    // Seed one task per goal if none exist
    if (tasks.length === 0) {
      setTasks(validGoals.map((g) => ({ id: genId(), goalId: g.id, title: '' })));
    }
    setStep(3);
  }, [goals, tasks.length]);

  const handleFinish = useCallback(async () => {
    const vaultId = currentVault?.id;
    if (!vaultId) {return;}

    setIsSubmitting(true);
    setError(null);

    try {
      const validGoals = goals.filter((g) => g.title.trim().length > 0);

      // Create goals with their tasks via vault commands
      for (const goal of validGoals) {
        const goalTasks = tasks
          .filter((t) => t.goalId === goal.id && t.title.trim().length > 0)
          .map((t) => ({ title: t.title.trim() }));

        await invoke('create_goal', {
          vaultId,
          data: {
            title: goal.title.trim(),
            goalType: goal.domain || 'Personal',
            deadline: goal.deadline || '',
            tags: goal.domain ? [goal.domain] : [],
            tasks: goalTasks,
          },
        });
      }

      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : typeof err === 'string' ? err : typeof (err as Record<string, unknown>)?.message === 'string' ? (err as Record<string, unknown>).message as string : JSON.stringify(err));
      setIsSubmitting(false);
    }
  }, [currentVault?.id, goals, tasks, onComplete]);

  return (
    <div className="w-full max-w-lg px-6">
        {/* Progress indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {[0, 1, 2, 3].slice(hasVault ? 1 : 0).map((s) => (
            <div
              key={s}
              className="h-1.5 w-8 rounded-full transition-colors"
              style={{ backgroundColor: step >= s ? 'var(--accent-goals)' : 'var(--border-light)' }}
            />
          ))}
        </div>

        {/* Step 0: Create vault (only if no vault) */}
        {step === 0 && (
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--surface-warm)' }}>
              <GoalRateIcon className="h-10 w-10" />
            </div>
            <h1 className="font-serif text-3xl" style={S.heading}>Welcome to GoalRate</h1>
            <p className="mt-2 text-sm" style={S.body}>
              Your AI Chief of Staff needs a vault to store your goals and plans locally.
            </p>
            <input
              type="text"
              value={vaultName}
              onChange={(e) => setVaultName(e.target.value)}
              placeholder="Vault name"
              className="mt-6 w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent-goals"
              style={S.input}
              onKeyDown={(e) => { if (e.key === 'Enter') {handleCreateVault();} }}
            />
            <button
              onClick={handleCreateVault}
              disabled={!vaultName.trim()}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              style={S.btn}
            >
              Create Vault <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Step 1: Domains */}
        {step === 1 && (
          <div>
            <h1 className="font-serif text-3xl" style={S.heading}>What domains do you juggle?</h1>
            <p className="mt-2 text-sm" style={S.body}>
              Name 2-4 areas of your life or work. Examples: &quot;Startup&quot;, &quot;Freelance&quot;, &quot;Fitness&quot;, &quot;Side Project&quot;
            </p>
            <div className="mt-6 space-y-2">
              {domains.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => updateDomain(d.id, e.target.value)}
                    placeholder="e.g., Startup"
                    className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-goals"
                    style={S.input}
                  />
                  {domains.length > 1 && (
                    <button onClick={() => removeDomain(d.id)} className="rounded p-1" style={{ backgroundColor: 'transparent' }}>
                      <X className="h-4 w-4" style={S.muted} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {domains.length < 6 && (
              <button
                onClick={addDomain}
                className="mt-2 inline-flex items-center gap-1 text-xs"
                style={S.accent}
              >
                <Plus className="h-3 w-3" /> Add domain
              </button>
            )}
            <button
              onClick={goToGoals}
              disabled={validDomains.length === 0}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              style={S.btn}
            >
              Next: Set Goals <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Step 2: Goals per domain */}
        {step === 2 && (
          <div>
            <h1 className="font-serif text-3xl" style={S.heading}>Set goals for each domain</h1>
            <p className="mt-2 text-sm" style={S.body}>
              1-3 goals per domain. What are you trying to achieve?
            </p>
            <div className="mt-6 max-h-[400px] space-y-4 overflow-y-auto">
              {validDomains.map((domain) => (
                <div key={domain.id}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5" style={S.accent} />
                    <span className="font-mono text-xs font-medium uppercase tracking-wider" style={S.muted}>
                      {domain.name}
                    </span>
                  </div>
                  {goals
                    .filter((g) => g.domain === domain.name)
                    .map((g) => (
                      <div key={g.id} className="mb-1.5 flex items-center gap-2">
                        <input
                          type="text"
                          value={g.title}
                          onChange={(e) => updateGoal(g.id, 'title', e.target.value)}
                          placeholder="e.g., Launch MVP by April 1"
                          className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-goals"
                          style={S.input}
                        />
                        <input
                          type="date"
                          value={g.deadline}
                          onChange={(e) => updateGoal(g.id, 'deadline', e.target.value)}
                          className="w-32 rounded-lg border px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-accent-goals"
                          style={S.inputSecondary}
                        />
                        <button onClick={() => removeGoal(g.id)} className="rounded p-1">
                          <X className="h-3.5 w-3.5" style={S.muted} />
                        </button>
                      </div>
                    ))}
                  <button
                    onClick={() => addGoal(domain.name)}
                    className="inline-flex items-center gap-1 text-xs"
                    style={S.accent}
                  >
                    <Plus className="h-3 w-3" /> Add goal
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="rounded-lg border px-4 py-2.5 text-sm"
                style={S.btnOutline}
              >
                Back
              </button>
              <button
                onClick={goToTasks}
                disabled={goals.filter((g) => g.title.trim()).length === 0}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                style={S.btn}
              >
                Next: Add Tasks <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Tasks */}
        {step === 3 && (
          <div>
            <h1 className="font-serif text-3xl" style={S.heading}>What&apos;s on your plate?</h1>
            <p className="mt-2 text-sm" style={S.body}>
              Add current tasks to any goal. You can always add more later.
            </p>
            <div className="mt-6 max-h-[400px] space-y-4 overflow-y-auto">
              {goals
                .filter((g) => g.title.trim().length > 0)
                .map((goal) => (
                  <div key={goal.id}>
                    <div className="mb-1 text-sm font-medium" style={S.heading}>
                      {goal.title}
                    </div>
                    {tasks
                      .filter((t) => t.goalId === goal.id)
                      .map((t) => (
                        <div key={t.id} className="mb-1 flex items-center gap-2">
                          <input
                            type="text"
                            value={t.title}
                            onChange={(e) => updateTask(t.id, e.target.value)}
                            placeholder="e.g., Write API endpoint"
                            className="flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-goals"
                            style={S.input}
                          />
                          <button onClick={() => removeTask(t.id)} className="rounded p-1">
                            <X className="h-3.5 w-3.5" style={S.muted} />
                          </button>
                        </div>
                      ))}
                    <button
                      onClick={() => addTask(goal.id)}
                      className="inline-flex items-center gap-1 text-xs"
                      style={S.accent}
                    >
                      <Plus className="h-3 w-3" /> Add task
                    </button>
                  </div>
                ))}
            </div>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setStep(2)}
                className="rounded-lg border px-4 py-2.5 text-sm"
                style={S.btnOutline}
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                disabled={isSubmitting}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                style={S.btn}
              >
                {isSubmitting ? 'Setting up...' : 'Start Planning'}
                {!isSubmitting && <GoalRateIcon className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-sm" style={S.error}>{error}</p>
        )}
    </div>
  );
}
