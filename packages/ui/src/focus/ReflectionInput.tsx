import * as React from 'react';
import { Textarea } from '../primitives/textarea';
import { cn } from '../utils';

export interface ReflectionInputProps {
  value?: string;
  onChange: (reflection: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const defaultPlaceholder = "What went well today? What could have been better? Any thoughts for tomorrow?";

/**
 * ReflectionInput - Text area for daily reflection notes
 */
export function ReflectionInput({
  value = '',
  onChange,
  maxLength = 500,
  placeholder = defaultPlaceholder,
  disabled = false,
  className,
}: ReflectionInputProps): React.ReactElement {
  const charCount = value.length;
  const isNearLimit = maxLength && charCount > maxLength * 0.8;
  const isAtLimit = maxLength && charCount >= maxLength;

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      const newValue = e.target.value;
      if (!maxLength || newValue.length <= maxLength) {
        onChange(newValue);
      }
    },
    [onChange, maxLength]
  );

  return (
    <div className={cn('space-y-2', className)}>
      <label className="text-sm font-medium text-gray-700" htmlFor="reflection-input">
        Reflection (optional)
      </label>
      <Textarea
        id="reflection-input"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        rows={3}
        className={cn(
          'resize-none',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        aria-describedby="reflection-char-count"
      />
      <div
        id="reflection-char-count"
        className={cn(
          'text-xs text-right',
          isAtLimit
            ? 'text-red-600'
            : isNearLimit
              ? 'text-yellow-600'
              : 'text-gray-400'
        )}
      >
        {charCount}/{maxLength}
      </div>
    </div>
  );
}
