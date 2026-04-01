/**
 * useEntityViewers Hook
 * Track who's viewing a specific entity
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { MessageType } from '../../types';
import type { EntityViewer, EntityPresence } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';
import { useMessage } from './useMessage';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Viewer update payload from server
 */
interface ViewerUpdatePayload {
  entityType: string;
  entityId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  action: 'started' | 'stopped';
  startedAt?: string;
}

/**
 * Viewers response payload from server
 */
interface ViewersResponsePayload {
  entityType: string;
  entityId: string;
  viewers: Array<{
    userId: string;
    username: string;
    avatarUrl?: string;
    startedAt: string;
  }>;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook options
 */
export interface UseEntityViewersOptions {
  /** Auto-track viewing when hook mounts (default: true) */
  autoTrack?: boolean;
}

/**
 * Hook return type
 */
export interface UseEntityViewersReturn {
  /** Current entity presence */
  presence: EntityPresence | null;

  /** List of viewers */
  viewers: EntityViewer[];

  /** Is loading initial viewers */
  loading: boolean;

  /** Start viewing (manually, if autoTrack is false) */
  startViewing: () => void;

  /** Stop viewing */
  stopViewing: () => void;
}

/**
 * Track who's viewing an entity
 *
 * @param entityType Type of entity (e.g., 'goal', 'project', 'story')
 * @param entityId ID of the entity
 * @param options Hook options
 */
export function useEntityViewers(
  entityType: string | undefined | null,
  entityId: string | undefined | null,
  options: UseEntityViewersOptions = {}
): UseEntityViewersReturn {
  const { autoTrack = true } = options;
  const { manager, isConnected } = useWebSocketContext();

  // State
  const [presenceState, setPresenceState] = useState<{
    key: string;
    presence: EntityPresence | null;
  }>({ key: '', presence: null });
  const isViewingRef = useRef(false);
  const requestKey = entityType && entityId ? `${entityType}:${entityId}` : '';
  const presence = requestKey && presenceState.key === requestKey ? presenceState.presence : null;
  const loading = Boolean(requestKey) && presenceState.key !== requestKey;

  // Handle viewer updates
  useMessage<ViewerUpdatePayload>(
    'entity_viewing' as MessageType,
    useCallback(
      (data) => {
        if (data.entityType !== entityType || data.entityId !== entityId) {
          return;
        }

        const nextKey = `${data.entityType}:${data.entityId}`;
        setPresenceState((prev) => {
          const previousPresence = prev.key === nextKey ? prev.presence : null;
          const current = previousPresence || {
            entityType: data.entityType,
            entityId: data.entityId,
            viewers: [],
            editors: [],
            updatedAt: new Date(),
          };

          const viewerIndex = current.viewers.findIndex((v) => v.userId === data.userId);
          const updatedViewers = [...current.viewers];

          if (data.action === 'stopped') {
            if (viewerIndex !== -1) {
              updatedViewers.splice(viewerIndex, 1);
            }
          } else {
            const viewer: EntityViewer = {
              userId: data.userId,
              username: data.username,
              avatarUrl: data.avatarUrl,
              startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
            };

            if (viewerIndex !== -1) {
              updatedViewers[viewerIndex] = viewer;
            } else {
              updatedViewers.push(viewer);
            }
          }

          return {
            key: nextKey,
            presence: {
              ...current,
              viewers: updatedViewers,
              updatedAt: new Date(),
            },
          };
        });
      },
      [entityType, entityId]
    )
  );

  // Handle viewers response
  useMessage<ViewersResponsePayload>(
    'entity_viewers_response' as MessageType,
    useCallback(
      (data) => {
        if (data.entityType !== entityType || data.entityId !== entityId) {
          return;
        }

        const nextKey = `${data.entityType}:${data.entityId}`;
        setPresenceState((prev) => ({
          key: nextKey,
          presence: {
            entityType: data.entityType,
            entityId: data.entityId,
            viewers: data.viewers.map((v) => ({
              userId: v.userId,
              username: v.username,
              avatarUrl: v.avatarUrl,
              startedAt: new Date(v.startedAt),
            })),
            editors: prev.key === nextKey ? prev.presence?.editors || [] : [],
            updatedAt: new Date(),
          },
        }));
      },
      [entityType, entityId]
    )
  );

  // Start viewing
  const startViewing = useCallback(() => {
    if (!manager || !isConnected || !entityType || !entityId || isViewingRef.current) {
      return;
    }

    manager.send('entity_viewing' as MessageType, {
      action: 'start',
      entityType,
      entityId,
    });
    isViewingRef.current = true;
  }, [manager, isConnected, entityType, entityId]);

  // Stop viewing
  const stopViewing = useCallback(() => {
    if (!manager || !entityType || !entityId || !isViewingRef.current) {
      return;
    }

    manager.send('entity_viewing' as MessageType, {
      action: 'stop',
      entityType,
      entityId,
    });
    isViewingRef.current = false;
  }, [manager, entityType, entityId]);

  // Auto-track viewing
  useEffect(() => {
    if (!autoTrack || !manager || !isConnected || !entityType || !entityId) {
      return;
    }

    startViewing();

    // Request current viewers
    manager.send('entity_viewers_request' as MessageType, {
      entityType,
      entityId,
    });

    // Stop viewing on unmount
    return () => {
      stopViewing();
    };
  }, [autoTrack, manager, isConnected, entityType, entityId, startViewing, stopViewing]);

  return {
    presence,
    viewers: presence?.viewers || [],
    loading,
    startViewing,
    stopViewing,
  };
}
