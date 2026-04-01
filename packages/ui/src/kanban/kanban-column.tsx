import * as React from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { cn } from '../utils/cn';

export interface KanbanColumnProps {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  itemIds?: string[];
  headerActions?: React.ReactNode;
  headerClassName?: string;
  className?: string;
  emptyMessage?: string;
  showHeader?: boolean;
}

/**
 * Kanban column that accepts draggable cards.
 * Should be used inside a KanbanBoard.
 *
 * @example
 * ```tsx
 * <KanbanColumn
 *   id="in-progress"
 *   title="In Progress"
 *   count={3}
 *   itemIds={['item-1', 'item-2', 'item-3']}
 * >
 *   {items.map(item => <KanbanCard key={item.id} id={item.id} />)}
 * </KanbanColumn>
 * ```
 */
export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  id,
  title,
  count,
  children,
  itemIds = [],
  headerActions,
  headerClassName,
  className,
  emptyMessage = 'No items',
  showHeader = true,
}) => {
  const { setNodeRef, isOver } = useDroppable({ id });

  const isEmpty = React.Children.count(children) === 0;

  return (
    <div
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] bg-muted/30',
        showHeader ? 'rounded-lg' : 'rounded-b-lg rounded-t-none',
        className
      )}
    >
      {/* Column Header */}
      {showHeader ? (
        <div
          className={cn(
            'flex items-center justify-between h-12 px-3 border-b border-divider',
            headerClassName
          )}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm text-foreground">{title}</h3>
            {count !== undefined && (
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                {count}
              </span>
            )}
          </div>
          {headerActions ? (
            <div className="flex h-7 w-7 items-center justify-center shrink-0">
              {headerActions}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Column Content */}
      <SortableContext
        id={id}
        items={itemIds}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            'flex-1 p-2 space-y-2 overflow-y-auto min-h-[100px] transition-colors',
            isOver && 'bg-primary/5'
          )}
        >
          {isEmpty ? (
            <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
              {emptyMessage}
            </div>
          ) : (
            children
          )}
        </div>
      </SortableContext>
    </div>
  );
};

export default KanbanColumn;
