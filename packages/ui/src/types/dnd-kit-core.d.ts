declare module '@dnd-kit/core' {
  import * as React from 'react';

  export type UniqueIdentifier = string | number;

  export type DragStartEvent = {
    active: {
      id: UniqueIdentifier;
    };
  };

  export type DragOverEvent = {
    active: {
      id: UniqueIdentifier;
    };
    over?: {
      id: UniqueIdentifier;
    } | null;
  };

  export type DragEndEvent = DragOverEvent;

  export type DropAnimation = unknown;

  export const closestCorners: (...args: unknown[]) => unknown;

  export class KeyboardSensor {}
  export class MouseSensor {}
  export class TouchSensor {}

  export function useSensor(sensor: unknown, options?: unknown): unknown;
  export function useSensors(...sensors: unknown[]): unknown;

  export const DndContext: React.FC<{
    children?: React.ReactNode;
    sensors?: unknown;
    collisionDetection?: unknown;
    onDragStart?: (event: DragStartEvent) => void;
    onDragOver?: (event: DragOverEvent) => void;
    onDragEnd?: (event: DragEndEvent) => void;
  }>;

  export const DragOverlay: React.FC<{
    children?: React.ReactNode;
    dropAnimation?: DropAnimation;
  }>;

  export function useDroppable(args: {
    id: UniqueIdentifier;
  }): {
    setNodeRef: (node: HTMLElement | null) => void;
    isOver: boolean;
  };
}
