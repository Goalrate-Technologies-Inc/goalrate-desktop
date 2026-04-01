# @goalrate-app/shared

Shared TypeScript types, interfaces, and constants for the Goalrate application ecosystem.

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/shared": "workspace:*"
  }
}
```

## Usage

### Import Types

```typescript
import type { Goal, GoalTask, Project, Story, User } from '@goalrate-app/shared';
```

### Import Constants

```typescript
import { DEFAULT_GOAL_COLUMNS, FOCUS_SCORING } from '@goalrate-app/shared/constants';
```

## Package Structure

```
src/
├── types/           # TypeScript type definitions
│   ├── common.ts    # Shared primitives (Priority, Status, etc.)
│   ├── user.ts      # User and profile types
│   ├── goal.ts      # SMART goal types
│   ├── project.ts   # Project and board types
│   ├── epic.ts      # Epic planning types
│   ├── story.ts     # User story types
│   ├── task.ts      # Task and subtask types
│   ├── sprint.ts    # Sprint management types
│   ├── workspace.ts # Workspace and team types
│   ├── activity.ts  # Activity feed types
│   ├── subscription.ts # Billing types
│   ├── focus.ts     # Today's Focus types
│   └── vault.ts     # Local vault types (desktop)
├── constants/       # Shared constants
│   ├── columns.ts   # Default board columns
│   ├── scoring.ts   # Focus scoring weights
│   └── statuses.ts  # Status constants
└── schemas/         # Zod validation schemas (future)
```

## Development

```bash
# Build the package
pnpm build

# Watch mode
pnpm dev

# Type check
pnpm typecheck
```

## Exports

This package provides the following export paths:

- `@goalrate-app/shared` - All types and constants
- `@goalrate-app/shared/types` - Types only
- `@goalrate-app/shared/constants` - Constants only
