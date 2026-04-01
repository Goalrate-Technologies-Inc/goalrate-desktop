/**
 * Column Constants
 * Default board column configurations for goals and projects
 */

import type { Column } from '../types/goal';
import type { BoardColumn } from '../types/project';

// ============================================================================
// GOAL COLUMNS
// ============================================================================

/**
 * Default columns for SMART goals (from PRD)
 */
export const DEFAULT_GOAL_COLUMNS: Column[] = [
  { id: 'backlog', name: 'To Do' },
  { id: 'doing', name: 'In Progress', wip: 2 },
  { id: 'done', name: 'Done' },
];

/**
 * Extended goal columns with WIP limits
 */
export const GOAL_COLUMNS_WITH_REVIEW: Column[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do', wip: 5 },
  { id: 'doing', name: 'In Progress', wip: 2 },
  { id: 'review', name: 'Review', wip: 2 },
  { id: 'done', name: 'Done' },
];

// ============================================================================
// PROJECT COLUMNS
// ============================================================================

/**
 * Default columns for projects (Scrumban workflow)
 */
export const DEFAULT_PROJECT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', title: 'Backlog', position: 0, wip_limit: 0 },
  { id: 'todo', title: 'To Do', position: 1, wip_limit: 0 },
  { id: 'in_progress', title: 'In Progress', position: 2, wip_limit: 3 },
  { id: 'in_review', title: 'In Review', position: 3, wip_limit: 2 },
  { id: 'done', title: 'Done', position: 4, wip_limit: 0 },
];

/**
 * Kanban-style project columns
 */
export const KANBAN_PROJECT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', title: 'Backlog', position: 0, wip_limit: 0 },
  { id: 'ready', title: 'Ready', position: 1, wip_limit: 5 },
  { id: 'in_progress', title: 'In Progress', position: 2, wip_limit: 3 },
  { id: 'done', title: 'Done', position: 3, wip_limit: 0 },
];

/**
 * Scrum-style project columns
 */
export const SCRUM_PROJECT_COLUMNS: BoardColumn[] = [
  { id: 'todo', title: 'To Do', position: 0, wip_limit: 0 },
  { id: 'in_progress', title: 'In Progress', position: 1, wip_limit: 0 },
  { id: 'testing', title: 'Testing', position: 2, wip_limit: 0 },
  { id: 'done', title: 'Done', position: 3, wip_limit: 0 },
];

/**
 * Software development columns
 */
export const SOFTWARE_PROJECT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', title: 'Backlog', position: 0, wip_limit: 0 },
  { id: 'selected', title: 'Selected for Development', position: 1, wip_limit: 5 },
  { id: 'in_progress', title: 'In Progress', position: 2, wip_limit: 3 },
  { id: 'code_review', title: 'Code Review', position: 3, wip_limit: 2 },
  { id: 'testing', title: 'Testing', position: 4, wip_limit: 2 },
  { id: 'done', title: 'Done', position: 5, wip_limit: 0 },
];

// ============================================================================
// COLUMN HELPERS
// ============================================================================

/**
 * Get columns by methodology
 */
export function getColumnsByMethodology(
  methodology: 'scrum' | 'kanban' | 'scrumban'
): BoardColumn[] {
  switch (methodology) {
    case 'scrum':
      return SCRUM_PROJECT_COLUMNS;
    case 'kanban':
      return KANBAN_PROJECT_COLUMNS;
    case 'scrumban':
    default:
      return DEFAULT_PROJECT_COLUMNS;
  }
}

/**
 * Check if a column ID is valid for the given columns
 */
export function isValidColumnId(columnId: string, columns: Column[] | BoardColumn[]): boolean {
  return columns.some((col) => col.id === columnId);
}

/**
 * Get column by ID
 */
export function getColumnById<T extends Column | BoardColumn>(
  columnId: string,
  columns: T[]
): T | undefined {
  return columns.find((col) => col.id === columnId);
}

/**
 * Get the next column in sequence
 */
export function getNextColumn<T extends Column | BoardColumn>(
  currentColumnId: string,
  columns: T[]
): T | undefined {
  const currentIndex = columns.findIndex((col) => col.id === currentColumnId);
  if (currentIndex === -1 || currentIndex === columns.length - 1) {
    return undefined;
  }
  return columns[currentIndex + 1];
}

/**
 * Get the previous column in sequence
 */
export function getPreviousColumn<T extends Column | BoardColumn>(
  currentColumnId: string,
  columns: T[]
): T | undefined {
  const currentIndex = columns.findIndex((col) => col.id === currentColumnId);
  if (currentIndex <= 0) {
    return undefined;
  }
  return columns[currentIndex - 1];
}
