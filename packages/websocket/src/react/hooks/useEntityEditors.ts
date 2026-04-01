/**
 * useEntityEditors Hook
 * Track who's editing a specific entity
 */

import { useEffect, useState, useCallback } from 'react';
import { MessageType } from '../../types';
import type { EntityEditor, EntityPresence } from '../../types';
import { useWebSocketContext } from '../WebSocketContext';
import { useMessage } from './useMessage';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Editor update payload from server
 */
interface EditorUpdatePayload {
  entityType: string;
  entityId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  fieldName?: string;
  action: 'started' | 'stopped';
  startedAt?: string;
}

/**
 * Editors response payload from server
 */
interface EditorsResponsePayload {
  entityType: string;
  entityId: string;
  editors: Array<{
    userId: string;
    username: string;
    avatarUrl?: string;
    fieldName?: string;
    startedAt: string;
  }>;
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook options
 */
export interface UseEntityEditorsOptions {
  /** Field name being edited (optional) */
  fieldName?: string;
}

/**
 * Hook return type
 */
export interface UseEntityEditorsReturn {
  /** Current entity presence */
  presence: EntityPresence | null;

  /** List of editors */
  editors: EntityEditor[];

  /** Is loading initial editors */
  loading: boolean;

  /** Start editing */
  startEditing: (fieldName?: string) => void;

  /** Stop editing */
  stopEditing: () => void;

  /** Is currently editing */
  isEditing: boolean;

  /** Check if a specific field is being edited by someone else */
  isFieldBeingEdited: (fieldName: string, excludeUserId?: string) => boolean;
}

/**
 * Track who's editing an entity
 *
 * @param entityType Type of entity (e.g., 'goal', 'project', 'story')
 * @param entityId ID of the entity
 * @param options Hook options
 */
export function useEntityEditors(
  entityType: string | undefined | null,
  entityId: string | undefined | null,
  options: UseEntityEditorsOptions = {}
): UseEntityEditorsReturn {
  const { manager, isConnected } = useWebSocketContext();

  // State
  const [presenceState, setPresenceState] = useState<{
    key: string;
    presence: EntityPresence | null;
  }>({ key: '', presence: null });
  const [isEditing, setIsEditing] = useState(false);
  const [currentFieldName, setCurrentFieldName] = useState<string | undefined>(
    options.fieldName
  );
  const requestKey = entityType && entityId ? `${entityType}:${entityId}` : '';
  const presence = requestKey && presenceState.key === requestKey ? presenceState.presence : null;
  const loading = Boolean(requestKey) && presenceState.key !== requestKey;

  // Handle editor updates
  useMessage<EditorUpdatePayload>(
    'entity_editing' as MessageType,
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

          const editorIndex = current.editors.findIndex(
            (e) => e.userId === data.userId && e.fieldName === data.fieldName
          );
          const updatedEditors = [...current.editors];

          if (data.action === 'stopped') {
            if (editorIndex !== -1) {
              updatedEditors.splice(editorIndex, 1);
            }
          } else {
            const editor: EntityEditor = {
              userId: data.userId,
              username: data.username,
              avatarUrl: data.avatarUrl,
              fieldName: data.fieldName,
              startedAt: data.startedAt ? new Date(data.startedAt) : new Date(),
            };

            if (editorIndex !== -1) {
              updatedEditors[editorIndex] = editor;
            } else {
              updatedEditors.push(editor);
            }
          }

          return {
            key: nextKey,
            presence: {
              ...current,
              editors: updatedEditors,
              updatedAt: new Date(),
            },
          };
        });
      },
      [entityType, entityId]
    )
  );

  // Handle editors response
  useMessage<EditorsResponsePayload>(
    'entity_editors_response' as MessageType,
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
            viewers: prev.key === nextKey ? prev.presence?.viewers || [] : [],
            editors: data.editors.map((e) => ({
              userId: e.userId,
              username: e.username,
              avatarUrl: e.avatarUrl,
              fieldName: e.fieldName,
              startedAt: new Date(e.startedAt),
            })),
            updatedAt: new Date(),
          },
        }));
      },
      [entityType, entityId]
    )
  );

  // Start editing
  const startEditing = useCallback(
    (fieldName?: string) => {
      if (!manager || !isConnected || !entityType || !entityId || isEditing) {
        return;
      }

      const field = fieldName || currentFieldName;
      manager.send('entity_editing' as MessageType, {
        action: 'start',
        entityType,
        entityId,
        fieldName: field,
      });
      setIsEditing(true);
      setCurrentFieldName(field);
    },
    [manager, isConnected, entityType, entityId, isEditing, currentFieldName]
  );

  // Stop editing
  const stopEditing = useCallback(() => {
    if (!manager || !entityType || !entityId || !isEditing) {
      return;
    }

    manager.send('entity_editing' as MessageType, {
      action: 'stop',
      entityType,
      entityId,
      fieldName: currentFieldName,
    });
    setIsEditing(false);
    setCurrentFieldName(undefined);
  }, [manager, entityType, entityId, isEditing, currentFieldName]);

  // Check if field is being edited
  const isFieldBeingEdited = useCallback(
    (fieldName: string, excludeUserId?: string): boolean => {
      if (!presence) {
        return false;
      }

      return presence.editors.some(
        (e) =>
          e.fieldName === fieldName && (!excludeUserId || e.userId !== excludeUserId)
      );
    },
    [presence]
  );

  // Request initial editors when connected
  useEffect(() => {
    if (!manager || !isConnected || !entityType || !entityId) {
      return;
    }

    manager.send('entity_editors_request' as MessageType, {
      entityType,
      entityId,
    });

    // Stop editing on unmount
    return () => {
      if (isEditing) {
        manager.send('entity_editing' as MessageType, {
          action: 'stop',
          entityType,
          entityId,
          fieldName: currentFieldName,
        });
      }
    };
  }, [manager, isConnected, entityType, entityId, currentFieldName, isEditing]);

  return {
    presence,
    editors: presence?.editors || [],
    loading,
    startEditing,
    stopEditing,
    isEditing,
    isFieldBeingEdited,
  };
}
