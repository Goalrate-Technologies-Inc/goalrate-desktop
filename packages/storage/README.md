# @goalrate-app/storage

Platform-agnostic storage adapter for Goalrate applications. Provides a unified interface for data persistence across Desktop (Tauri), Web (API), and Mobile (React Native) platforms.

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/storage": "workspace:*"
  }
}
```

### Platform-Specific Dependencies

```json
// Desktop (Tauri)
"@tauri-apps/api": "^2.0.0"

// Mobile (React Native)
"@react-native-async-storage/async-storage": "^2.0.0"

// React Integration
"react": "^18.0.0 || ^19.0.0"
```

## Quick Start

```typescript
// Desktop app (Tauri)
import { createDesktopStorage } from '@goalrate-app/storage/desktop';
const storage = createDesktopStorage();

// Web app (API)
import { createWebStorage } from '@goalrate-app/storage/web';
const storage = createWebStorage('https://api.goalrate.com', { getAuthToken: () => token });

// Mobile app (React Native)
import { createNativeStorage } from '@goalrate-app/storage/native';
const storage = createNativeStorage();

// React integration
import { StorageProvider, useGoals } from '@goalrate-app/storage/react';

function App() {
  return (
    <StorageProvider adapter={storage}>
      <GoalsList />
    </StorageProvider>
  );
}
```

## API Reference

### Core Interface

All storage adapters implement the `StorageAdapter` interface with consistent methods across platforms.

#### Vault Operations

```typescript
import type { StorageAdapter } from '@goalrate-app/storage/interface';

// List all vaults
const vaults = await storage.listVaults();
// Returns: StorageResult<VaultListItem[]>

// Open a vault
const vault = await storage.openVault(vaultId);
// Returns: StorageResult<Vault>

// Create a vault
const newVault = await storage.createVault({ name: 'My Vault', ... });
// Returns: StorageResult<VaultConfig>

// Close vault
await storage.closeVault(vaultId);

// Get vault statistics
const stats = await storage.getVaultStats(vaultId);
// Returns: { goalCount, projectCount, taskCount, ... }
```

#### Goal Operations

```typescript
// Get all goals (with optional filters)
const goals = await storage.getGoals(vaultId, {
  status: 'active',
  priority: 'high',
  tags: ['work'],
  limit: 10,
});

// Get single goal
const goal = await storage.getGoal(vaultId, goalId);

// Create goal
const newGoal = await storage.createGoal(vaultId, {
  title: 'Learn TypeScript',
  specific: 'Complete Advanced TS course',
  measurable: { unit: 'modules', target: 12, current: 0 },
  deadline: '2026-03-01',
  priority: 'high',
});

// Update goal
await storage.updateGoal(vaultId, goalId, { progress: 50 });

// Delete/Archive goal
await storage.deleteGoal(vaultId, goalId, { confirmed: true });
await storage.archiveGoal(vaultId, goalId);
```

#### Goal Task Operations

```typescript
// Get tasks for a goal
const tasks = await storage.getGoalTasks(vaultId, goalId);

// Create task
const task = await storage.createGoalTask(vaultId, goalId, {
  title: 'Complete module 1',
  column: 'todo',
  points: 3,
});

// Move task to column
await storage.moveGoalTask(vaultId, goalId, taskId, 'done');

// Complete task
await storage.completeGoalTask(vaultId, goalId, taskId);
```

#### Project Operations

```typescript
// Get projects
const projects = await storage.getProjects(vaultId, {
  status: 'active',
});

// Create project
const project = await storage.createProject(vaultId, {
  name: 'Mobile App',
  description: 'React Native mobile application',
  methodology: 'scrum',
});

// Update board columns
await storage.updateProjectColumns(vaultId, projectId, [
  { id: 'backlog', name: 'Backlog', position: 0 },
  { id: 'in-progress', name: 'In Progress', position: 1 },
  { id: 'done', name: 'Done', position: 2 },
]);
```

#### Epic & Story Operations

```typescript
// Get epics for project
const epics = await storage.getEpics(vaultId, projectId);

// Create epic
const epic = await storage.createEpic(vaultId, projectId, {
  title: 'User Authentication',
  description: 'Implement auth flows',
});

// Get stories (with filters)
const stories = await storage.getStories(vaultId, projectId, {
  epicId: epic.id,
  sprintId: currentSprintId,
  status: 'in_progress',
});

// Create story
const story = await storage.createStory(vaultId, projectId, {
  title: 'As a user, I want to log in',
  epic_id: epic.id,
  points: 5,
  acceptance_criteria: [{ description: 'Login form works' }],
});

// Move story to sprint
await storage.assignStoryToSprint(vaultId, projectId, storyId, sprintId);
```

#### Sprint Operations

```typescript
// Get sprints
const sprints = await storage.getSprints(vaultId, projectId, {
  status: 'active',
});

// Create sprint
const sprint = await storage.createSprint(vaultId, projectId, {
  name: 'Sprint 1',
  goal: 'Complete auth module',
  start_date: '2026-01-20',
  end_date: '2026-02-03',
});

// Sprint lifecycle
await storage.startSprint(vaultId, projectId, sprintId);
await storage.completeSprint(vaultId, projectId, sprintId);

// Get burndown data
const burndown = await storage.getSprintBurndown(vaultId, projectId, sprintId);
```

#### Focus Day Operations

```typescript
// Get today's focus
const focusDay = await storage.getFocusDay(vaultId, '2026-01-19');

// Save focus day
await storage.saveFocusDay(vaultId, focusDay);

// Get focus history
const history = await storage.getFocusHistory(vaultId, {
  startDate: '2026-01-01',
  limit: 30,
});

// Get velocity metrics
const velocity = await storage.getFocusVelocity(vaultId);

// Complete/Defer items
await storage.completeFocusItem(vaultId, date, itemSource);
await storage.deferFocusItem(vaultId, date, itemSource, '2026-01-20');

// Gather candidates for focus generation
const candidates = await storage.gatherFocusCandidates(vaultId);
```

### Platform Adapters

#### Desktop Storage (Tauri)

```typescript
import { createDesktopStorage, DesktopStorageAdapter } from '@goalrate-app/storage/desktop';

const storage = createDesktopStorage();

// Initialize (required before use)
await storage.initialize();

// Desktop-specific: Vaults are identified by file path
await storage.openVault('/path/to/vault.goalrate');

// Clean up
await storage.dispose();
```

#### Web Storage (API)

```typescript
import { createWebStorage, ApiStorageAdapter } from '@goalrate-app/storage/web';

const storage = createWebStorage('https://api.goalrate.com', {
  getAuthToken: () => localStorage.getItem('token'),
  onAuthError: () => redirectToLogin(),
});

// Web-specific: Vaults are identified by workspace ID
await storage.openVault('workspace_123');
```

#### Native Storage (React Native)

```typescript
import { createNativeStorage, NativeStorageAdapter } from '@goalrate-app/storage/native';

const storage = createNativeStorage();

// Uses AsyncStorage for local persistence
await storage.initialize();
```

#### Memory Storage (Testing)

```typescript
import { createMemoryStorage, MemoryStorageAdapter } from '@goalrate-app/storage/memory';

const storage = createMemoryStorage();

// Pre-populate with test data
storage.seedData({ goals: [mockGoal], projects: [mockProject] });
```

#### Team Storage (Encrypted)

```typescript
import { createTeamStorage, TeamStorageAdapter } from '@goalrate-app/storage/team';

const storage = createTeamStorage({
  baseUrl: 'https://api.goalrate.com',
  getAuthToken: () => token,
  onLockRequired: (vaultId) => showPasswordPrompt(vaultId),
});

// Unlock vault with password (derives encryption key)
await storage.unlockVault(vaultId, password, encryptionConfig);

// Operations are transparently encrypted/decrypted
const goals = await storage.getGoals(vaultId);

// Lock when done
storage.lockVault(vaultId);
```

### React Integration

#### Storage Provider

```typescript
import { StorageProvider, useStorage, useCurrentVault } from '@goalrate-app/storage/react';

function App() {
  return (
    <StorageProvider adapter={storage} autoInitialize>
      <VaultSelector />
    </StorageProvider>
  );
}

function VaultSelector() {
  const { adapter, isReady, error } = useStorage();
  const currentVault = useCurrentVault();

  if (!isReady) return <Loading />;
  if (error) return <Error message={error} />;

  return <div>Current vault: {currentVault?.name}</div>;
}
```

#### Data Hooks

```typescript
import { useGoals, useGoalTasks } from '@goalrate-app/storage/react';

function GoalsList({ vaultId }) {
  const {
    goals,
    loading,
    error,
    createGoal,
    updateGoal,
    deleteGoal,
    refresh,
  } = useGoals(vaultId, { status: 'active' });

  return (
    <ul>
      {goals.map((goal) => (
        <li key={goal.id}>{goal.title}</li>
      ))}
    </ul>
  );
}
```

```typescript
import { useProjects, useStories, useSprints } from '@goalrate-app/storage/react';

function ProjectBoard({ vaultId, projectId }) {
  const { projects } = useProjects(vaultId);
  const { stories, moveStory } = useStories(vaultId, projectId);
  const { sprints, startSprint } = useSprints(vaultId, projectId);

  // Drag and drop handler
  const handleDrop = (storyId, column) => {
    moveStory(storyId, column);
  };
}
```

```typescript
import { useFocus, useTodayFocus } from '@goalrate-app/storage/react';

function TodaysFocus({ vaultId }) {
  const {
    focusDay,
    velocity,
    completeItem,
    deferItem,
    generateFocus,
  } = useTodayFocus(vaultId);

  return (
    <div>
      <h2>Today's Focus</h2>
      <p>Completed: {focusDay?.completedPoints}/{focusDay?.plannedPoints}</p>
    </div>
  );
}
```

#### Team Storage Provider

```typescript
import { TeamStorageProvider, useTeamVault, useVaultLockState } from '@goalrate-app/storage/react';

function TeamApp() {
  return (
    <TeamStorageProvider adapter={teamStorage}>
      <TeamVault />
    </TeamStorageProvider>
  );
}

function TeamVault() {
  const { unlockVault, lockVault, isUnlocked } = useTeamVault(vaultId);
  const { isLocked, isUnlocking } = useVaultLockState(vaultId);

  if (isLocked) {
    return <PasswordPrompt onSubmit={(pwd) => unlockVault(pwd)} />;
  }

  return <VaultContent />;
}
```

### Error Handling

```typescript
import { StorageError, isStorageError } from '@goalrate-app/storage/errors';

try {
  await storage.getGoal(vaultId, goalId);
} catch (error) {
  if (isStorageError(error)) {
    switch (error.code) {
      case 'VAULT_NOT_FOUND':
        // Vault doesn't exist
        break;
      case 'VAULT_LOCKED':
        // Team vault needs password
        break;
      case 'ITEM_NOT_FOUND':
        // Goal doesn't exist
        break;
      case 'PERMISSION_DENIED':
        // User lacks access
        break;
      case 'SYNC_CONFLICT':
        // Version conflict (team vaults)
        break;
      case 'NETWORK_ERROR':
        // API unreachable
        break;
    }
  }
}
```

### Testing

```typescript
import { MockStorageAdapter, createMockAdapter } from '@goalrate-app/storage/testing';

describe('GoalsList', () => {
  let mockStorage: MockStorageAdapter;

  beforeEach(() => {
    mockStorage = createMockAdapter();
    mockStorage.seedData({
      goals: [
        { id: '1', title: 'Test Goal', ... },
      ],
    });
  });

  it('displays goals', async () => {
    render(
      <StorageProvider adapter={mockStorage}>
        <GoalsList vaultId="vault_1" />
      </StorageProvider>
    );

    expect(await screen.findByText('Test Goal')).toBeInTheDocument();
  });
});
```

## Package Structure

```
src/
├── index.ts              # Main exports
├── interface.ts          # StorageAdapter interface
├── errors.ts             # Error types and utilities
├── adapters/
│   ├── index.ts          # Adapter exports
│   ├── desktop/          # Tauri adapter
│   │   ├── index.ts
│   │   └── DesktopStorageAdapter.ts
│   ├── web/              # API adapter
│   │   ├── index.ts
│   │   ├── ApiStorageAdapter.ts
│   │   └── api-client.ts
│   ├── native/           # React Native adapter
│   │   └── index.ts
│   ├── memory/           # In-memory adapter
│   │   ├── index.ts
│   │   └── MemoryStorageAdapter.ts
│   └── team/             # Encrypted team adapter
│       ├── index.ts
│       ├── TeamStorageAdapter.ts
│       ├── encryption.ts
│       ├── keys.ts
│       └── types.ts
├── react/                # React integration
│   ├── index.ts
│   ├── StorageProvider.tsx
│   ├── TeamStorageProvider.tsx
│   ├── useVault.ts
│   ├── useGoals.ts
│   ├── useProjects.ts
│   ├── useFocus.ts
│   └── useTeamVault.ts
└── testing/              # Test utilities
    ├── index.ts
    └── MockStorageAdapter.ts
```

## Dependencies

- `@goalrate-app/shared` - Type definitions
- `@goalrate-app/crypto` - Encryption for team vaults

## Exports

| Path | Description |
|------|-------------|
| `@goalrate-app/storage` | Main adapter factory |
| `@goalrate-app/storage/interface` | StorageAdapter interface |
| `@goalrate-app/storage/errors` | Error types and utilities |
| `@goalrate-app/storage/desktop` | Tauri desktop adapter |
| `@goalrate-app/storage/web` | Web API adapter |
| `@goalrate-app/storage/native` | React Native adapter |
| `@goalrate-app/storage/memory` | In-memory adapter |
| `@goalrate-app/storage/react` | React hooks and providers |
| `@goalrate-app/storage/team` | Encrypted team adapter |
| `@goalrate-app/storage/testing` | Test utilities |

## Development

```bash
# Build
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Design Principles

1. **Platform Agnostic**: Same interface works across Desktop, Web, and Mobile
2. **Result Wrapping**: All operations return `StorageResult<T>` for consistent error handling
3. **Vault-Scoped**: All data operations require a vault ID for multi-vault support
4. **Optional Encryption**: Team adapter adds transparent field-level encryption
5. **React-First Hooks**: Declarative data fetching with automatic updates

## Related Packages

- `@goalrate-app/shared` - Type definitions used by this package
- `@goalrate-app/crypto` - Encryption utilities for team vaults
- `@goalrate-app/core` - Business logic that operates on stored data
- `@goalrate-app/api-client` - HTTP client used by web adapter
