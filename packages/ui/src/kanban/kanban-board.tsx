import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { cn } from '../utils/cn';

export interface KanbanBoardProps {
  children: React.ReactNode;
  onDragStart?: (event: DragStartEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  onDragEnd?: (event: DragEndEvent) => void;
  dragOverlay?: React.ReactNode;
  dropAnimation?: DropAnimation | null;
  className?: string;
}

/**
 * Kanban board container with drag-and-drop context.
 * Wrap your KanbanColumn components with this board.
 *
 * @example
 * ```tsx
 * <KanbanBoard onDragEnd={handleDragEnd}>
 *   <KanbanColumn id="todo" title="To Do">
 *     {items.map(item => <KanbanCard key={item.id} id={item.id} />)}
 *   </KanbanColumn>
 *   <KanbanColumn id="done" title="Done">
 *     ...
 *   </KanbanColumn>
 * </KanbanBoard>
 * ```
 */
export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  children,
  onDragStart,
  onDragOver,
  onDragEnd,
  dragOverlay,
  dropAnimation,
  className,
}) => {
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div
        className={cn(
          'flex gap-4 overflow-x-auto pb-4 min-h-[200px]',
          className
        )}
      >
        {children}
      </div>
      <DragOverlay dropAnimation={dropAnimation ?? undefined}>{dragOverlay}</DragOverlay>
    </DndContext>
  );
};

export default KanbanBoard;
