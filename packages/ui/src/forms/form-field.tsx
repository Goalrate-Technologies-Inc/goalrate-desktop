import * as React from 'react';
import { Input } from '../primitives/input';
import { Textarea } from '../primitives/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/select';
import { Switch } from '../primitives/switch';
import { Label } from '../primitives/label';
import { CalendarDays } from 'lucide-react';
import { cn } from '../utils/cn';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'switch'
  | 'date'
  | 'email'
  | 'password'
  | 'number';

export interface FormFieldProps {
  id: string;
  label: string;
  type: FormFieldType;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  disabled?: boolean;
  error?: string;
  help?: string;
  className?: string;
  'data-testid'?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  options = [],
  required = false,
  disabled = false,
  error,
  help,
  className = '',
  'data-testid': testId,
}) => {
  const renderInput = (): React.JSX.Element => {
    switch (type) {
      case 'textarea':
        return (
          <Textarea
            id={id}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(error && 'border-destructive', 'min-h-20')}
            data-testid={testId}
          />
        );

      case 'select':
        return (
          <Select
            value={value as string}
            onValueChange={onChange}
            disabled={disabled}
            data-testid={testId}
          >
            <SelectTrigger className={cn(error && 'border-destructive')}>
              <SelectValue
                placeholder={placeholder || `Select ${label.toLowerCase()}`}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );

      case 'switch':
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={id}
              checked={value as boolean}
              onCheckedChange={onChange}
              disabled={disabled}
              data-testid={testId}
            />
            <Label
              htmlFor={id}
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {label}
            </Label>
          </div>
        );

      case 'date':
        return (
          <div className="relative">
            <Input
              id={id}
              type="date"
              value={value as string}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className={cn(error && 'border-destructive')}
              data-testid={testId}
            />
            <CalendarDays className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        );

      default:
        return (
          <Input
            id={id}
            type={type}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(error && 'border-destructive')}
            data-testid={testId}
          />
        );
    }
  };

  if (type === 'switch') {
    return (
      <div className={cn('space-y-2', className)}>
        {renderInput()}
        {help && <p className="text-sm text-muted-foreground">{help}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id} className="text-sm font-medium leading-none">
        {label}
        {required && <span className="text-destructive ml-1">*</span>}
      </Label>
      {renderInput()}
      {help && <p className="text-sm text-muted-foreground">{help}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};

export default FormField;
