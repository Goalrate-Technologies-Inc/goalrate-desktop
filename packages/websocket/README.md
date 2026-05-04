# @goalrate-app/websocket

WebSocket connection manager for real-time sync and presence in Goalrate. Provides automatic reconnection, heartbeat monitoring, message queuing, and React hooks for building collaborative features.

## Features

- **Auto-Reconnection**: Exponential backoff with jitter
- **Heartbeat Monitoring**: Automatic ping/pong to detect stale connections
- **Message Queuing**: Queue messages during disconnection, replay on reconnect
- **Topic Subscriptions**: Subscribe to channels with auto-resubscribe on reconnect
- **Presence Tracking**: Track who's online, viewing, or editing
- **Optimistic Updates**: Apply changes immediately, sync in background
- **Conflict Resolution**: Detect and resolve sync conflicts
- **Offline Support**: Persistent queue for React Native apps

## Installation

This package is part of the Goalrate monorepo and is automatically available to other workspace packages.

```json
{
  "dependencies": {
    "@goalrate-app/websocket": "workspace:*"
  }
}
```

### Optional Dependencies

```json
// React hooks
"react": "^18.0.0"

// React Native offline support
"@react-native-async-storage/async-storage": ">=2.0.0"
"@react-native-community/netinfo": ">=11.0.0"
```

## Quick Start

### Basic Usage

```typescript
import { WebSocketManager } from '@goalrate-app/websocket';

const ws = new WebSocketManager({
  url: 'wss://api.goalrate.com/ws',
  userId: 'user_123',
  authToken: 'jwt-token',
});

// Connect
await ws.connect();

// Subscribe to topics
ws.subscribe('workspace:abc:sync');
ws.subscribe('workspace:abc:presence');

// Send messages
ws.send({
  type: 'PRESENCE_UPDATE',
  payload: { status: 'online' },
});

// Listen for messages
ws.on('message', (message) => {
  console.log('Received:', message);
});

// Disconnect
ws.disconnect();
```

### React Usage

```typescript
import { WebSocketProvider, useWebSocket, usePresence } from '@goalrate-app/websocket/react';

function App() {
  return (
    <WebSocketProvider
      config={{
        url: 'wss://api.goalrate.com/ws',
        userId: user.id,
        authToken: token,
      }}
      autoConnect
    >
      <CollaborativeEditor />
    </WebSocketProvider>
  );
}

function CollaborativeEditor() {
  const { isConnected, send } = useWebSocket();
  const { users, updatePresence } = usePresence(workspaceId);

  return (
    <div>
      <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
      <p>{users.length} users online</p>
    </div>
  );
}
```

## API Reference

### WebSocketManager

Core connection manager class.

```typescript
import { WebSocketManager, ConnectionState, MessageType } from '@goalrate-app/websocket';

// Configuration
const ws = new WebSocketManager({
  url: 'wss://api.goalrate.com/ws',
  userId: 'user_123',
  authToken: 'jwt-token',

  // Reconnection settings
  reconnect: true,
  maxReconnectAttempts: 10,
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectMultiplier: 2,

  // Heartbeat settings
  heartbeatInterval: 30000,
  heartbeatTimeout: 5000,

  // Message queue
  queueMessages: true,
  maxQueueSize: 100,
});

// Connection lifecycle
await ws.connect();
ws.disconnect();
const state = ws.getState(); // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// Subscriptions
ws.subscribe('topic-name');
ws.unsubscribe('topic-name');
const topics = ws.getSubscriptions();

// Send messages
ws.send({ type: MessageType.DATA_SYNC, payload: { ... } });

// Event listeners
ws.on('connected', () => console.log('Connected'));
ws.on('disconnected', (code, reason) => console.log('Disconnected'));
ws.on('message', (msg) => console.log('Message:', msg));
ws.on('error', (error) => console.log('Error:', error));
ws.on('reconnecting', (attempt) => console.log('Reconnecting...', attempt));
ws.on('reconnected', () => console.log('Reconnected'));

// Remove listener
const unsubscribe = ws.on('message', handler);
unsubscribe();

// Check authentication
const isAuth = ws.isAuthenticated();
```

### React Provider

```typescript
import { WebSocketProvider, WebSocketContext } from '@goalrate-app/websocket/react';

<WebSocketProvider
  config={{
    url: 'wss://api.goalrate.com/ws',
    userId: user.id,
    authToken: token,
  }}
  autoConnect          // Connect on mount (default: true)
  reconnectOnAuthChange // Reconnect when auth changes (default: true)
  onConnected={() => console.log('Connected')}
  onDisconnected={(code, reason) => console.log('Disconnected')}
  onError={(error) => console.error(error)}
  onMessage={(msg) => console.log('Message:', msg)}
>
  <App />
</WebSocketProvider>
```

### React Hooks

#### useWebSocket

```typescript
import { useWebSocket } from '@goalrate-app/websocket/react';

function Component() {
  const {
    manager,       // WebSocketManager instance
    state,         // ConnectionState
    isConnected,   // boolean
    isConnecting,  // boolean
    isReconnecting,// boolean
    send,          // (message) => void
    subscribe,     // (topic) => void
    unsubscribe,   // (topic) => void
    connect,       // () => Promise<void>
    disconnect,    // () => void
  } = useWebSocket();
}
```

#### useConnectionState

```typescript
import { useConnectionState } from '@goalrate-app/websocket/react';

function ConnectionIndicator() {
  const {
    state,         // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'
    isConnected,
    isConnecting,
    isReconnecting,
    isDisconnected,
    reconnectAttempt, // Current attempt number
  } = useConnectionState();

  return <span>{isConnected ? '🟢' : '🔴'} {state}</span>;
}
```

#### useSubscription

```typescript
import { useSubscription, useSubscriptions } from '@goalrate-app/websocket/react';

function Component() {
  // Subscribe to single topic (auto-cleanup on unmount)
  useSubscription('workspace:abc:sync');

  // Subscribe to multiple topics
  useSubscriptions(['topic1', 'topic2', 'topic3']);
}
```

#### useMessage

```typescript
import {
  useMessage,
  useMessages,
  useMessageState,
  useMessageHistory,
} from '@goalrate-app/websocket/react';

function Component() {
  // Handle specific message type
  useMessage('ENTITY_CHANGED', (payload) => {
    console.log('Entity changed:', payload);
  });

  // Handle multiple types
  useMessages({
    GOAL_UPDATED: (payload) => console.log('Goal:', payload),
    PROJECT_UPDATED: (payload) => console.log('Project:', payload),
  });

  // Get last message of type
  const lastSync = useMessageState<SyncAckPayload>('SYNC_ACK');

  // Get message history
  const history = useMessageHistory<NotificationPayload>('NOTIFICATION', {
    maxItems: 50,
  });
}
```

#### usePresence

```typescript
import { usePresence } from '@goalrate-app/websocket/react';

function OnlineUsers({ workspaceId }) {
  const {
    users,           // UserPresence[]
    onlineCount,     // number
    isLoading,
    error,
    updatePresence,  // (status) => void
    requestPresence, // () => void
  } = usePresence(workspaceId);

  return (
    <ul>
      {users.map((user) => (
        <li key={user.userId}>
          {user.username} - {user.status}
        </li>
      ))}
    </ul>
  );
}
```

#### useEntityViewers

```typescript
import { useEntityViewers } from '@goalrate-app/websocket/react';

function GoalDetail({ goalId }) {
  const {
    viewers,        // EntityViewer[]
    viewerCount,
    startViewing,   // () => void (called automatically on mount)
    stopViewing,    // () => void (called automatically on unmount)
  } = useEntityViewers('goal', goalId, {
    autoStart: true,  // Start viewing on mount
  });

  return (
    <div>
      {viewerCount > 0 && (
        <span>{viewerCount} people viewing</span>
      )}
    </div>
  );
}
```

#### useEntityEditors

```typescript
import { useEntityEditors } from '@goalrate-app/websocket/react';

function GoalEditor({ goalId }) {
  const {
    editors,           // EntityEditor[]
    editorCount,
    isBeingEdited,     // boolean (by someone else)
    conflictingFields, // string[] (fields being edited by others)
    startEditing,      // (field?: string) => void
    stopEditing,       // () => void
  } = useEntityEditors('goal', goalId, {
    autoStart: false,
  });

  const handleFocus = (field: string) => {
    startEditing(field);
  };

  return (
    <div>
      {isBeingEdited && (
        <Alert>Someone else is editing this goal</Alert>
      )}
      <input
        onFocus={() => handleFocus('title')}
        onBlur={stopEditing}
      />
    </div>
  );
}
```

#### useOptimisticUpdate

```typescript
import { useOptimisticUpdate } from '@goalrate-app/websocket/react';

function GoalEditor({ goal }) {
  const {
    data,              // Current data (local + pending changes)
    pendingChanges,    // Changes waiting to sync
    isPending,         // Has pending changes
    isSyncing,         // Currently syncing
    error,
    applyUpdate,       // (changes) => Promise<void>
    rollback,          // () => void
    retry,             // () => Promise<void>
  } = useOptimisticUpdate({
    entityType: 'goal',
    entityId: goal.id,
    vaultId: workspaceId,
    initialData: goal,
    initialVersion: goal.version,
    autoResolveLWW: true, // Auto-resolve using Last-Write-Wins
  });

  const handleTitleChange = async (newTitle: string) => {
    await applyUpdate({ title: newTitle });
  };

  return (
    <input
      value={data.title}
      onChange={(e) => handleTitleChange(e.target.value)}
    />
  );
}
```

#### useSyncStatus

```typescript
import { useSyncStatus } from '@goalrate-app/websocket/react';

function SyncIndicator({ vaultId }) {
  const {
    status,         // 'synced' | 'syncing' | 'pending' | 'error' | 'offline'
    pendingCount,   // Number of pending updates
    lastSyncAt,     // Date | null
    error,
    isSynced,
    isSyncing,
    isPending,
    isOffline,
    hasError,
  } = useSyncStatus(vaultId);

  return (
    <div>
      {isSyncing && <Spinner />}
      {isPending && <span>{pendingCount} changes pending</span>}
      {hasError && <span>Sync error: {error}</span>}
    </div>
  );
}
```

#### useConflictResolution

```typescript
import { useConflictResolution } from '@goalrate-app/websocket/react';

function ConflictHandler() {
  const {
    conflicts,       // SyncConflict[]
    hasConflicts,
    conflictCount,
    resolveConflict, // (conflictId, resolution, mergedData?) => void
    dismissConflict, // (conflictId) => void
    clearConflicts,  // () => void
  } = useConflictResolution({
    maxConflicts: 10,
    onConflictAdded: (conflict) => console.log('New conflict'),
  });

  return conflicts.map((conflict) => (
    <ConflictDialog
      key={conflict.id}
      conflict={conflict}
      onResolve={(resolution) => resolveConflict(conflict.id, resolution)}
      onDismiss={() => dismissConflict(conflict.id)}
    />
  ));
}
```

#### useRemoteChanges

```typescript
import { useRemoteChanges } from '@goalrate-app/websocket/react';

function GoalViewer({ goalId, vaultId }) {
  const {
    remoteChanges,     // EntityChange[]
    lastChange,        // EntityChange | null
    updatedBy,         // string | null (userId of last updater)
    hasChanges,
    clearChanges,
    applyChangesToData,
  } = useRemoteChanges({
    entityType: 'goal',
    entityId: goalId,
    vaultId,
  });

  return (
    <div>
      {updatedBy && <span>Updated by {updatedBy}</span>}
    </div>
  );
}
```

### Offline Support (React Native)

```typescript
import { OfflineQueue, OfflineSyncManager } from '@goalrate-app/websocket/offline';

// Create offline queue (uses AsyncStorage)
const queue = new OfflineQueue({
  maxQueueSize: 500,
  entryTTL: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxRetries: 5,
  storageKeyPrefix: '@goalrate/offline_sync',
});

await queue.initialize();

// Queue an update
await queue.enqueue({
  entityType: 'goal',
  entityId: 'goal_123',
  vaultId: 'vault_abc',
  changes: { title: 'Updated Goal' },
  baseVersion: 5,
});

// Sync manager coordinates queue + WebSocket
const syncManager = new OfflineSyncManager({
  queue,
  wsManager,
  batchSize: 10,
  batchDelay: 100,
  onSyncComplete: (results) => console.log('Synced:', results),
  onSyncError: (error) => console.error('Sync failed:', error),
});

// Start syncing when online
syncManager.start();

// Monitor status
const status = syncManager.getStatus();
// { isOnline, isSyncing, pendingCount, lastSyncAt, error }

// Stop syncing
syncManager.stop();
```

### Error Handling

```typescript
import {
  WebSocketError,
  isWebSocketError,
  isAuthError,
  isRateLimited,
  CLOSE_CODES,
} from '@goalrate-app/websocket';

ws.on('error', (error) => {
  if (isWebSocketError(error)) {
    switch (error.code) {
      case 'CONNECTION_FAILED':
        console.log('Could not connect');
        break;
      case 'AUTHENTICATION_FAILED':
        console.log('Invalid credentials');
        break;
      case 'HEARTBEAT_TIMEOUT':
        console.log('Connection stale');
        break;
      case 'MAX_RECONNECT_ATTEMPTS':
        console.log('Gave up reconnecting');
        break;
      case 'RATE_LIMITED':
        console.log('Too many messages');
        break;
    }
  }

  if (isAuthError(error)) {
    // Redirect to login
  }
});
```

## Package Structure

```
src/
├── index.ts              # Main exports
├── WebSocketManager.ts   # Core connection manager
├── MessageQueue.ts       # Message queuing during disconnect
├── HeartbeatManager.ts   # Ping/pong monitoring
├── types.ts              # Type definitions
├── errors.ts             # Error classes
├── react/
│   ├── index.ts          # React exports
│   ├── WebSocketContext.tsx
│   ├── WebSocketProvider.tsx
│   └── hooks/
│       ├── index.ts
│       ├── useWebSocket.ts
│       ├── useConnectionState.ts
│       ├── useSubscription.ts
│       ├── useMessage.ts
│       ├── usePresence.ts
│       ├── useEntityViewers.ts
│       ├── useEntityEditors.ts
│       ├── useOptimisticUpdate.ts
│       ├── useSyncStatus.ts
│       ├── useConflictResolution.ts
│       └── useRemoteChanges.ts
├── sync/
│   ├── index.ts
│   ├── types.ts
│   └── SyncManager.ts    # Sync orchestration
└── offline/
    ├── index.ts
    ├── types.ts
    ├── OfflineQueue.ts   # Persistent queue (AsyncStorage)
    └── OfflineSyncManager.ts
```

## Dependencies

- `@goalrate-app/shared` - Message type definitions
- `uuid` - Unique ID generation

## Exports

| Path | Description |
|------|-------------|
| `@goalrate-app/websocket` | Core classes and types |
| `@goalrate-app/websocket/react` | React hooks and provider |
| `@goalrate-app/websocket/offline` | Offline queue for React Native |

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

## Message Types

The package works with these message types (defined in `@goalrate-app/shared`):

| Type | Direction | Description |
|------|-----------|-------------|
| `CONNECT` | S→C | Connection established |
| `PING` / `PONG` | Both | Heartbeat |
| `SUBSCRIBE` | C→S | Subscribe to topic |
| `UNSUBSCRIBE` | C→S | Unsubscribe from topic |
| `DATA_SYNC` | C→S | Send data changes |
| `SYNC_ACK` | S→C | Sync accepted |
| `SYNC_REJECT` | S→C | Sync rejected (conflict) |
| `ENTITY_CHANGED` | S→C | Entity updated by others |
| `PRESENCE_UPDATE` | C→S | Update presence status |
| `PRESENCE_SYNC` | S→C | Current presence state |
| `ENTITY_VIEWING` | C→S | Start/stop viewing entity |
| `ENTITY_EDITING` | C→S | Start/stop editing entity |

## Related Packages

- `@goalrate-app/shared` - WebSocket message type definitions
- `@goalrate-app/storage` - Uses websocket for team sync
- `@goalrate-app/ui` - Sync status and conflict UI components
