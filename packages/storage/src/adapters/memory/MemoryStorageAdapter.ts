/**
 * Memory Storage Adapter
 * In-memory implementation for testing and development
 */

import type {
  StorageAdapter,
  StorageResult,
  GoalQueryOptions,
  ProjectQueryOptions,
  FocusQueryOptions,
  SearchOptions,
  Vault,
  VaultConfig,
  VaultCreate,
  VaultUpdate,
  VaultListItem,
  VaultSettings,
  VaultStats,
  VaultSearchResult,
  VaultSyncState,
  SmartGoal,
  GoalTask,
  GoalCreate,
  GoalUpdate,
  Project,
  ProjectCreate,
  ProjectUpdate,
  BoardColumn,
  Epic,
  EpicCreate,
  EpicUpdate,
  Sprint,
  SprintCreate,
  SprintUpdate,
  BurndownEntry,
  Retrospective,
  FocusDay,
  FocusCandidate,
  FocusHistory,
  FocusVelocity,
} from '../../interface';
import type { ExtendedPriority, Priority } from '@goalrate-app/shared';
import { createStorageError, wrapSuccess, wrapError } from '../../errors';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function now(): string {
  return new Date().toISOString();
}

function normalizePriority(priority?: Priority | ExtendedPriority): Priority {
  switch (priority) {
    case 'lowest':
      return 'low';
    case 'highest':
      return 'critical';
    case undefined:
      return 'medium';
    default:
      return priority;
  }
}

// ============================================================================
// MEMORY STORAGE ADAPTER
// ============================================================================

/**
 * In-memory storage adapter for testing
 * Stores all data in Maps and objects
 */
export class MemoryStorageAdapter implements StorageAdapter {

  // Data stores
  private vaults = new Map<string, Vault>();
  private vaultSettings = new Map<string, VaultSettings>();
  private goals = new Map<string, SmartGoal>(); // key: vaultId:goalId
  private goalTasks = new Map<string, GoalTask>(); // key: vaultId:goalId:taskId
  private projects = new Map<string, Project>(); // key: vaultId:projectId
  private epics = new Map<string, Epic>(); // key: vaultId:projectId:epicId
  private sprints = new Map<string, Sprint>(); // key: vaultId:projectId:sprintId
  private retrospectives = new Map<string, Retrospective>(); // key: sprintId
  private focusDays = new Map<string, FocusDay>(); // key: vaultId:date

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async initialize(): Promise<StorageResult<void>> {
    return wrapSuccess(undefined);
  }

  async dispose(): Promise<void> {
    this.vaults.clear();
    this.vaultSettings.clear();
    this.goals.clear();
    this.goalTasks.clear();
    this.projects.clear();
    this.epics.clear();
    this.sprints.clear();
    this.retrospectives.clear();
    this.focusDays.clear();
  }

  supportsSync(): boolean {
    return false;
  }

  // -------------------------------------------------------------------------
  // Vault Operations
  // -------------------------------------------------------------------------

  async listVaults(): Promise<StorageResult<VaultListItem[]>> {
    const items: VaultListItem[] = [];

    for (const vault of this.vaults.values()) {
      const goalCount = this.countGoalsForVault(vault.id);
      const projectCount = this.countProjectsForVault(vault.id);

      items.push({
        id: vault.id,
        name: vault.name,
        path: vault.path,
        type: vault.type,
        lastOpened: vault.lastOpened,
        goalCount,
        projectCount,
        isSynced: vault.syncEnabled ?? false,
      });
    }

    return wrapSuccess(items);
  }

  async openVault(identifier: string): Promise<StorageResult<Vault>> {
    // Try to find by ID first, then by path
    let vault = this.vaults.get(identifier);

    if (!vault) {
      for (const v of this.vaults.values()) {
        if (v.path === identifier) {
          vault = v;
          break;
        }
      }
    }

    if (!vault) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${identifier}`));
    }

    // Update last opened
    vault.lastOpened = now();
    this.vaults.set(vault.id, vault);

    return wrapSuccess(vault);
  }

  async createVault(data: VaultCreate): Promise<StorageResult<VaultConfig>> {
    // Check for existing vault at path
    for (const vault of this.vaults.values()) {
      if (vault.path === data.path) {
        return wrapError(
          createStorageError('VAULT_ALREADY_EXISTS', `Vault already exists at: ${data.path}`)
        );
      }
    }

    const id = generateId('vault');
    const config: VaultConfig = {
      id,
      name: data.name,
      path: data.path,
      type: data.type,
      created: now(),
    };

    const vault: Vault = {
      ...config,
      goals: [],
      projects: [],
      focusDays: [],
    };

    this.vaults.set(id, vault);

    if (data.settings) {
      this.vaultSettings.set(id, data.settings as VaultSettings);
    }

    return wrapSuccess(config);
  }

  async updateVault(vaultId: string, data: VaultUpdate): Promise<StorageResult<VaultConfig>> {
    const vault = this.vaults.get(vaultId);

    if (!vault) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    if (data.name !== undefined) {vault.name = data.name;}
    if (data.type !== undefined) {vault.type = data.type;}
    if (data.syncEnabled !== undefined) {vault.syncEnabled = data.syncEnabled;}

    this.vaults.set(vaultId, vault);

    const config: VaultConfig = {
      id: vault.id,
      name: vault.name,
      path: vault.path,
      type: vault.type,
      created: vault.created,
      lastOpened: vault.lastOpened,
      syncEnabled: vault.syncEnabled,
    };

    return wrapSuccess(config);
  }

  async closeVault(_vaultId: string): Promise<StorageResult<void>> {
    return wrapSuccess(undefined);
  }

  async deleteVault(vaultId: string): Promise<StorageResult<void>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    // Delete all related data
    this.deleteVaultData(vaultId);
    this.vaults.delete(vaultId);
    this.vaultSettings.delete(vaultId);

    return wrapSuccess(undefined);
  }

  async getVaultStats(vaultId: string): Promise<StorageResult<VaultStats>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const goals = this.getGoalsForVault(vaultId);
    const projects = this.getProjectsForVault(vaultId);
    const allTasks = this.getGoalTasksForVault(vaultId);
    const focusDays = this.getFocusDaysForVault(vaultId);

    const activeGoals = goals.filter((g) => g.status === 'active').length;
    const completedGoals = goals.filter((g) => g.status === 'completed').length;
    const activeProjects = projects.filter((p) => p.status === 'active').length;
    const completedTasks = allTasks.filter((t) => t.column === 'done').length;

    const completionRates = focusDays.map((fd) =>
      fd.plannedPoints > 0 ? fd.completedPoints / fd.plannedPoints : 0
    );
    const averageCompletionRate =
      completionRates.length > 0
        ? completionRates.reduce((a, b) => a + b, 0) / completionRates.length
        : 0;

    return wrapSuccess({
      vaultId,
      totalGoals: goals.length,
      activeGoals,
      completedGoals,
      totalProjects: projects.length,
      activeProjects,
      totalTasks: allTasks.length,
      completedTasks,
      totalStories: 0,
      focusDaysTracked: focusDays.length,
      averageCompletionRate: Math.round(averageCompletionRate * 100),
      lastUpdated: now(),
    });
  }

  async updateVaultSettings(
    vaultId: string,
    settings: Partial<VaultSettings>
  ): Promise<StorageResult<VaultSettings>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const existing = this.vaultSettings.get(vaultId) || {};
    const updated = { ...existing, ...settings };
    this.vaultSettings.set(vaultId, updated);

    return wrapSuccess(updated);
  }

  // -------------------------------------------------------------------------
  // Goal Operations
  // -------------------------------------------------------------------------

  async getGoals(
    vaultId: string,
    options?: GoalQueryOptions
  ): Promise<StorageResult<SmartGoal[]>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    let goals = this.getGoalsForVault(vaultId);

    // Apply filters
    if (options?.status) {
      goals = goals.filter((g) => g.status === options.status);
    }
    if (options?.priority) {
      goals = goals.filter((g) => g.priority === options.priority);
    }
    if (options?.tags && options.tags.length > 0) {
      goals = goals.filter((g) => options.tags!.some((tag) => g.tags.includes(tag)));
    }
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      goals = goals.filter(
        (g) =>
          g.title.toLowerCase().includes(searchLower) ||
          (g.specific ?? '').toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    if (options?.sortBy) {
      goals.sort((a, b) => {
        const aVal = a[options.sortBy as keyof SmartGoal];
        const bVal = b[options.sortBy as keyof SmartGoal];
        const comparison = String(aVal).localeCompare(String(bVal));
        return options.sortOrder === 'desc' ? -comparison : comparison;
      });
    }

    // Apply pagination
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;
      goals = goals.slice(start, end);
    }

    return wrapSuccess(goals);
  }

  async getGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    const key = `${vaultId}:${goalId}`;
    const goal = this.goals.get(key);

    if (!goal) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Goal not found: ${goalId}`));
    }

    return wrapSuccess(goal);
  }

  async createGoal(vaultId: string, data: GoalCreate): Promise<StorageResult<SmartGoal>> {
    const vault = this.vaults.get(vaultId);
    if (!vault) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const id = generateId('goal');
    const goal: SmartGoal = {
      id,
      title: data.title,
      type: 'general',
      status: 'active',
      specific: data.description || '',
      measurable: { unit: data.measurable_target || '' },
      achievable: 50,
      relevant: [],
      deadline: data.deadline || '',
      columns: [
        { id: 'backlog', name: 'To Do' },
        { id: 'doing', name: 'In Progress' },
        { id: 'done', name: 'Done' },
      ],
      priority: (data.priority as SmartGoal['priority']) || 'medium',
      tags: [],
      created: now(),
      updated: now(),
    };

    const key = `${vaultId}:${id}`;
    this.goals.set(key, goal);

    vault.goals.push(id);
    this.vaults.set(vaultId, vault);

    return wrapSuccess(goal);
  }

  async updateGoal(
    vaultId: string,
    goalId: string,
    data: GoalUpdate
  ): Promise<StorageResult<SmartGoal>> {
    const key = `${vaultId}:${goalId}`;
    const goal = this.goals.get(key);

    if (!goal) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Goal not found: ${goalId}`));
    }

    const updated: SmartGoal = {
      ...goal,
      ...data,
      updated: now(),
    };

    this.goals.set(key, updated);
    return wrapSuccess(updated);
  }

  async deleteGoal(vaultId: string, goalId: string): Promise<StorageResult<void>> {
    const key = `${vaultId}:${goalId}`;

    if (!this.goals.has(key)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Goal not found: ${goalId}`));
    }

    // Delete goal tasks
    for (const [taskKey] of this.goalTasks) {
      if (taskKey.startsWith(`${vaultId}:${goalId}:`)) {
        this.goalTasks.delete(taskKey);
      }
    }

    this.goals.delete(key);

    // Remove from vault
    const vault = this.vaults.get(vaultId);
    if (vault) {
      vault.goals = vault.goals.filter((id) => id !== goalId);
      this.vaults.set(vaultId, vault);
    }

    return wrapSuccess(undefined);
  }

  async archiveGoal(vaultId: string, goalId: string): Promise<StorageResult<SmartGoal>> {
    return this.updateGoal(vaultId, goalId, { status: 'archived' });
  }

  // -------------------------------------------------------------------------
  // Goal Task Operations
  // -------------------------------------------------------------------------

  async getGoalTasks(vaultId: string, goalId: string): Promise<StorageResult<GoalTask[]>> {
    const goalKey = `${vaultId}:${goalId}`;
    if (!this.goals.has(goalKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Goal not found: ${goalId}`));
    }

    const tasks: GoalTask[] = [];
    const prefix = `${vaultId}:${goalId}:`;

    for (const [key, task] of this.goalTasks) {
      if (key.startsWith(prefix)) {
        tasks.push(task);
      }
    }

    return wrapSuccess(tasks);
  }

  async getGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    const key = `${vaultId}:${goalId}:${taskId}`;
    const task = this.goalTasks.get(key);

    if (!task) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Task not found: ${taskId}`));
    }

    return wrapSuccess(task);
  }

  async createGoalTask(
    vaultId: string,
    goalId: string,
    taskData: Omit<GoalTask, 'id'>
  ): Promise<StorageResult<GoalTask>> {
    const goalKey = `${vaultId}:${goalId}`;
    if (!this.goals.has(goalKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Goal not found: ${goalId}`));
    }

    const id = generateId('task');
    const task: GoalTask = {
      id,
      ...taskData,
    };

    const key = `${vaultId}:${goalId}:${id}`;
    this.goalTasks.set(key, task);

    return wrapSuccess(task);
  }

  async updateGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    data: Partial<GoalTask>
  ): Promise<StorageResult<GoalTask>> {
    const key = `${vaultId}:${goalId}:${taskId}`;
    const task = this.goalTasks.get(key);

    if (!task) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Task not found: ${taskId}`));
    }

    const updated: GoalTask = { ...task, ...data };
    this.goalTasks.set(key, updated);

    return wrapSuccess(updated);
  }

  async deleteGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<void>> {
    const key = `${vaultId}:${goalId}:${taskId}`;

    if (!this.goalTasks.has(key)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Task not found: ${taskId}`));
    }

    this.goalTasks.delete(key);
    return wrapSuccess(undefined);
  }

  async moveGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string,
    targetColumn: string,
    _position?: number
  ): Promise<StorageResult<GoalTask>> {
    return this.updateGoalTask(vaultId, goalId, taskId, { column: targetColumn });
  }

  async completeGoalTask(
    vaultId: string,
    goalId: string,
    taskId: string
  ): Promise<StorageResult<GoalTask>> {
    return this.updateGoalTask(vaultId, goalId, taskId, {
      column: 'done',
      completedAt: now(),
    });
  }

  // -------------------------------------------------------------------------
  // Project Operations
  // -------------------------------------------------------------------------

  async getProjects(
    vaultId: string,
    options?: ProjectQueryOptions
  ): Promise<StorageResult<Project[]>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    let projects = this.getProjectsForVault(vaultId);

    if (options?.status) {
      projects = projects.filter((p) => p.status === options.status);
    }
    if (options?.search) {
      const searchLower = options.search.toLowerCase();
      projects = projects.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          p.description?.toLowerCase().includes(searchLower)
      );
    }

    if (options?.sortBy) {
      projects.sort((a, b) => {
        const aVal = a[options.sortBy as keyof Project];
        const bVal = b[options.sortBy as keyof Project];
        const comparison = String(aVal).localeCompare(String(bVal));
        return options.sortOrder === 'desc' ? -comparison : comparison;
      });
    }

    if (options?.offset !== undefined || options?.limit !== undefined) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : undefined;
      projects = projects.slice(start, end);
    }

    return wrapSuccess(projects);
  }

  async getProject(vaultId: string, projectId: string): Promise<StorageResult<Project>> {
    const key = `${vaultId}:${projectId}`;
    const project = this.projects.get(key);

    if (!project) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    return wrapSuccess(project);
  }

  async createProject(vaultId: string, data: ProjectCreate): Promise<StorageResult<Project>> {
    const vault = this.vaults.get(vaultId);
    if (!vault) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const leadId = data.lead_id ?? 'system';
    const id = generateId('project');
    const project: Project = {
      id,
      name: data.name,
      key: data.key,
      description: data.description,
      project_type: data.project_type,
      status: 'active',
      priority: data.priority,
      visibility: data.visibility ?? 'private',
      lead_id: leadId,
      created_by: leadId,
      created_at: now(),
      updated_at: now(),
      start_date: data.start_date,
      target_completion_date: data.target_completion_date,
      team_ids: data.team_ids ?? [],
      member_ids: leadId ? [leadId] : [],
      category: data.category,
      tags: data.tags,
      board_methodology: data.board_methodology,
      board_columns: data.board_columns,
      enable_sprints: data.enable_sprints,
      enable_wip_limits: data.enable_wip_limits,
      enable_story_points: data.enable_story_points,
      epic_count: 0,
      total_story_points: 0,
      completed_story_points: 0,
    };

    const key = `${vaultId}:${id}`;
    this.projects.set(key, project);

    vault.projects.push(id);
    this.vaults.set(vaultId, vault);

    return wrapSuccess(project);
  }

  async updateProject(
    vaultId: string,
    projectId: string,
    data: ProjectUpdate
  ): Promise<StorageResult<Project>> {
    const key = `${vaultId}:${projectId}`;
    const project = this.projects.get(key);

    if (!project) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const updated: Project = {
      ...project,
      ...data,
      updated_at: now(),
    };

    this.projects.set(key, updated);
    return wrapSuccess(updated);
  }

  async deleteProject(vaultId: string, projectId: string): Promise<StorageResult<void>> {
    const key = `${vaultId}:${projectId}`;

    if (!this.projects.has(key)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    // Delete related data
    this.deleteProjectData(vaultId, projectId);
    this.projects.delete(key);

    // Remove from vault
    const vault = this.vaults.get(vaultId);
    if (vault) {
      vault.projects = vault.projects.filter((id) => id !== projectId);
      this.vaults.set(vaultId, vault);
    }

    return wrapSuccess(undefined);
  }

  async updateProjectColumns(
    vaultId: string,
    projectId: string,
    columns: BoardColumn[]
  ): Promise<StorageResult<Project>> {
    const key = `${vaultId}:${projectId}`;
    const project = this.projects.get(key);

    if (!project) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const updated: Project = {
      ...project,
      board_columns: columns,
      updated_at: now(),
    };

    this.projects.set(key, updated);
    return wrapSuccess(updated);
  }

  // -------------------------------------------------------------------------
  // Epic Operations
  // -------------------------------------------------------------------------

  async getEpics(vaultId: string, projectId: string): Promise<StorageResult<Epic[]>> {
    const projectKey = `${vaultId}:${projectId}`;
    if (!this.projects.has(projectKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const epics: Epic[] = [];
    const prefix = `${vaultId}:${projectId}:`;

    for (const [key, epic] of this.epics) {
      if (key.startsWith(prefix)) {
        epics.push(epic);
      }
    }

    return wrapSuccess(epics);
  }

  async getEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<Epic>> {
    const key = `${vaultId}:${projectId}:${epicId}`;
    const epic = this.epics.get(key);

    if (!epic) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Epic not found: ${epicId}`));
    }

    return wrapSuccess(epic);
  }

  async createEpic(
    vaultId: string,
    projectId: string,
    data: EpicCreate
  ): Promise<StorageResult<Epic>> {
    const projectKey = `${vaultId}:${projectId}`;
    if (!this.projects.has(projectKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const id = generateId('epic');
    const epic: Epic = {
      id,
      title: data.title,
      description: data.description,
      status: data.status ?? 'planning',
      project_id: projectId,
      priority: data.priority ?? 'medium',
      color: data.color || '#6366f1',
      created_by: data.assigned_to ?? 'system',
      created_at: now(),
      updated_at: now(),
      epic_type: data.epic_type ?? 'epic',
    };

    const key = `${vaultId}:${projectId}:${id}`;
    this.epics.set(key, epic);

    return wrapSuccess(epic);
  }

  async updateEpic(
    vaultId: string,
    projectId: string,
    epicId: string,
    data: EpicUpdate
  ): Promise<StorageResult<Epic>> {
    const key = `${vaultId}:${projectId}:${epicId}`;
    const epic = this.epics.get(key);

    if (!epic) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Epic not found: ${epicId}`));
    }

    const updated: Epic = {
      ...epic,
      ...data,
      updated_at: now(),
    };

    this.epics.set(key, updated);
    return wrapSuccess(updated);
  }

  async deleteEpic(
    vaultId: string,
    projectId: string,
    epicId: string
  ): Promise<StorageResult<void>> {
    const key = `${vaultId}:${projectId}:${epicId}`;

    if (!this.epics.has(key)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Epic not found: ${epicId}`));
    }

    this.epics.delete(key);
    return wrapSuccess(undefined);
  }

  // -------------------------------------------------------------------------
  // Sprint Operations
  // -------------------------------------------------------------------------

  async getSprints(vaultId: string, projectId: string): Promise<StorageResult<Sprint[]>> {
    const projectKey = `${vaultId}:${projectId}`;
    if (!this.projects.has(projectKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const sprints: Sprint[] = [];
    const prefix = `${vaultId}:${projectId}:`;

    for (const [key, sprint] of this.sprints) {
      if (key.startsWith(prefix)) {
        sprints.push(sprint);
      }
    }

    return wrapSuccess(sprints);
  }

  async getSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    const key = `${vaultId}:${projectId}:${sprintId}`;
    const sprint = this.sprints.get(key);

    if (!sprint) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Sprint not found: ${sprintId}`));
    }

    return wrapSuccess(sprint);
  }

  async createSprint(
    vaultId: string,
    projectId: string,
    data: SprintCreate
  ): Promise<StorageResult<Sprint>> {
    const projectKey = `${vaultId}:${projectId}`;
    if (!this.projects.has(projectKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Project not found: ${projectId}`));
    }

    const id = generateId('sprint');
    const sprint: Sprint = {
      id,
      name: data.name,
      goal: data.goal,
      status: 'future',
      start_date: data.start_date,
      end_date: data.end_date,
      project_id: projectId,
      velocity: 0,
      completed_points: 0,
      total_points: data.total_points || 0,
      created_at: now(),
      updated_at: now(),
    };

    const key = `${vaultId}:${projectId}:${id}`;
    this.sprints.set(key, sprint);

    return wrapSuccess(sprint);
  }

  async updateSprint(
    vaultId: string,
    projectId: string,
    sprintId: string,
    data: SprintUpdate
  ): Promise<StorageResult<Sprint>> {
    const key = `${vaultId}:${projectId}:${sprintId}`;
    const sprint = this.sprints.get(key);

    if (!sprint) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Sprint not found: ${sprintId}`));
    }

    const updated: Sprint = {
      ...sprint,
      ...data,
      updated_at: now(),
    };

    this.sprints.set(key, updated);
    return wrapSuccess(updated);
  }

  async deleteSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<void>> {
    const key = `${vaultId}:${projectId}:${sprintId}`;

    if (!this.sprints.has(key)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Sprint not found: ${sprintId}`));
    }

    this.sprints.delete(key);
    this.retrospectives.delete(sprintId);

    return wrapSuccess(undefined);
  }

  async startSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.updateSprint(vaultId, projectId, sprintId, { status: 'active' });
  }

  async completeSprint(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<Sprint>> {
    return this.updateSprint(vaultId, projectId, sprintId, { status: 'completed' });
  }

  async getSprintBurndown(
    vaultId: string,
    projectId: string,
    sprintId: string
  ): Promise<StorageResult<BurndownEntry[]>> {
    const key = `${vaultId}:${projectId}:${sprintId}`;
    const sprint = this.sprints.get(key);

    if (!sprint) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Sprint not found: ${sprintId}`));
    }

    // Generate simple burndown data
    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const totalPoints = sprint.total_points;

    const burndown: BurndownEntry[] = [];
    for (let i = 0; i <= days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      burndown.push({
        date: date.toISOString().split('T')[0],
        remaining_points: totalPoints - (sprint.completed_points * (i / days)),
        ideal_remaining: totalPoints - (totalPoints * (i / days)),
      });
    }

    return wrapSuccess(burndown);
  }

  async saveRetrospective(
    vaultId: string,
    projectId: string,
    sprintId: string,
    retroData: Omit<Retrospective, 'id' | 'sprint_id' | 'created_at'>
  ): Promise<StorageResult<Retrospective>> {
    const sprintKey = `${vaultId}:${projectId}:${sprintId}`;
    if (!this.sprints.has(sprintKey)) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Sprint not found: ${sprintId}`));
    }

    const retro: Retrospective = {
      id: generateId('retro'),
      sprint_id: sprintId,
      ...retroData,
      created_at: now(),
    };

    this.retrospectives.set(sprintId, retro);
    return wrapSuccess(retro);
  }

  // -------------------------------------------------------------------------
  // Focus Day Operations
  // -------------------------------------------------------------------------

  async getFocusDay(vaultId: string, date: string): Promise<StorageResult<FocusDay | null>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const key = `${vaultId}:${date}`;
    const focusDay = this.focusDays.get(key);

    return wrapSuccess(focusDay || null);
  }

  async saveFocusDay(vaultId: string, focusDay: FocusDay): Promise<StorageResult<FocusDay>> {
    const vault = this.vaults.get(vaultId);
    if (!vault) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const key = `${vaultId}:${focusDay.date}`;
    this.focusDays.set(key, focusDay);

    if (!vault.focusDays.includes(focusDay.id)) {
      vault.focusDays.push(focusDay.id);
      this.vaults.set(vaultId, vault);
    }

    return wrapSuccess(focusDay);
  }

  async getFocusHistory(
    vaultId: string,
    options?: FocusQueryOptions
  ): Promise<StorageResult<FocusHistory[]>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    let focusDays = this.getFocusDaysForVault(vaultId);

    // Apply date filters
    if (options?.startDate) {
      focusDays = focusDays.filter((fd) => fd.date >= options.startDate!);
    }
    if (options?.endDate) {
      focusDays = focusDays.filter((fd) => fd.date <= options.endDate!);
    }

    // Sort by date descending
    focusDays.sort((a, b) => b.date.localeCompare(a.date));

    // Apply limit
    if (options?.limit) {
      focusDays = focusDays.slice(0, options.limit);
    }

    const history: FocusHistory[] = focusDays.map((fd) => ({
      date: fd.date,
      plannedPoints: fd.plannedPoints,
      completedPoints: fd.completedPoints,
      completedItems: fd.completedItems,
      totalItems: fd.items.length,
      completionRate: fd.plannedPoints > 0 ? (fd.completedPoints / fd.plannedPoints) * 100 : 0,
    }));

    return wrapSuccess(history);
  }

  async getFocusVelocity(vaultId: string): Promise<StorageResult<FocusVelocity>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const focusDays = this.getFocusDaysForVault(vaultId);
    focusDays.sort((a, b) => b.date.localeCompare(a.date));

    const totalDays = focusDays.length;
    if (totalDays === 0) {
      return wrapSuccess({
        averagePointsPerDay: 0,
        averageCompletionRate: 0,
        totalDaysTracked: 0,
        currentStreak: 0,
        longestStreak: 0,
        weeklyTrend: [],
      });
    }

    const totalPoints = focusDays.reduce((sum, fd) => sum + fd.completedPoints, 0);
    const completionRates = focusDays.map((fd) =>
      fd.plannedPoints > 0 ? fd.completedPoints / fd.plannedPoints : 0
    );

    // Calculate streak
    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;

    for (const fd of focusDays) {
      if (fd.completedItems > 0) {
        streak++;
        if (streak > longestStreak) {longestStreak = streak;}
      } else {
        if (currentStreak === 0) {currentStreak = streak;}
        streak = 0;
      }
    }
    if (currentStreak === 0) {currentStreak = streak;}

    // Weekly trend (last 7 days)
    const weeklyTrend = focusDays.slice(0, 7).map((fd) => fd.completedPoints);

    return wrapSuccess({
      averagePointsPerDay: totalPoints / totalDays,
      averageCompletionRate: (completionRates.reduce((a, b) => a + b, 0) / totalDays) * 100,
      totalDaysTracked: totalDays,
      currentStreak,
      longestStreak,
      weeklyTrend,
    });
  }

  async completeFocusItem(
    vaultId: string,
    date: string,
    itemSource: string
  ): Promise<StorageResult<FocusDay>> {
    const key = `${vaultId}:${date}`;
    const focusDay = this.focusDays.get(key);

    if (!focusDay) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Focus day not found: ${date}`));
    }

    const item = focusDay.items.find((i) => i.source === itemSource);
    if (!item) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Focus item not found: ${itemSource}`));
    }

    item.status = 'done';
    item.completedAt = now();

    focusDay.completedItems = focusDay.items.filter((i) => i.status === 'done').length;
    focusDay.completedPoints = focusDay.items
      .filter((i) => i.status === 'done')
      .reduce((sum, i) => sum + i.points, 0);

    this.focusDays.set(key, focusDay);
    return wrapSuccess(focusDay);
  }

  async deferFocusItem(
    vaultId: string,
    date: string,
    itemSource: string,
    deferTo: string
  ): Promise<StorageResult<FocusDay>> {
    const key = `${vaultId}:${date}`;
    const focusDay = this.focusDays.get(key);

    if (!focusDay) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Focus day not found: ${date}`));
    }

    const item = focusDay.items.find((i) => i.source === itemSource);
    if (!item) {
      return wrapError(createStorageError('ITEM_NOT_FOUND', `Focus item not found: ${itemSource}`));
    }

    item.status = 'deferred';
    item.deferredTo = deferTo;

    this.focusDays.set(key, focusDay);
    return wrapSuccess(focusDay);
  }

  async gatherFocusCandidates(vaultId: string): Promise<StorageResult<FocusCandidate[]>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const candidates: FocusCandidate[] = [];

    // Gather from goal tasks
    const goals = this.getGoalsForVault(vaultId);
    for (const goal of goals) {
      if (goal.status !== 'active') {continue;}

      const tasks = this.getGoalTasksForGoal(vaultId, goal.id);
      for (const task of tasks) {
        if (task.column === 'done') {continue;}

        candidates.push({
          id: task.id,
          type: 'goal_task',
          title: task.title,
          points: task.points,
          priority: normalizePriority(task.priority),
          dueDate: task.dueDate,
          blocks: [],
          blocksPeople: false,
          inCurrentSprint: false,
          goalId: goal.id,
          goalTitle: goal.title,
        });
      }
    }

    return wrapSuccess(candidates);
  }

  // -------------------------------------------------------------------------
  // Search Operations
  // -------------------------------------------------------------------------

  async search(
    vaultId: string,
    query: string,
    options?: SearchOptions
  ): Promise<StorageResult<VaultSearchResult[]>> {
    if (!this.vaults.has(vaultId)) {
      return wrapError(createStorageError('VAULT_NOT_FOUND', `Vault not found: ${vaultId}`));
    }

    const results: VaultSearchResult[] = [];
    const queryLower = query.toLowerCase();
    const types = options?.types || ['goal', 'goal_task', 'project', 'focus'];

    // Search goals
    if (types.includes('goal')) {
      const goals = this.getGoalsForVault(vaultId);
      for (const goal of goals) {
        if (
          goal.title.toLowerCase().includes(queryLower) ||
          (goal.specific ?? '').toLowerCase().includes(queryLower)
        ) {
          results.push({
            id: goal.id,
            type: 'goal',
            title: goal.title,
            snippet: (goal.specific ?? '').substring(0, 100),
            path: `goals/${goal.id}`,
            relevanceScore: goal.title.toLowerCase().includes(queryLower) ? 1 : 0.5,
          });
        }
      }
    }

    // Search goal tasks
    if (types.includes('goal_task')) {
      const tasks = this.getGoalTasksForVault(vaultId);
      for (const task of tasks) {
        if (task.title.toLowerCase().includes(queryLower)) {
          results.push({
            id: task.id,
            type: 'goal_task',
            title: task.title,
            snippet: `Column: ${task.column}`,
            path: `goals/tasks/${task.id}`,
            relevanceScore: 0.8,
          });
        }
      }
    }

    // Search projects
    if (types.includes('project')) {
      const projects = this.getProjectsForVault(vaultId);
      for (const project of projects) {
        if (
          project.name.toLowerCase().includes(queryLower) ||
          project.description?.toLowerCase().includes(queryLower)
        ) {
          results.push({
            id: project.id,
            type: 'project',
            title: project.name,
            snippet: project.description?.substring(0, 100) || '',
            path: `projects/${project.id}`,
            relevanceScore: project.name.toLowerCase().includes(queryLower) ? 1 : 0.5,
          });
        }
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Apply limit
    const limit = options?.limit || 50;
    return wrapSuccess(results.slice(0, limit));
  }

  // -------------------------------------------------------------------------
  // Sync Operations (not supported in memory adapter)
  // -------------------------------------------------------------------------

  async getSyncState(vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return wrapSuccess({
      vaultId,
      status: 'offline',
      pendingChanges: 0,
    });
  }

  async syncVault(_vaultId: string): Promise<StorageResult<VaultSyncState>> {
    return wrapError(createStorageError('NOT_IMPLEMENTED', 'Sync not supported in memory adapter'));
  }

  // -------------------------------------------------------------------------
  // Private Helper Methods
  // -------------------------------------------------------------------------

  private countGoalsForVault(vaultId: string): number {
    return this.getGoalsForVault(vaultId).length;
  }

  private countProjectsForVault(vaultId: string): number {
    return this.getProjectsForVault(vaultId).length;
  }

  private getGoalsForVault(vaultId: string): SmartGoal[] {
    const goals: SmartGoal[] = [];
    const prefix = `${vaultId}:`;

    for (const [key, goal] of this.goals) {
      if (key.startsWith(prefix)) {
        goals.push(goal);
      }
    }

    return goals;
  }

  private getGoalTasksForVault(vaultId: string): GoalTask[] {
    const tasks: GoalTask[] = [];
    const prefix = `${vaultId}:`;

    for (const [key, task] of this.goalTasks) {
      if (key.startsWith(prefix)) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  private getGoalTasksForGoal(vaultId: string, goalId: string): GoalTask[] {
    const tasks: GoalTask[] = [];
    const prefix = `${vaultId}:${goalId}:`;

    for (const [key, task] of this.goalTasks) {
      if (key.startsWith(prefix)) {
        tasks.push(task);
      }
    }

    return tasks;
  }

  private getProjectsForVault(vaultId: string): Project[] {
    const projects: Project[] = [];
    const prefix = `${vaultId}:`;

    for (const [key, project] of this.projects) {
      if (key.startsWith(prefix)) {
        projects.push(project);
      }
    }

    return projects;
  }

  private getFocusDaysForVault(vaultId: string): FocusDay[] {
    const focusDays: FocusDay[] = [];
    const prefix = `${vaultId}:`;

    for (const [key, focusDay] of this.focusDays) {
      if (key.startsWith(prefix)) {
        focusDays.push(focusDay);
      }
    }

    return focusDays;
  }

  private deleteVaultData(vaultId: string): void {
    const prefix = `${vaultId}:`;

    for (const key of this.goals.keys()) {
      if (key.startsWith(prefix)) {this.goals.delete(key);}
    }
    for (const key of this.goalTasks.keys()) {
      if (key.startsWith(prefix)) {this.goalTasks.delete(key);}
    }
    for (const key of this.projects.keys()) {
      if (key.startsWith(prefix)) {this.projects.delete(key);}
    }
    for (const key of this.epics.keys()) {
      if (key.startsWith(prefix)) {this.epics.delete(key);}
    }
    for (const key of this.sprints.keys()) {
      if (key.startsWith(prefix)) {this.sprints.delete(key);}
    }
    for (const key of this.focusDays.keys()) {
      if (key.startsWith(prefix)) {this.focusDays.delete(key);}
    }
  }

  private deleteProjectData(vaultId: string, projectId: string): void {
    const prefix = `${vaultId}:${projectId}:`;

    for (const key of this.epics.keys()) {
      if (key.startsWith(prefix)) {this.epics.delete(key);}
    }
    for (const key of this.sprints.keys()) {
      if (key.startsWith(prefix)) {this.sprints.delete(key);}
    }
  }
}

/**
 * Factory function to create a memory storage adapter
 */
export function createMemoryStorage(): StorageAdapter {
  return new MemoryStorageAdapter();
}
