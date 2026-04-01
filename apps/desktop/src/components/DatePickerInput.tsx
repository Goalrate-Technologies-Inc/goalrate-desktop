import { useMemo, useState } from 'react';
import { Button } from '@goalrate-app/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@goalrate-app/ui/overlay';
import { cn } from '@goalrate-app/ui/utils';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

type DatePickerInputProps = {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  min?: string;
  max?: string;
  placeholder?: string;
  allowClear?: boolean;
  buttonClassName?: string;
};

type CalendarCell = {
  value: string;
  day: number;
  inCurrentMonth: boolean;
  isDisabled: boolean;
  isSelected: boolean;
  isToday: boolean;
};

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getInitialMonthCursor(value: string, min?: string): Date {
  const parsedValue = parseDateValue(value);
  const parsedMin = parseDateValue(min ?? '');
  return startOfMonth(parsedValue ?? parsedMin ?? new Date());
}

function formatDisplayValue(value: string): string {
  const parsed = parseDateValue(value);
  if (!parsed) {
    return value;
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isOutOfRange(value: string, min?: string, max?: string): boolean {
  if (min && value < min) {
    return true;
  }
  if (max && value > max) {
    return true;
  }
  return false;
}

function buildCalendarCells(monthCursor: Date, selectedValue: string, min?: string, max?: string): CalendarCell[] {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDayWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const todayValue = formatDateValue(new Date());

  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const dayOffset = index - firstDayWeekday + 1;
    let day = dayOffset;
    let cellDate: Date;
    let inCurrentMonth = true;

    if (dayOffset < 1) {
      inCurrentMonth = false;
      day = daysInPreviousMonth + dayOffset;
      cellDate = new Date(year, month - 1, day);
    } else if (dayOffset > daysInMonth) {
      inCurrentMonth = false;
      day = dayOffset - daysInMonth;
      cellDate = new Date(year, month + 1, day);
    } else {
      cellDate = new Date(year, month, day);
    }

    const value = formatDateValue(cellDate);
    cells.push({
      value,
      day,
      inCurrentMonth,
      isDisabled: isOutOfRange(value, min, max),
      isSelected: selectedValue === value,
      isToday: value === todayValue,
    });
  }

  return cells;
}

export function DatePickerInput({
  id,
  value,
  onChange,
  disabled = false,
  min,
  max,
  placeholder = 'Select date',
  allowClear = true,
  buttonClassName,
}: DatePickerInputProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState<Date>(() =>
    getInitialMonthCursor(value, min)
  );

  const monthLabel = useMemo(
    () =>
      monthCursor.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [monthCursor]
  );

  const cells = useMemo(
    () => buildCalendarCells(monthCursor, value, min, max),
    [monthCursor, value, min, max]
  );

  const hasValue = Boolean(value);
  const displayedValue = hasValue ? formatDisplayValue(value) : placeholder;
  const todayValue = formatDateValue(new Date());
  const todayDisabled = isOutOfRange(todayValue, min, max);

  const selectDate = (nextValue: string): void => {
    if (isOutOfRange(nextValue, min, max)) {
      return;
    }
    onChange(nextValue);
    setOpen(false);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setMonthCursor(getInitialMonthCursor(value, min));
    }
    setOpen(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'w-full justify-between rounded-xl border-divider/80 bg-card px-3 py-2.5 text-left text-sm font-medium tracking-tight shadow-sm transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-primary/50',
            !hasValue && 'text-muted-foreground',
            buttonClassName
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{displayedValue}</span>
          </span>
          <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] overflow-hidden rounded-2xl border border-divider/80 bg-card/95 p-0 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-divider/70 bg-gradient-to-b from-muted/65 to-muted/25 px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-divider/60 bg-card/80 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold tracking-tight">{monthLabel}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-divider/70 hover:bg-card"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-md border border-transparent text-muted-foreground hover:border-divider/70 hover:bg-card"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-2.5 p-2.5">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((weekday) => (
              <div
                key={weekday}
                className="flex h-7 items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80"
              >
                {weekday}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => (
              <button
                key={`${cell.value}-${cell.day}`}
                type="button"
                onClick={() => selectDate(cell.value)}
                disabled={cell.isDisabled}
                className={cn(
                  'relative h-8 rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55',
                  cell.inCurrentMonth ? 'text-foreground' : 'text-muted-foreground/60',
                  !cell.isDisabled && !cell.isSelected && 'hover:bg-accent hover:text-accent-foreground',
                  cell.isDisabled && 'cursor-not-allowed opacity-40',
                  cell.isSelected
                  && 'bg-primary text-primary-foreground shadow-[0_6px_16px_hsl(var(--primary)/0.30)] hover:bg-primary/90',
                  !cell.isSelected && cell.isToday && 'bg-primary/10 text-primary ring-1 ring-primary/35'
                )}
                aria-label={new Date(`${cell.value}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              >
                {cell.day}
                {!cell.isSelected && cell.isToday ? (
                  <span className="pointer-events-none absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary/75" />
                ) : null}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-divider/70 pt-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => selectDate(todayValue)}
              disabled={todayDisabled}
              className="h-7 rounded-md border-divider/70 px-2 text-[11px]"
            >
              Today
            </Button>
            {allowClear && hasValue ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
                className="h-7 gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
