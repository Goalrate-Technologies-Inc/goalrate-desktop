# @goalrate-app/api-client

Type-safe HTTP client for the Goalrate API. Provides a unified interface for all API operations with automatic token refresh, error handling, and TypeScript support.

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/api-client": "workspace:*"
  }
}
```

## Quick Start

```typescript
import { GoalrateClient } from '@goalrate-app/api-client';

const client = new GoalrateClient({
  baseUrl: 'https://api.goalrate.app',
  accessToken: localStorage.getItem('token'),
  onTokenRefresh: (access, refresh) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  },
  onAuthError: () => {
    window.location.href = '/login';
  },
});

// Use feature clients
const goals = await client.goals.list();
const projects = await client.projects.list();
```

## API Reference

### GoalrateClient

The main client class that composes all feature-specific clients.

```typescript
import { GoalrateClient, createGoalrateClient } from '@goalrate-app/api-client';

// Constructor
const client = new GoalrateClient({
  baseUrl: 'https://api.goalrate.app',
  accessToken: 'initial-token',
  refreshToken: 'refresh-token',
  timeout: 30000,           // Request timeout (default: 30s)
  retries: 3,               // Retry attempts (default: 0)
  retryDelay: 1000,         // Delay between retries (default: 1s)
  autoRefresh: true,        // Auto-refresh on 401 (default: true)
  headers: {},              // Custom headers
  onTokenRefresh: (access, refresh) => {},
  onAuthError: () => {},
});

// Or use factory function
const client = createGoalrateClient({ baseUrl: 'https://api.goalrate.app' });

// Token management
client.setAccessToken(token);
client.setRefreshToken(token);
client.setTokens(accessToken, refreshToken);
client.clearTokens();
client.isAuthenticated(); // boolean

// Access underlying HTTP client
const http = client.getHttpClient();
```

### Auth Client

```typescript
// Login
const { user, access_token, refresh_token } = await client.auth.login({
  email: 'user@example.com',
  password: 'password',
});

// Register
const { user, access_token } = await client.auth.register({
  email: 'user@example.com',
  password: 'password',
  username: 'johndoe',
  display_name: 'John Doe',
});

// Get current user
const me = await client.auth.getMe();

// Refresh token
const { access_token, refresh_token } = await client.auth.refreshToken(currentRefreshToken);

// Logout
await client.auth.logout();

// Password management
await client.auth.forgotPassword({ email: 'user@example.com' });
await client.auth.resetPassword({ token, new_password });
await client.auth.changePassword({ current_password, new_password });

// Email verification
await client.auth.verifyEmail({ token });
await client.auth.resendVerification({ email });

// Update profile
await client.auth.updateProfile({ display_name, bio, avatar_url });
```

### Goals Client

```typescript
// List goals
const goals = await client.goals.list({
  status: 'active',
  priority: 'high',
  tags: ['work'],
  limit: 10,
  offset: 0,
});

// Get single goal
const goal = await client.goals.get(goalId);

// Create goal
const newGoal = await client.goals.create({
  title: 'Learn TypeScript',
  specific: 'Complete Advanced TS course on Udemy',
  measurable: { unit: 'modules', target: 12, current: 0 },
  achievable: 'I have 2 hours daily for learning',
  relevant: ['career growth', 'skill development'],
  deadline: '2026-03-01',
  priority: 'high',
  tags: ['learning', 'tech'],
});

// Update goal
await client.goals.update(goalId, { progress: 50 });

// Delete goal
await client.goals.delete(goalId);

// Archive goal
await client.goals.archive(goalId);

// Goal tasks
const tasks = await client.goals.getTasks(goalId);
await client.goals.createTask(goalId, { title: 'Task 1', column: 'todo', points: 3 });
await client.goals.updateTask(goalId, taskId, { column: 'done' });
await client.goals.deleteTask(goalId, taskId);
await client.goals.moveTask(goalId, taskId, { column: 'in-progress', position: 0 });
await client.goals.completeTask(goalId, taskId);
```

### Projects Client

```typescript
// List projects
const projects = await client.projects.list({
  status: 'active',
  methodology: 'scrum',
  limit: 10,
});

// Get project
const project = await client.projects.get(projectId);

// Create project
const newProject = await client.projects.create({
  name: 'Mobile App',
  description: 'React Native mobile application',
  methodology: 'scrum',
  sprint_duration: 14,
});

// Update project
await client.projects.update(projectId, { status: 'active' });

// Delete project
await client.projects.delete(projectId);

// Board columns
await client.projects.getColumns(projectId);
await client.projects.createColumn(projectId, { name: 'Review', position: 2 });
await client.projects.updateColumn(projectId, columnId, { name: 'Code Review' });
await client.projects.deleteColumn(projectId, columnId);
await client.projects.reorderColumns(projectId, ['col1', 'col2', 'col3']);
```

### Epics Client

```typescript
// List epics for project
const epics = await client.epics.list(projectId, {
  status: 'active',
});

// Get epic
const epic = await client.epics.get(projectId, epicId);

// Create epic
const newEpic = await client.epics.create(projectId, {
  title: 'User Authentication',
  description: 'Implement all auth flows',
  color: '#7C3AED',
});

// Update epic
await client.epics.update(projectId, epicId, { status: 'completed' });

// Delete epic
await client.epics.delete(projectId, epicId);
```

### Stories Client

```typescript
// List stories
const stories = await client.stories.list(projectId, {
  epic_id: epicId,
  sprint_id: sprintId,
  status: 'in_progress',
  assignee_id: userId,
});

// Get story
const story = await client.stories.get(projectId, storyId);

// Create story
const newStory = await client.stories.create(projectId, {
  title: 'As a user, I want to log in',
  description: 'Implement login flow',
  epic_id: epicId,
  points: 5,
  acceptance_criteria: [
    { description: 'Login form validates input' },
    { description: 'Error messages display correctly' },
  ],
});

// Update story
await client.stories.update(projectId, storyId, { status: 'done' });

// Delete story
await client.stories.delete(projectId, storyId);

// Move story to column
await client.stories.move(projectId, storyId, { column: 'review', position: 0 });

// Assign to sprint
await client.stories.assignToSprint(projectId, storyId, sprintId);
await client.stories.removeFromSprint(projectId, storyId);

// Story tasks
const tasks = await client.stories.getTasks(projectId, storyId);
await client.stories.createTask(projectId, storyId, { title: 'Implement API', assignee_id: userId });
await client.stories.updateTask(projectId, storyId, taskId, { completed: true });
await client.stories.deleteTask(projectId, storyId, taskId);
```

### Sprints Client

```typescript
// List sprints
const sprints = await client.sprints.list(projectId, {
  status: 'active',
});

// Get sprint
const sprint = await client.sprints.get(projectId, sprintId);

// Create sprint
const newSprint = await client.sprints.create(projectId, {
  name: 'Sprint 1',
  goal: 'Complete auth module',
  start_date: '2026-01-20',
  end_date: '2026-02-03',
});

// Update sprint
await client.sprints.update(projectId, sprintId, { goal: 'Updated goal' });

// Delete sprint
await client.sprints.delete(projectId, sprintId);

// Sprint lifecycle
await client.sprints.start(projectId, sprintId);
await client.sprints.complete(projectId, sprintId);
await client.sprints.cancel(projectId, sprintId);

// Sprint data
const burndown = await client.sprints.getBurndown(projectId, sprintId);
const velocity = await client.sprints.getVelocity(projectId);

// Retrospective
await client.sprints.saveRetrospective(projectId, sprintId, {
  went_well: ['Team collaboration'],
  to_improve: ['Estimation accuracy'],
  action_items: ['Use planning poker'],
});
const retro = await client.sprints.getRetrospective(projectId, sprintId);
```

### Focus Client

```typescript
// Get today's focus
const focusDay = await client.focus.getDay('2026-01-19');

// Save focus day
await client.focus.saveDay(focusDay);

// Get focus history
const history = await client.focus.getHistory({
  start_date: '2026-01-01',
  end_date: '2026-01-19',
  limit: 30,
});

// Get velocity metrics
const velocity = await client.focus.getVelocity();

// Complete item
await client.focus.completeItem(date, itemSource);

// Defer item
await client.focus.deferItem(date, itemSource, '2026-01-20');

// Gather candidates
const candidates = await client.focus.getCandidates();

// Generate focus list
const generated = await client.focus.generate({ hours_available: 6 });
```

### Social Client

```typescript
// Activity feed
const feed = await client.social.getFeed({
  limit: 20,
  cursor: lastCursor,
});

// User profile
const profile = await client.social.getProfile(userId);

// Following system
await client.social.follow(userId);
await client.social.unfollow(userId);
const followers = await client.social.getFollowers(userId);
const following = await client.social.getFollowing(userId);

// Search users
const users = await client.social.searchUsers({
  query: 'john',
  limit: 10,
});

// Activity interactions
await client.social.likeActivity(activityId);
await client.social.unlikeActivity(activityId);
await client.social.commentOnActivity(activityId, { text: 'Great progress!' });
```

### Subscriptions Client

```typescript
// Get subscription info
const subscription = await client.subscriptions.getCurrent();

// Get available plans
const plans = await client.subscriptions.getPlans();
// Returns: { pro_monthly, pro_yearly, team_monthly, team_yearly, ... }

// Create checkout session
const { checkout_url } = await client.subscriptions.createCheckout({
  plan: 'pro',
  billing_cycle: 'yearly',
  success_url: 'https://app.goalrate.app/subscription/success',
  cancel_url: 'https://app.goalrate.app/pricing',
});

// Cancel subscription
await client.subscriptions.cancel();

// Get billing portal URL
const { portal_url } = await client.subscriptions.getPortal();

// Apply promo code
await client.subscriptions.applyPromo({ code: 'LAUNCH50' });

// Change plan
await client.subscriptions.changePlan({
  plan: 'team',
  billing_cycle: 'monthly',
});

// Get invoices
const invoices = await client.subscriptions.getInvoices();
```

### Users Client

```typescript
// Get user by ID
const user = await client.users.get(userId);

// Update settings
await client.users.updateSettings({
  theme: 'dark',
  notifications_enabled: true,
  email_digest: 'weekly',
});

// Update profile visibility
await client.users.updateVisibility({
  profile_public: true,
  show_goals: false,
  show_activity: true,
});

// Upload avatar
const { avatar_url } = await client.users.uploadAvatar(file);

// Delete account
await client.users.deleteAccount({ password });
```

### Error Handling

```typescript
import { ApiError, isApiError, createApiError } from '@goalrate-app/api-client';

try {
  await client.goals.get('invalid-id');
} catch (error) {
  if (isApiError(error)) {
    switch (error.code) {
      case 'NOT_FOUND':
        console.log('Goal not found');
        break;
      case 'UNAUTHORIZED':
        console.log('Please log in');
        break;
      case 'FORBIDDEN':
        console.log('Access denied');
        break;
      case 'VALIDATION_ERROR':
        console.log('Invalid data:', error.details);
        break;
      case 'RATE_LIMITED':
        console.log('Too many requests');
        break;
      case 'NETWORK_ERROR':
        console.log('Network unavailable');
        break;
      case 'TIMEOUT':
        console.log('Request timed out');
        break;
    }
  }
}

// Create custom errors
const error = createApiError('NOT_FOUND', 'Goal not found', { goalId: '123' });
```

### HTTP Client (Advanced)

For custom requests not covered by feature clients:

```typescript
import { HttpClient, createHttpClient } from '@goalrate-app/api-client';

const http = createHttpClient({
  baseUrl: 'https://api.goalrate.app',
  timeout: 30000,
});

// Set auth token
http.setAccessToken(token);

// Make requests
const response = await http.get<Goal[]>('/goals');
const created = await http.post<Goal>('/goals', { title: 'New Goal' });
const updated = await http.put<Goal>('/goals/123', { title: 'Updated' });
const patched = await http.patch<Goal>('/goals/123', { status: 'completed' });
await http.delete('/goals/123');

// Interceptors
http.addRequestInterceptor((config) => {
  config.headers['X-Custom-Header'] = 'value';
  return config;
});

http.addResponseInterceptor((response) => {
  console.log('Response:', response);
  return response;
});

http.addErrorInterceptor(async (error) => {
  console.log('Error:', error);
  return error;
});
```

## Package Structure

```
src/
├── index.ts              # Main exports
├── client.ts             # GoalrateClient class
├── http.ts               # HttpClient for HTTP requests
├── types.ts              # Shared types
├── errors.ts             # Error classes and utilities
├── auth/
│   ├── index.ts
│   └── authClient.ts     # Authentication operations
├── vaults/
│   ├── index.ts
│   └── vaultClient.ts    # Vault/workspace operations
├── goals/
│   ├── index.ts
│   └── goalClient.ts     # Goal CRUD + tasks
├── projects/
│   ├── index.ts
│   └── projectClient.ts  # Project CRUD + columns
├── epics/
│   ├── index.ts
│   └── epicClient.ts     # Epic CRUD
├── stories/
│   ├── index.ts
│   └── storyClient.ts    # Story CRUD + tasks
├── sprints/
│   ├── index.ts
│   └── sprintClient.ts   # Sprint lifecycle
├── focus/
│   ├── index.ts
│   └── focusClient.ts    # Today's Focus operations
├── social/
│   ├── index.ts
│   └── socialClient.ts   # Social features
├── subscriptions/
│   ├── index.ts
│   └── subscriptionClient.ts  # Billing operations
└── users/
    ├── index.ts
    └── userClient.ts     # User settings
```

## Dependencies

- `@goalrate-app/shared` - Type definitions

## Exports

| Path | Description |
|------|-------------|
| `@goalrate-app/api-client` | Main client and all exports |
| `@goalrate-app/api-client/auth` | Authentication client |
| `@goalrate-app/api-client/vaults` | Vault client |
| `@goalrate-app/api-client/goals` | Goals client |
| `@goalrate-app/api-client/projects` | Projects client |
| `@goalrate-app/api-client/epics` | Epics client |
| `@goalrate-app/api-client/stories` | Stories client |
| `@goalrate-app/api-client/sprints` | Sprints client |
| `@goalrate-app/api-client/focus` | Focus client |
| `@goalrate-app/api-client/social` | Social client |
| `@goalrate-app/api-client/subscriptions` | Subscriptions client |
| `@goalrate-app/api-client/users` | Users client |

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

1. **Type Safety**: Full TypeScript support with strict types
2. **Composable**: Feature clients can be used independently
3. **Auto-Refresh**: Automatic token refresh on 401 errors
4. **Error Handling**: Structured errors with codes and details
5. **Interceptors**: Request/response middleware support

## Related Packages

- `@goalrate-app/shared` - Type definitions used by this package
- `@goalrate-app/storage` - Uses api-client for web adapter
