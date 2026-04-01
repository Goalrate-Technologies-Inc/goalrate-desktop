import * as React from 'react';
import { Check, Calendar, Loader2 } from 'lucide-react';
import { Button } from '../primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../overlay/popover';
import { cn } from '../utils';

export interface FocusItemActionsProps {
  itemSource: string;
  onComplete: (itemSource: string) => void;
  onDefer: (itemSource: string, toDate: string) => void;
  isCompleting?: boolean;
  isDeferring?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

/**
 * FocusItemActions - Complete and defer action buttons for focus items
 */
export function FocusItemActions({
  itemSource,
  onComplete,
  onDefer,
  isCompleting = false,
  isDeferring = false,
  disabled = false,
  className,
  size = 'default',
}: FocusItemActionsProps): React.ReactElement {
  const [deferDate, setDeferDate] = React.useState<string>('');
  const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);

  const handleComplete = (): void => {
    if (!disabled && !isCompleting) {
      onComplete(itemSource);
    }
  };

  const handleDefer = (): void => {
    if (deferDate && !disabled && !isDeferring) {
      onDefer(itemSource, deferDate);
      setIsPopoverOpen(false);
      setDeferDate('');
    }
  };

  // Get tomorrow's date as the minimum defer date
  const tomorrow = React.useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return date.toISOString().split('T')[0];
  }, []);

  // Quick defer options
  const quickDeferOptions = React.useMemo(() => {
    const today = new Date();
    return [
      {
        label: 'Tomorrow',
        date: new Date(today.setDate(today.getDate() + 1))
          .toISOString()
          .split('T')[0],
      },
      {
        label: 'Next week',
        date: new Date(new Date().setDate(new Date().getDate() + 7))
          .toISOString()
          .split('T')[0],
      },
    ];
  }, []);

  const buttonSize = size === 'sm' ? 'sm' : 'default';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Complete button */}
      <Button
        variant="ghost"
        size={buttonSize}
        onClick={handleComplete}
        disabled={disabled || isCompleting}
        className="text-green-600 hover:text-green-700 hover:bg-green-50"
        title="Mark as complete"
      >
        {isCompleting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        {size === 'default' && <span className="ml-1">Done</span>}
      </Button>

      {/* Defer button with popover */}
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size={buttonSize}
            disabled={disabled || isDeferring}
            className="text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            title="Defer to later"
          >
            {isDeferring ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Calendar className="h-4 w-4" />
            )}
            {size === 'default' && <span className="ml-1">Defer</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="end">
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-900">Defer until</p>

            {/* Quick options */}
            <div className="flex gap-2">
              {quickDeferOptions.map((option) => (
                <Button
                  key={option.label}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onDefer(itemSource, option.date);
                    setIsPopoverOpen(false);
                  }}
                  className="flex-1 text-xs"
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {/* Custom date picker */}
            <div className="space-y-2">
              <label
                htmlFor={`defer-date-${itemSource}`}
                className="text-xs text-gray-500"
              >
                Or choose a date:
              </label>
              <input
                id={`defer-date-${itemSource}`}
                type="date"
                value={deferDate}
                min={tomorrow}
                onChange={(e) => setDeferDate(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
              />
              <Button
                variant="default"
                size="sm"
                onClick={handleDefer}
                disabled={!deferDate}
                className="w-full"
              >
                Defer
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
