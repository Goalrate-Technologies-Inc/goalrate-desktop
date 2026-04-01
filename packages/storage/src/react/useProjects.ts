/**
 * Projects Operations Hook
 * Provides CRUD operations for projects, epics, stories, and sprints
 */

import { useCallback, useState, useEffect } from 'react';
import type {
  Project,
  ProjectCreate,
  ProjectUpdate,
  Epic,
  EpicCreate,
  EpicUpdate,
  Sprint,
  SprintCreate,
  SprintUpdate,
  BoardColumn,
} from '@goalrate-app/shared';
import type { StorageResult, ProjectQueryOptions, SprintQueryOptions } from '../interface';
import { useStorageContext, useCurrentVault } from './StorageProvider';

// ============================================================================
// PROJECT HOOK
// ============================================================================

export interface UseProjectsReturn {
  /** List of projects */
  projects: Project[];
  /** Whether projects are loading */
  loading: boolean;
  /** Error message from last operation */
  error: string | null;
  /** Fetch projects with optional filters */
  fetchProjects: (options?: ProjectQueryOptions) => Promise<void>;
  /** Get a single project by ID */
  getProject: (id: string) => Promise<StorageResult<Project>>;
  /** Create a new project */
  createProject: (data: ProjectCreate) => Promise<StorageResult<Project>>;
  /** Update a project */
  updateProject: (id: string, data: ProjectUpdate) => Promise<StorageResult<Project>>;
  /** Update project kanban columns */
  updateProjectColumns: (id: string, columns: BoardColumn[]) => Promise<StorageResult<Project>>;
  /** Delete a project */
  deleteProject: (id: string) => Promise<StorageResult<void>>;
  /** Clear error state */
  clearError: () => void;
}

/**
 * Hook for project operations
 */
export function useProjects(options?: ProjectQueryOptions): UseProjectsReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(
    async (queryOptions?: ProjectQueryOptions) => {
      if (!vault) {
        setProjects([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getProjects(vault.id, queryOptions);

      if (result.success) {
        setProjects(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to fetch projects');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  useEffect(() => {
    if (vault && context.initialized) {
      fetchProjects(options);
    }
  }, [vault?.id, context.initialized, fetchProjects, options]);

  const getProject = useCallback(
    async (id: string): Promise<StorageResult<Project>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }
      return context.adapter.getProject(vault.id, id);
    },
    [context.adapter, vault]
  );

  const createProject = useCallback(
    async (data: ProjectCreate): Promise<StorageResult<Project>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.createProject(vault.id, data);

      if (result.success && result.data) {
        setProjects((prev) => [...prev, result.data!]);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateProject = useCallback(
    async (id: string, data: ProjectUpdate): Promise<StorageResult<Project>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateProject(vault.id, id, data);

      if (result.success && result.data) {
        setProjects((prev) => prev.map((p) => (p.id === id ? result.data! : p)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateProjectColumns = useCallback(
    async (id: string, columns: BoardColumn[]): Promise<StorageResult<Project>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateProjectColumns(vault.id, id, columns);

      if (result.success && result.data) {
        setProjects((prev) => prev.map((p) => (p.id === id ? result.data! : p)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deleteProject = useCallback(
    async (id: string): Promise<StorageResult<void>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deleteProject(vault.id, id);

      if (result.success) {
        setProjects((prev) => prev.filter((p) => p.id !== id));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    projects,
    loading,
    error,
    fetchProjects,
    getProject,
    createProject,
    updateProject,
    updateProjectColumns,
    deleteProject,
    clearError,
  };
}

// ============================================================================
// EPIC HOOK
// ============================================================================

export interface UseEpicsReturn {
  /** List of epics */
  epics: Epic[];
  /** Whether epics are loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Fetch epics for a project */
  fetchEpics: (projectId: string) => Promise<void>;
  /** Create an epic */
  createEpic: (projectId: string, data: EpicCreate) => Promise<StorageResult<Epic>>;
  /** Update an epic */
  updateEpic: (projectId: string, epicId: string, data: EpicUpdate) => Promise<StorageResult<Epic>>;
  /** Delete an epic */
  deleteEpic: (projectId: string, epicId: string) => Promise<StorageResult<void>>;
  /** Clear error */
  clearError: () => void;
}

/**
 * Hook for epic operations
 */
export function useEpics(projectId?: string): UseEpicsReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [epics, setEpics] = useState<Epic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEpics = useCallback(
    async (pId: string) => {
      if (!vault) {
        setEpics([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getEpics(vault.id, pId);

      if (result.success) {
        setEpics(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to fetch epics');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  useEffect(() => {
    if (projectId && vault && context.initialized) {
      fetchEpics(projectId);
    }
  }, [projectId, vault?.id, context.initialized, fetchEpics]);

  const createEpic = useCallback(
    async (pId: string, data: EpicCreate): Promise<StorageResult<Epic>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.createEpic(vault.id, pId, data);

      if (result.success && result.data) {
        setEpics((prev) => [...prev, result.data!]);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateEpic = useCallback(
    async (pId: string, epicId: string, data: EpicUpdate): Promise<StorageResult<Epic>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateEpic(vault.id, pId, epicId, data);

      if (result.success && result.data) {
        setEpics((prev) => prev.map((e) => (e.id === epicId ? result.data! : e)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deleteEpic = useCallback(
    async (pId: string, epicId: string): Promise<StorageResult<void>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deleteEpic(vault.id, pId, epicId);

      if (result.success) {
        setEpics((prev) => prev.filter((e) => e.id !== epicId));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    epics,
    loading,
    error,
    fetchEpics,
    createEpic,
    updateEpic,
    deleteEpic,
    clearError,
  };
}

// ============================================================================
// SPRINT HOOK
// ============================================================================

export interface UseSprintsReturn {
  /** List of sprints */
  sprints: Sprint[];
  /** Whether loading */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Fetch sprints */
  fetchSprints: (projectId: string, options?: SprintQueryOptions) => Promise<void>;
  /** Create a sprint */
  createSprint: (projectId: string, data: SprintCreate) => Promise<StorageResult<Sprint>>;
  /** Update a sprint */
  updateSprint: (projectId: string, sprintId: string, data: SprintUpdate) => Promise<StorageResult<Sprint>>;
  /** Start a sprint */
  startSprint: (projectId: string, sprintId: string) => Promise<StorageResult<Sprint>>;
  /** Complete a sprint */
  completeSprint: (projectId: string, sprintId: string) => Promise<StorageResult<Sprint>>;
  /** Delete a sprint */
  deleteSprint: (projectId: string, sprintId: string) => Promise<StorageResult<void>>;
  /** Clear error */
  clearError: () => void;
}

/**
 * Hook for sprint operations
 */
export function useSprints(projectId?: string, options?: SprintQueryOptions): UseSprintsReturn {
  const context = useStorageContext();
  const vault = useCurrentVault();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSprints = useCallback(
    async (pId: string, queryOptions?: SprintQueryOptions) => {
      if (!vault) {
        setSprints([]);
        return;
      }

      setLoading(true);
      setError(null);

      const result = await context.adapter.getSprints(vault.id, pId, queryOptions);

      if (result.success) {
        setSprints(result.data || []);
      } else {
        setError(result.error?.message || 'Failed to fetch sprints');
      }

      setLoading(false);
    },
    [context.adapter, vault]
  );

  useEffect(() => {
    if (projectId && vault && context.initialized) {
      fetchSprints(projectId, options);
    }
  }, [projectId, vault?.id, context.initialized, fetchSprints, options]);

  const createSprint = useCallback(
    async (pId: string, data: SprintCreate): Promise<StorageResult<Sprint>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.createSprint(vault.id, pId, data);

      if (result.success && result.data) {
        setSprints((prev) => [...prev, result.data!]);
      }

      return result;
    },
    [context.adapter, vault]
  );

  const updateSprint = useCallback(
    async (pId: string, sprintId: string, data: SprintUpdate): Promise<StorageResult<Sprint>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.updateSprint(vault.id, pId, sprintId, data);

      if (result.success && result.data) {
        setSprints((prev) => prev.map((s) => (s.id === sprintId ? result.data! : s)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const startSprint = useCallback(
    async (pId: string, sprintId: string): Promise<StorageResult<Sprint>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.startSprint(vault.id, pId, sprintId);

      if (result.success && result.data) {
        setSprints((prev) => prev.map((s) => (s.id === sprintId ? result.data! : s)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const completeSprint = useCallback(
    async (pId: string, sprintId: string): Promise<StorageResult<Sprint>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.completeSprint(vault.id, pId, sprintId);

      if (result.success && result.data) {
        setSprints((prev) => prev.map((s) => (s.id === sprintId ? result.data! : s)));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const deleteSprint = useCallback(
    async (pId: string, sprintId: string): Promise<StorageResult<void>> => {
      if (!vault) {
        return {
          success: false,
          error: { code: 'VAULT_NOT_OPEN', message: 'No vault is currently open' },
        };
      }

      const result = await context.adapter.deleteSprint(vault.id, pId, sprintId);

      if (result.success) {
        setSprints((prev) => prev.filter((s) => s.id !== sprintId));
      }

      return result;
    },
    [context.adapter, vault]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    sprints,
    loading,
    error,
    fetchSprints,
    createSprint,
    updateSprint,
    startSprint,
    completeSprint,
    deleteSprint,
    clearError,
  };
}
