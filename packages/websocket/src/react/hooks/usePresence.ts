/**
 * usePresence Hook
 * Track workspace presence (who's online)
 */

import { useEffect, useState, useCallback } from 'react';
import { MessageType, TOPICS } from '../../types';
import type { UserPresence, WorkspacePresence } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';
import { useSubscription } from './useSubscription';
import { useMessage } from './useMessage';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Presence update payload from server
 */
interface PresenceUpdatePayload {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: 'online' | 'offline' | 'away' | 'busy';
  lastActivity?: string;
}

/**
 * Presence response payload from server
 */
interface PresenceResponsePayload {
  workspaceId: string;
  users: PresenceUpdatePayload[];
}

// ============================================================================
// HOOKS
// ============================================================================

/**
 * Hook options
 */
export interface UsePresenceOptions {
  /** Update status on activity (default: true) */
  updateOnActivity?: boolean;

  /** Initial status when joining (default: 'online') */
  initialStatus?: 'online' | 'away' | 'busy';
}

/**
 * Hook return type
 */
export interface UsePresenceReturn {
  /** Current workspace presence */
  presence: WorkspacePresence | null;

  /** List of online users */
  users: UserPresence[];

  /** Is loading initial presence */
  loading: boolean;

  /** Update own status */
  setStatus: (status: 'online' | 'away' | 'busy') => void;

  /** Refresh presence data */
  refresh: () => void;
}

/**
 * Track workspace presence
 *
 * @param workspaceId Workspace ID to track presence for
 * @param options Hook options
 */
export function usePresence(
  workspaceId: string | undefined | null,
  options: UsePresenceOptions = {}
): UsePresenceReturn {
  const { updateOnActivity = true, initialStatus = 'online' } = options;
  const { manager, isConnected } = useWebSocketContext();

  // State
  const [presence, setPresence] = useState<WorkspacePresence | null>(null);
  const [loadedWorkspaceId, setLoadedWorkspaceId] = useState<string | null>(null);
  const loading = Boolean(workspaceId) && loadedWorkspaceId !== workspaceId;

  // Subscribe to workspace presence topic
  const topic = workspaceId ? TOPICS.workspace(workspaceId) : null;
  useSubscription(topic);

  // Handle presence updates
  useMessage<PresenceUpdatePayload>(
    MessageType.PRESENCE_UPDATE,
    useCallback(
      (data) => {
        if (!workspaceId) {
          return;
        }

        setPresence((prev) => {
          if (!prev) {
            return {
              workspaceId,
              users: [
                {
                  userId: data.userId,
                  username: data.username,
                  avatarUrl: data.avatarUrl,
                  status: data.status,
                  lastActivity: data.lastActivity ? new Date(data.lastActivity) : undefined,
                },
              ],
              updatedAt: new Date(),
            };
          }

          const userIndex = prev.users.findIndex((u) => u.userId === data.userId);
          const updatedUsers = [...prev.users];

          if (data.status === 'offline') {
            // Remove user
            if (userIndex !== -1) {
              updatedUsers.splice(userIndex, 1);
            }
          } else {
            const user: UserPresence = {
              userId: data.userId,
              username: data.username,
              avatarUrl: data.avatarUrl,
              status: data.status,
              lastActivity: data.lastActivity ? new Date(data.lastActivity) : undefined,
            };

            if (userIndex !== -1) {
              updatedUsers[userIndex] = user;
            } else {
              updatedUsers.push(user);
            }
          }

          return {
            ...prev,
            users: updatedUsers,
            updatedAt: new Date(),
          };
        });
      },
      [workspaceId]
    )
  );

  // Request initial presence when connected
  useEffect(() => {
    if (!manager || !isConnected || !workspaceId) {
      return;
    }

    // Send presence request
    manager.send(MessageType.PRESENCE_UPDATE, {
      type: 'presence_request',
      workspaceId,
    });

    // Also announce own presence
    manager.send(MessageType.PRESENCE_UPDATE, {
      type: 'presence_update',
      workspaceId,
      status: initialStatus,
    });
  }, [manager, isConnected, workspaceId, initialStatus]);

  // Handle presence response
  useMessage<PresenceResponsePayload>(
    'presence_response' as MessageType,
    useCallback(
      (data) => {
        if (data.workspaceId !== workspaceId) {
          return;
        }

        setPresence({
          workspaceId: data.workspaceId,
          users: data.users.map((u) => ({
            userId: u.userId,
            username: u.username,
            avatarUrl: u.avatarUrl,
            status: u.status,
            lastActivity: u.lastActivity ? new Date(u.lastActivity) : undefined,
          })),
          updatedAt: new Date(),
        });
        setLoadedWorkspaceId(data.workspaceId);
      },
      [workspaceId]
    )
  );

  // Update status on activity
  useEffect(() => {
    if (!updateOnActivity || !manager || !isConnected || !workspaceId) {
      return;
    }

    // Update activity on user interactions
    const handleActivity = (): void => {
      manager.send(MessageType.PRESENCE_UPDATE, {
        type: 'activity',
        workspaceId,
      });
    };

    // Debounce activity updates
    let timeout: ReturnType<typeof setTimeout>;
    const debouncedActivity = (): void => {
      clearTimeout(timeout);
      timeout = setTimeout(handleActivity, 5000);
    };

    window.addEventListener('mousemove', debouncedActivity);
    window.addEventListener('keydown', debouncedActivity);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('mousemove', debouncedActivity);
      window.removeEventListener('keydown', debouncedActivity);
    };
  }, [updateOnActivity, manager, isConnected, workspaceId]);

  // Set status
  const setStatus = useCallback(
    (status: 'online' | 'away' | 'busy') => {
      if (!manager || !isConnected || !workspaceId) {
        return;
      }

      manager.send(MessageType.PRESENCE_UPDATE, {
        type: 'status_update',
        workspaceId,
        status,
      });
    },
    [manager, isConnected, workspaceId]
  );

  // Refresh presence
  const refresh = useCallback(() => {
    if (!manager || !isConnected || !workspaceId) {
      return;
    }

    setLoadedWorkspaceId(null);
    manager.send(MessageType.PRESENCE_UPDATE, {
      type: 'presence_request',
      workspaceId,
    });
  }, [manager, isConnected, workspaceId]);

  return {
    presence,
    users: presence?.users || [],
    loading,
    setStatus,
    refresh,
  };
}
