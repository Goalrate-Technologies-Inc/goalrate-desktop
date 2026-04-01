declare module '@dnd-kit/sortable' {
  import * as React from 'react';
  import type { UniqueIdentifier } from '@dnd-kit/core';

  export const sortableKeyboardCoordinates: (...args: unknown[]) => unknown;

  export const SortableContext: React.FC<{
    id?: string;
    items: Array<UniqueIdentifier | { id: UniqueIdentifier }>;
    strategy?: unknown;
    children?: React.ReactNode;
  }>;

  export const verticalListSortingStrategy: unknown;

  export function useSortable(args: {
    id: UniqueIdentifier;
  }): {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown>;
    setNodeRef: (node: HTMLElement | null) => void;
    transform: unknown;
    transition?: string;
    isDragging: boolean;
  };
}
