import * as React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '../utils/cn';

export interface KanbanCardProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  isDragging?: boolean;
  showDragHandle?: boolean;
  'data-testid'?: string;
}

/**
 * Draggable kanban card component.
 * Should be used inside a KanbanColumn.
 *
 * @example
 * ```tsx
 * <KanbanCard id="task-1" onClick={() => handleClick('task-1')}>
 *   <h4>Task Title</h4>
 *   <p>Task description</p>
 * </KanbanCard>
 * ```
 */
export const KanbanCard: React.FC<KanbanCardProps> = ({
  id,
  children,
  className,
  onClick,
  isDragging: isDraggingProp,
  showDragHandle = true,
  'data-testid': testId,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isDraggingSortable,
  } = useSortable({ id });

  const isDragging = isDraggingProp ?? isDraggingSortable;
  const wasDraggingRef = React.useRef(false);
  const suppressClickRef = React.useRef(false);

  React.useEffect(() => {
    if (isDragging) {
      wasDraggingRef.current = true;
    }
  }, [isDragging]);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative bg-card border border-divider rounded-lg p-3 shadow-sm',
        'cursor-grab select-none touch-none transition-all duration-200',
        'hover:shadow-md hover:border-divider/80',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-primary/20',
        className
      )}
      {...(!showDragHandle ? { ...attributes, ...listeners } : {})}
      onPointerDownCapture={(event) => {
        if (event.button === 0 || event.pointerType === 'touch') {
          wasDraggingRef.current = false;
          suppressClickRef.current = false;
        }
      }}
      onPointerUpCapture={(event) => {
        if (!onClick) {
          return;
        }
        if (event.button !== 0 && event.pointerType !== 'touch') {
          return;
        }
        const target = event.target as HTMLElement | null;
        if (target?.closest('[data-kanban-drag-handle]')) {
          return;
        }
        if (!wasDraggingRef.current) {
          suppressClickRef.current = true;
          onClick();
        }
      }}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onClick?.();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      role="button"
      tabIndex={0}
      data-testid={testId}
    >
      {showDragHandle && (
        <button
          className={cn(
            'absolute top-2 right-2 p-1 rounded',
            'text-muted-foreground hover:text-foreground hover:bg-muted',
            'cursor-grab active:cursor-grabbing',
            'focus:outline-none focus:ring-2 focus:ring-ring'
          )}
          data-kanban-drag-handle
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className={cn(showDragHandle && 'pr-8')}>{children}</div>
    </div>
  );
};

export default KanbanCard;
