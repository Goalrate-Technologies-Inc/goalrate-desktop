/**
 * Test Data Factories
 * Create consistent mock data for testing
 */

import type {
  Vault,
  VaultConfig,
  VaultListItem,
  VaultType,
  SmartGoal,
  GoalTask,
  Column,
  FocusDay,
  FocusItem,
  FocusCandidate,
  FocusVelocity,
  Priority,
  EntityStatus,
  Project,
  BoardColumn,
} from '@goalrate-app/shared';

// ============================================================================
// ID GENERATORS
// ============================================================================

let idCounter = 0;

function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString().padStart(6, '0')}`;
}

/**
 * Reset ID counter (call in beforeEach)
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

// ============================================================================
// VAULT FACTORIES
// ============================================================================

/**
 * Create a mock VaultConfig
 */
export function createMockVaultConfig(overrides?: Partial<VaultConfig>): VaultConfig {
  const id = generateId('vault');
  return {
    id,
    name: `Test Vault ${id}`,
    path: `/tmp/goalrate-test/${id}`,
    type: 'private' as VaultType,
    created: new Date().toISOString(),
    lastOpened: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock Vault (VaultConfig + content references)
 */
export function createMockVault(overrides?: Partial<Vault>): Vault {
  const config = createMockVaultConfig(overrides);
  return {
    ...config,
    goals: [],
    projects: [],
    focusDays: [],
    ...overrides,
  };
}

/**
 * Create a mock VaultListItem
 */
export function createMockVaultListItem(overrides?: Partial<VaultListItem>): VaultListItem {
  const id = overrides?.id || generateId('vault');
  return {
    id,
    name: `Test Vault ${id}`,
    path: `/tmp/goalrate-test/${id}`,
    type: 'private' as VaultType,
    lastOpened: new Date().toISOString(),
    goalCount: 0,
    projectCount: 0,
    isSynced: false,
    ...overrides,
  };
}

// ============================================================================
// GOAL FACTORIES
// ============================================================================

/**
 * Create default columns for a goal
 */
export function createDefaultGoalColumns(): Column[] {
  return [
    { id: 'backlog', name: 'Backlog' },
    { id: 'doing', name: 'Doing', wip: 3 },
    { id: 'done', name: 'Done' },
  ];
}

/**
 * Create a mock SmartGoal
 */
export function createMockGoal(overrides?: Partial<SmartGoal>): SmartGoal {
  const id = generateId('goal');
  const now = new Date().toISOString();
  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now

  return {
    id,
    title: `Test Goal ${id}`,
    status: 'active' as EntityStatus,
    specific: 'This is a specific goal description',
    measurable: { unit: 'tasks' },
    achievable: 80,
    relevant: ['personal growth', 'productivity'],
    deadline,
    columns: createDefaultGoalColumns(),
    priority: 'medium' as Priority,
    tags: ['test'],
    created: now,
    updated: now,
    ...overrides,
  };
}

/**
 * Create a mock GoalTask
 */
export function createMockGoalTask(overrides?: Partial<GoalTask>): GoalTask {
  const id = generateId('task');
  return {
    id,
    title: `Test Task ${id}`,
    column: 'backlog',
    points: 2,
    priority: 'medium' as Priority,
    subtasks: [],
    ...overrides,
  };
}

// ============================================================================
// PROJECT FACTORIES
// ============================================================================

/**
 * Create default board columns for a project
 */
export function createDefaultProjectColumns(): BoardColumn[] {
  return [
    { id: 'backlog', title: 'Backlog', position: 0, wip_limit: 0 },
    { id: 'todo', title: 'To Do', position: 1, wip_limit: 0 },
    { id: 'in-progress', title: 'In Progress', position: 2, wip_limit: 3 },
    { id: 'done', title: 'Done', position: 3, wip_limit: 0 },
  ];
}

/**
 * Create a mock Project
 */
export function createMockProject(overrides?: Partial<Project>): Project {
  const id = generateId('project');
  const now = new Date().toISOString();

  return {
    id,
    title: `Test Project ${id}`,
    description: 'A test project for unit testing',
    status: 'active' as EntityStatus,
    priority: 'medium' as Priority,
    board_columns: createDefaultProjectColumns(),
    enable_sprints: false,
    enable_wip_limits: true,
    enable_story_points: true,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as Project;
}

// ============================================================================
// FOCUS FACTORIES
// ============================================================================

/**
 * Create a mock FocusItem
 */
export function createMockFocusItem(overrides?: Partial<FocusItem>): FocusItem {
  const id = generateId('focus_item');
  return {
    source: id,
    type: 'goal_task',
    title: `Focus Item ${id}`,
    points: 2,
    score: 75,
    reason: 'High priority task due soon',
    status: 'pending',
    ...overrides,
  };
}

/**
 * Create a mock FocusDay
 */
export function createMockFocusDay(overrides?: Partial<FocusDay>): FocusDay {
  const date = overrides?.date || new Date().toISOString().split('T')[0];
  const items = overrides?.items || [
    createMockFocusItem({ status: 'pending' }),
    createMockFocusItem({ status: 'pending' }),
  ];
  const plannedPoints = items.reduce((sum, item) => sum + item.points, 0);
  const completedItems = items.filter((item) => item.status === 'done');
  const completedPoints = completedItems.reduce((sum, item) => sum + item.points, 0);

  return {
    id: `focus_${date}`,
    date,
    availableHours: 8,
    pointCapacity: 10,
    items,
    plannedPoints,
    completedPoints,
    completedItems: completedItems.length,
    ...overrides,
  };
}

/**
 * Create a mock FocusCandidate
 */
export function createMockFocusCandidate(overrides?: Partial<FocusCandidate>): FocusCandidate {
  const id = generateId('candidate');
  return {
    id,
    type: 'goal_task',
    title: `Candidate ${id}`,
    points: 2,
    priority: 'medium' as Priority,
    blocks: [],
    blocksPeople: false,
    inCurrentSprint: false,
    ...overrides,
  };
}

/**
 * Create a mock FocusVelocity
 */
export function createMockFocusVelocity(overrides?: Partial<FocusVelocity>): FocusVelocity {
  return {
    averagePointsPerDay: 8,
    averageCompletionRate: 75,
    totalDaysTracked: 14,
    currentStreak: 5,
    longestStreak: 10,
    weeklyTrend: [6, 8, 7, 10, 9, 8, 7],
    ...overrides,
  };
}

// ============================================================================
// BATCH FACTORIES
// ============================================================================

/**
 * Create multiple vaults
 */
export function createMockVaultList(count: number): VaultListItem[] {
  return Array.from({ length: count }, () => createMockVaultListItem());
}

/**
 * Create multiple goals
 */
export function createMockGoalList(count: number): SmartGoal[] {
  return Array.from({ length: count }, () => createMockGoal());
}

/**
 * Create multiple goal tasks
 */
export function createMockGoalTaskList(count: number): GoalTask[] {
  return Array.from({ length: count }, () => createMockGoalTask());
}

/**
 * Create a goal with tasks
 */
export function createMockGoalWithTasks(
  goalOverrides?: Partial<SmartGoal>,
  taskCount = 3
): { goal: SmartGoal; tasks: GoalTask[] } {
  const goal = createMockGoal(goalOverrides);
  const tasks = Array.from({ length: taskCount }, (_, i) =>
    createMockGoalTask({
      column: i === 0 ? 'doing' : i === taskCount - 1 ? 'done' : 'backlog',
    })
  );
  return { goal, tasks };
}
