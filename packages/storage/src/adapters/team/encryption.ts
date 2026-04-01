/**
 * Team Storage Encryption Middleware
 * Field-level encryption/decryption for team vault data
 */

import {
  encryptString,
  decryptString,
} from '@goalrate-app/crypto';
import type {
  SmartGoal,
  GoalTask,
  Project,
  Epic,
  Sprint,
  FocusDay,
  Subtask,
  Retrospective,
  RetrospectiveAction,
  FocusItem,
} from '@goalrate-app/shared';
import {
  type EncryptedString,
} from './types';

// ============================================================================
// GENERIC ENCRYPTION UTILITIES
// ============================================================================

/**
 * Encrypt a string value
 */
export async function encryptValue(
  value: string,
  key: CryptoKey
): Promise<EncryptedString> {
  const encrypted = await encryptString(value, key);
  return encrypted as EncryptedString;
}

/**
 * Decrypt a string value
 */
export async function decryptValue(
  encrypted: EncryptedString,
  key: CryptoKey
): Promise<string> {
  return decryptString(encrypted, key);
}

/**
 * Encrypt an array of strings
 */
export async function encryptArray(
  values: string[],
  key: CryptoKey
): Promise<EncryptedString[]> {
  return Promise.all(values.map((v) => encryptValue(v, key)));
}

/**
 * Decrypt an array of encrypted strings
 */
export async function decryptArray(
  encrypted: EncryptedString[],
  key: CryptoKey
): Promise<string[]> {
  return Promise.all(encrypted.map((e) => decryptValue(e, key)));
}


// ============================================================================
// GOAL ENCRYPTION
// ============================================================================

/**
 * Encrypted version of SmartGoal with encrypted sensitive fields
 */
export interface EncryptedGoal extends Omit<SmartGoal, 'title' | 'specific' | 'measurable' | 'relevant' | 'tags'> {
  title: EncryptedString;
  specific: EncryptedString;
  measurable: { unit: EncryptedString };
  relevant: EncryptedString[];
  tags: EncryptedString[];
}

/**
 * Encrypt a SmartGoal for storage
 */
export async function encryptGoal(
  goal: SmartGoal,
  key: CryptoKey
): Promise<EncryptedGoal> {
  const [title, specific, measurableUnit, relevant, tags] = await Promise.all([
    encryptValue(goal.title, key),
    encryptValue(goal.specific ?? '', key),
    encryptValue(goal.measurable?.unit ?? '', key),
    encryptArray(goal.relevant ?? [], key),
    encryptArray(goal.tags, key),
  ]);

  return {
    ...goal,
    title,
    specific,
    measurable: { unit: measurableUnit },
    relevant,
    tags,
  };
}

/**
 * Decrypt a SmartGoal from storage
 */
export async function decryptGoal(
  encrypted: EncryptedGoal,
  key: CryptoKey
): Promise<SmartGoal> {
  const [title, specific, measurableUnit, relevant, tags] = await Promise.all([
    decryptValue(encrypted.title, key),
    decryptValue(encrypted.specific, key),
    decryptValue(encrypted.measurable.unit, key),
    decryptArray(encrypted.relevant, key),
    decryptArray(encrypted.tags, key),
  ]);

  return {
    ...encrypted,
    title,
    specific,
    measurable: { unit: measurableUnit },
    relevant,
    tags,
  };
}

// ============================================================================
// GOAL TASK ENCRYPTION
// ============================================================================

/**
 * Encrypted version of GoalTask
 */
export interface EncryptedGoalTask extends Omit<GoalTask, 'title' | 'subtasks'> {
  title: EncryptedString;
  subtasks: EncryptedSubtask[];
}

/**
 * Encrypted subtask
 */
export interface EncryptedSubtask extends Omit<Subtask, 'title'> {
  title: EncryptedString;
}

/**
 * Encrypt a GoalTask for storage
 */
export async function encryptGoalTask(
  task: GoalTask,
  key: CryptoKey
): Promise<EncryptedGoalTask> {
  const [title, subtasks] = await Promise.all([
    encryptValue(task.title, key),
    Promise.all(
      task.subtasks.map(async (st) => ({
        ...st,
        title: await encryptValue(st.title, key),
      }))
    ),
  ]);

  return {
    ...task,
    title,
    subtasks,
  };
}

/**
 * Decrypt a GoalTask from storage
 */
export async function decryptGoalTask(
  encrypted: EncryptedGoalTask,
  key: CryptoKey
): Promise<GoalTask> {
  const [title, subtasks] = await Promise.all([
    decryptValue(encrypted.title, key),
    Promise.all(
      encrypted.subtasks.map(async (st) => ({
        ...st,
        title: await decryptValue(st.title, key),
      }))
    ),
  ]);

  return {
    ...encrypted,
    title,
    subtasks,
  };
}

// ============================================================================
// PROJECT ENCRYPTION
// ============================================================================

/**
 * Encrypted version of Project
 */
export interface EncryptedProject extends Omit<Project, 'name' | 'description' | 'tags'> {
  name: EncryptedString;
  description?: EncryptedString;
  tags?: EncryptedString[];
}

/**
 * Encrypt a Project for storage
 */
export async function encryptProject(
  project: Project,
  key: CryptoKey
): Promise<EncryptedProject> {
  const [name, description, tags] = await Promise.all([
    encryptValue(project.name, key),
    project.description ? encryptValue(project.description, key) : Promise.resolve(undefined),
    project.tags ? encryptArray(project.tags, key) : Promise.resolve(undefined),
  ]);

  return {
    ...project,
    name,
    description,
    tags,
  };
}

/**
 * Decrypt a Project from storage
 */
export async function decryptProject(
  encrypted: EncryptedProject,
  key: CryptoKey
): Promise<Project> {
  const [name, description, tags] = await Promise.all([
    decryptValue(encrypted.name, key),
    encrypted.description ? decryptValue(encrypted.description, key) : Promise.resolve(undefined),
    encrypted.tags ? decryptArray(encrypted.tags, key) : Promise.resolve(undefined),
  ]);

  return {
    ...encrypted,
    name,
    description,
    tags,
  };
}

// ============================================================================
// EPIC ENCRYPTION
// ============================================================================

/**
 * Encrypted version of Epic
 */
export interface EncryptedEpic extends Omit<Epic, 'title' | 'description'> {
  title: EncryptedString;
  description?: EncryptedString;
}

/**
 * Encrypt an Epic for storage
 */
export async function encryptEpic(
  epic: Epic,
  key: CryptoKey
): Promise<EncryptedEpic> {
  const [title, description] = await Promise.all([
    encryptValue(epic.title, key),
    epic.description ? encryptValue(epic.description, key) : Promise.resolve(undefined),
  ]);

  return {
    ...epic,
    title,
    description,
  };
}

/**
 * Decrypt an Epic from storage
 */
export async function decryptEpic(
  encrypted: EncryptedEpic,
  key: CryptoKey
): Promise<Epic> {
  const [title, description] = await Promise.all([
    decryptValue(encrypted.title, key),
    encrypted.description ? decryptValue(encrypted.description, key) : Promise.resolve(undefined),
  ]);

  return {
    ...encrypted,
    title,
    description,
  };
}

// ============================================================================
// SPRINT ENCRYPTION
// ============================================================================

/**
 * Encrypted version of Sprint
 * Note: Sprint doesn't have retrospective inline - that's a separate type
 */
export interface EncryptedSprint extends Omit<Sprint, 'name' | 'goal'> {
  name: EncryptedString;
  goal?: EncryptedString;
}

/**
 * Encrypted retrospective action item
 */
export interface EncryptedRetrospectiveAction extends Omit<RetrospectiveAction, 'description'> {
  description: EncryptedString;
}

/**
 * Encrypted retrospective
 */
export interface EncryptedRetrospective extends Omit<Retrospective, 'went_well' | 'to_improve' | 'action_items'> {
  went_well: EncryptedString[];
  to_improve: EncryptedString[];
  action_items: EncryptedRetrospectiveAction[];
}

/**
 * Encrypt a Sprint for storage
 */
export async function encryptSprint(
  sprint: Sprint,
  key: CryptoKey
): Promise<EncryptedSprint> {
  const [name, goal] = await Promise.all([
    encryptValue(sprint.name, key),
    sprint.goal ? encryptValue(sprint.goal, key) : Promise.resolve(undefined),
  ]);

  return {
    ...sprint,
    name,
    goal,
  };
}

/**
 * Decrypt a Sprint from storage
 */
export async function decryptSprint(
  encrypted: EncryptedSprint,
  key: CryptoKey
): Promise<Sprint> {
  const [name, goal] = await Promise.all([
    decryptValue(encrypted.name, key),
    encrypted.goal ? decryptValue(encrypted.goal, key) : Promise.resolve(undefined),
  ]);

  return {
    ...encrypted,
    name,
    goal,
  };
}

/**
 * Encrypt a Retrospective for storage
 */
export async function encryptRetrospective(
  retro: Retrospective,
  key: CryptoKey
): Promise<EncryptedRetrospective> {
  const [wentWell, toImprove, actionItems] = await Promise.all([
    encryptArray(retro.went_well || [], key),
    encryptArray(retro.to_improve || [], key),
    Promise.all((retro.action_items || []).map(async (item) => ({
      ...item,
      description: await encryptValue(item.description, key),
    }))),
  ]);

  return {
    ...retro,
    went_well: wentWell,
    to_improve: toImprove,
    action_items: actionItems,
  };
}

/**
 * Decrypt a Retrospective from storage
 */
export async function decryptRetrospective(
  encrypted: EncryptedRetrospective,
  key: CryptoKey
): Promise<Retrospective> {
  const [wentWell, toImprove, actionItems] = await Promise.all([
    decryptArray(encrypted.went_well || [], key),
    decryptArray(encrypted.to_improve || [], key),
    Promise.all((encrypted.action_items || []).map(async (item) => ({
      ...item,
      description: await decryptValue(item.description, key),
    }))),
  ]);

  return {
    ...encrypted,
    went_well: wentWell,
    to_improve: toImprove,
    action_items: actionItems,
  };
}

// ============================================================================
// FOCUS DAY ENCRYPTION
// ============================================================================

/**
 * Encrypted version of FocusItem
 */
export interface EncryptedFocusItem extends Omit<FocusItem, 'title' | 'reason'> {
  title: EncryptedString;
  reason: EncryptedString;
}

/**
 * Encrypted version of FocusDay
 */
export interface EncryptedFocusDay extends Omit<FocusDay, 'items' | 'reflection'> {
  items: EncryptedFocusItem[];
  reflection?: EncryptedString;
}

/**
 * Encrypt a FocusDay for storage
 */
export async function encryptFocusDay(
  focusDay: FocusDay,
  key: CryptoKey
): Promise<EncryptedFocusDay> {
  const [items, reflection] = await Promise.all([
    Promise.all(
      focusDay.items.map(async (item): Promise<EncryptedFocusItem> => ({
        ...item,
        title: await encryptValue(item.title, key),
        reason: await encryptValue(item.reason, key),
      }))
    ),
    focusDay.reflection ? encryptValue(focusDay.reflection, key) : Promise.resolve(undefined),
  ]);

  return {
    ...focusDay,
    items,
    reflection,
  };
}

/**
 * Decrypt a FocusDay from storage
 */
export async function decryptFocusDay(
  encrypted: EncryptedFocusDay,
  key: CryptoKey
): Promise<FocusDay> {
  const [items, reflection] = await Promise.all([
    Promise.all(
      encrypted.items.map(async (item): Promise<FocusItem> => ({
        ...item,
        title: await decryptValue(item.title, key),
        reason: await decryptValue(item.reason, key),
      }))
    ),
    encrypted.reflection ? decryptValue(encrypted.reflection, key) : Promise.resolve(undefined),
  ]);

  return {
    ...encrypted,
    items,
    reflection,
  };
}

// ============================================================================
// BATCH ENCRYPTION UTILITIES
// ============================================================================

/**
 * Encrypt an array of goals
 */
export async function encryptGoals(
  goals: SmartGoal[],
  key: CryptoKey
): Promise<EncryptedGoal[]> {
  return Promise.all(goals.map((g) => encryptGoal(g, key)));
}

/**
 * Decrypt an array of goals
 */
export async function decryptGoals(
  encrypted: EncryptedGoal[],
  key: CryptoKey
): Promise<SmartGoal[]> {
  return Promise.all(encrypted.map((g) => decryptGoal(g, key)));
}

/**
 * Encrypt an array of goal tasks
 */
export async function encryptGoalTasks(
  tasks: GoalTask[],
  key: CryptoKey
): Promise<EncryptedGoalTask[]> {
  return Promise.all(tasks.map((t) => encryptGoalTask(t, key)));
}

/**
 * Decrypt an array of goal tasks
 */
export async function decryptGoalTasks(
  encrypted: EncryptedGoalTask[],
  key: CryptoKey
): Promise<GoalTask[]> {
  return Promise.all(encrypted.map((t) => decryptGoalTask(t, key)));
}

/**
 * Encrypt an array of projects
 */
export async function encryptProjects(
  projects: Project[],
  key: CryptoKey
): Promise<EncryptedProject[]> {
  return Promise.all(projects.map((p) => encryptProject(p, key)));
}

/**
 * Decrypt an array of projects
 */
export async function decryptProjects(
  encrypted: EncryptedProject[],
  key: CryptoKey
): Promise<Project[]> {
  return Promise.all(encrypted.map((p) => decryptProject(p, key)));
}

/**
 * Encrypt an array of epics
 */
export async function encryptEpics(
  epics: Epic[],
  key: CryptoKey
): Promise<EncryptedEpic[]> {
  return Promise.all(epics.map((e) => encryptEpic(e, key)));
}

/**
 * Decrypt an array of epics
 */
export async function decryptEpics(
  encrypted: EncryptedEpic[],
  key: CryptoKey
): Promise<Epic[]> {
  return Promise.all(encrypted.map((e) => decryptEpic(e, key)));
}

/**
 * Encrypt an array of sprints
 */
export async function encryptSprints(
  sprints: Sprint[],
  key: CryptoKey
): Promise<EncryptedSprint[]> {
  return Promise.all(sprints.map((s) => encryptSprint(s, key)));
}

/**
 * Decrypt an array of sprints
 */
export async function decryptSprints(
  encrypted: EncryptedSprint[],
  key: CryptoKey
): Promise<Sprint[]> {
  return Promise.all(encrypted.map((s) => decryptSprint(s, key)));
}
