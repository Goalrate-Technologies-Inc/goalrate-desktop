import * as React from 'react';
import type { FocusMood } from '@goalrate-app/shared';
import { Star, Smile, Meh, Frown } from 'lucide-react';
import { cn } from '../utils';

export interface MoodSelectorProps {
  value?: FocusMood;
  onChange: (mood: FocusMood) => void;
  disabled?: boolean;
  className?: string;
}

interface MoodOption {
  value: FocusMood;
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  selectedBgColor: string;
}

const moodOptions: MoodOption[] = [
  {
    value: 'great',
    label: 'Great',
    icon: <Star className="h-5 w-5" />,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50 hover:bg-yellow-100',
    selectedBgColor: 'bg-yellow-100 ring-2 ring-yellow-400',
  },
  {
    value: 'good',
    label: 'Good',
    icon: <Smile className="h-5 w-5" />,
    color: 'text-green-600',
    bgColor: 'bg-green-50 hover:bg-green-100',
    selectedBgColor: 'bg-green-100 ring-2 ring-green-400',
  },
  {
    value: 'okay',
    label: 'Okay',
    icon: <Meh className="h-5 w-5" />,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 hover:bg-blue-100',
    selectedBgColor: 'bg-blue-100 ring-2 ring-blue-400',
  },
  {
    value: 'low',
    label: 'Low',
    icon: <Frown className="h-5 w-5" />,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 hover:bg-gray-100',
    selectedBgColor: 'bg-gray-100 ring-2 ring-gray-400',
  },
];

/**
 * MoodSelector - Allows user to select their end-of-day mood
 */
export function MoodSelector({
  value,
  onChange,
  disabled = false,
  className,
}: MoodSelectorProps): React.ReactElement {
  return (
    <div className={cn('space-y-2', className)}>
      <span className="text-sm font-medium text-gray-700">
        How was your day?
      </span>
      <div
        className="flex gap-2"
        role="radiogroup"
        aria-label="Select your mood"
      >
        {moodOptions.map((option) => {
          const isSelected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={option.label}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex flex-col items-center gap-1 p-3 rounded-lg transition-all duration-200',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500',
                isSelected ? option.selectedBgColor : option.bgColor,
                disabled && 'opacity-50 cursor-not-allowed',
                !disabled && 'cursor-pointer'
              )}
            >
              <span className={option.color}>{option.icon}</span>
              <span
                className={cn(
                  'text-xs font-medium',
                  isSelected ? 'text-gray-900' : 'text-gray-600'
                )}
              >
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
