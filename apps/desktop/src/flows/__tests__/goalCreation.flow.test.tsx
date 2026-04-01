/**
 * Goal Creation Flow Tests
 * Tests the complete user flow for creating goals and tasks
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Mock Tauri API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock storage hooks
const mockCreateGoal = vi.fn();
const mockListGoals = vi.fn();
const mockUpdateGoal = vi.fn();
const mockCreateTask = vi.fn();
const mockListTasks = vi.fn();
const mockCompleteTask = vi.fn();

vi.mock('@goalrate-app/storage/react', () => ({
  useDesktopGoals: vi.fn(() => ({
    goals: [],
    loading: false,
    error: null,
    createGoal: mockCreateGoal,
    fetchGoals: mockListGoals,
    updateGoal: mockUpdateGoal,
  })),
  useDesktopGoalTasks: vi.fn(() => ({
    tasks: [],
    loading: false,
    error: null,
    createTask: mockCreateTask,
    fetchTasks: mockListTasks,
    completeTask: mockCompleteTask,
  })),
  useTodayFocus: vi.fn(() => ({
    focusDay: null,
    candidates: [],
    velocity: null,
    loading: false,
    error: null,
    completeItem: vi.fn(),
    deferItem: vi.fn(),
    gatherCandidates: vi.fn(),
    saveFocusDay: vi.fn(),
    fetchVelocity: vi.fn(),
    fetchFocusDay: vi.fn(),
    clearError: vi.fn(),
  })),
  getTodayDate: vi.fn(() => '2024-01-20'),
}));

import { invoke } from '@tauri-apps/api/core';
import { useDesktopGoals, useDesktopGoalTasks } from '@goalrate-app/storage/react';

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockUseDesktopGoals = useDesktopGoals as ReturnType<typeof vi.fn>;
const mockUseDesktopGoalTasks = useDesktopGoalTasks as ReturnType<typeof vi.fn>;

// Simple Goals page component for testing
function GoalsPage() {
  const { goals, loading, error, createGoal } = useDesktopGoals();

  if (loading) {
    return <div>Loading goals...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div>
      <h1>Goals</h1>
      {goals.length === 0 ? (
        <p>No goals yet. Create your first goal!</p>
      ) : (
        <ul>
          {goals.map((goal: any) => (
            <li key={goal.id}>{goal.name}</li>
          ))}
        </ul>
      )}
      <button onClick={() => createGoal({ name: 'New Goal', description: 'Test goal' })}>
        Create Goal
      </button>
    </div>
  );
}

// Test app with routes
function TestApp() {
  return (
    <Routes>
      <Route path="/goals" element={<GoalsPage />} />
    </Routes>
  );
}

describe('Goal Creation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
    mockUseDesktopGoals.mockReturnValue({
      goals: [],
      loading: false,
      error: null,
      createGoal: mockCreateGoal,
      fetchGoals: mockListGoals,
      updateGoal: mockUpdateGoal,
    });
    mockUseDesktopGoalTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      createTask: mockCreateTask,
      fetchTasks: mockListTasks,
      completeTask: mockCompleteTask,
    });
  });

  describe('empty state', () => {
    it('should show empty state message when no goals exist', () => {
      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByText('No goals yet. Create your first goal!')).toBeInTheDocument();
    });

    it('should show Create Goal button', () => {
      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByRole('button', { name: 'Create Goal' })).toBeInTheDocument();
    });
  });

  describe('goal creation', () => {
    it('should call createGoal when Create Goal button is clicked', async () => {
      mockCreateGoal.mockResolvedValue({ success: true });

      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      const createButton = screen.getByRole('button', { name: 'Create Goal' });
      fireEvent.click(createButton);

      await waitFor(() => {
        expect(mockCreateGoal).toHaveBeenCalledWith({
          name: 'New Goal',
          description: 'Test goal',
        });
      });
    });

    it('should display goals after creation', () => {
      mockUseDesktopGoals.mockReturnValue({
        goals: [
          { id: 'goal_1', name: 'My First Goal', description: 'A test goal' },
        ],
        loading: false,
        error: null,
        createGoal: mockCreateGoal,
        fetchGoals: mockListGoals,
        updateGoal: mockUpdateGoal,
      });

      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByText('My First Goal')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('should show loading indicator while fetching goals', () => {
      mockUseDesktopGoals.mockReturnValue({
        goals: [],
        loading: true,
        error: null,
        createGoal: mockCreateGoal,
        fetchGoals: mockListGoals,
        updateGoal: mockUpdateGoal,
      });

      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByText('Loading goals...')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('should display error message when goal fetch fails', () => {
      mockUseDesktopGoals.mockReturnValue({
        goals: [],
        loading: false,
        error: 'Failed to fetch goals',
        createGoal: mockCreateGoal,
        fetchGoals: mockListGoals,
        updateGoal: mockUpdateGoal,
      });

      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByText('Error: Failed to fetch goals')).toBeInTheDocument();
    });
  });

  describe('multiple goals', () => {
    it('should display all goals in list', () => {
      mockUseDesktopGoals.mockReturnValue({
        goals: [
          { id: 'goal_1', name: 'Learn TypeScript', description: 'Master TS' },
          { id: 'goal_2', name: 'Build App', description: 'Create a Tauri app' },
          { id: 'goal_3', name: 'Write Tests', description: 'Full test coverage' },
        ],
        loading: false,
        error: null,
        createGoal: mockCreateGoal,
        fetchGoals: mockListGoals,
        updateGoal: mockUpdateGoal,
      });

      render(
        <MemoryRouter initialEntries={['/goals']}>
          <TestApp />
        </MemoryRouter>
      );

      expect(screen.getByText('Learn TypeScript')).toBeInTheDocument();
      expect(screen.getByText('Build App')).toBeInTheDocument();
      expect(screen.getByText('Write Tests')).toBeInTheDocument();
    });
  });
});

describe('Task Creation Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDesktopGoalTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      createTask: mockCreateTask,
      fetchTasks: mockListTasks,
      completeTask: mockCompleteTask,
    });
  });

  // Task page component for testing
  function TaskPage({ goalId }: { goalId: string }) {
    const { tasks, loading, createTask, completeTask } = useDesktopGoalTasks(goalId);

    if (loading) {
      return <div>Loading tasks...</div>;
    }

    return (
      <div>
        <h2>Tasks</h2>
        {tasks.length === 0 ? (
          <p>No tasks yet</p>
        ) : (
          <ul>
            {tasks.map((task: any) => (
              <li key={task.id}>
                <span>{task.title}</span>
                <button onClick={() => completeTask(task.id)}>Complete</button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => createTask({ title: 'New Task', points: 2 })}>
          Add Task
        </button>
      </div>
    );
  }

  describe('empty task state', () => {
    it('should show empty state when no tasks exist', () => {
      render(<TaskPage goalId="goal_1" />);

      expect(screen.getByText('No tasks yet')).toBeInTheDocument();
    });

    it('should show Add Task button', () => {
      render(<TaskPage goalId="goal_1" />);

      expect(screen.getByRole('button', { name: 'Add Task' })).toBeInTheDocument();
    });
  });

  describe('task creation', () => {
    it('should call createTask when Add Task is clicked', async () => {
      mockCreateTask.mockResolvedValue({ success: true });

      render(<TaskPage goalId="goal_1" />);

      const addButton = screen.getByRole('button', { name: 'Add Task' });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledWith({
          title: 'New Task',
          points: 2,
        });
      });
    });
  });

  describe('task completion', () => {
    it('should call completeTask when Complete button is clicked', async () => {
      mockUseDesktopGoalTasks.mockReturnValue({
        tasks: [
          { id: 'task_1', title: 'First Task', points: 2, status: 'pending' },
        ],
        loading: false,
        error: null,
        createTask: mockCreateTask,
        fetchTasks: mockListTasks,
        completeTask: mockCompleteTask,
      });
      mockCompleteTask.mockResolvedValue({ success: true });

      render(<TaskPage goalId="goal_1" />);

      const completeButton = screen.getByRole('button', { name: 'Complete' });
      fireEvent.click(completeButton);

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('task_1');
      });
    });
  });

  describe('task list display', () => {
    it('should display all tasks', () => {
      mockUseDesktopGoalTasks.mockReturnValue({
        tasks: [
          { id: 'task_1', title: 'Task One', points: 1, status: 'pending' },
          { id: 'task_2', title: 'Task Two', points: 2, status: 'pending' },
          { id: 'task_3', title: 'Task Three', points: 3, status: 'done' },
        ],
        loading: false,
        error: null,
        createTask: mockCreateTask,
        fetchTasks: mockListTasks,
        completeTask: mockCompleteTask,
      });

      render(<TaskPage goalId="goal_1" />);

      expect(screen.getByText('Task One')).toBeInTheDocument();
      expect(screen.getByText('Task Two')).toBeInTheDocument();
      expect(screen.getByText('Task Three')).toBeInTheDocument();
    });
  });
});
