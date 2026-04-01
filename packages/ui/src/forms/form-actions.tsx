import * as React from 'react';
import { Button } from '../primitives/button';
import { Loader2 } from 'lucide-react';
import { cn } from '../utils/cn';

export type FormActionsVariant =
  | 'default'
  | 'goals'
  | 'projects'
  | 'destructive';

export interface FormActionsProps {
  submitText?: string;
  cancelText?: string;
  onSubmit?: () => void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  disabled?: boolean;
  variant?: FormActionsVariant;
  className?: string;
  'data-testid'?: string;
}

export const FormActions: React.FC<FormActionsProps> = ({
  submitText = 'Save',
  cancelText = 'Cancel',
  onSubmit,
  onCancel,
  isSubmitting = false,
  disabled = false,
  variant = 'default',
  className = '',
  'data-testid': testId,
}) => {
  const getSubmitButtonVariant = (): 'default' | 'goals' | 'destructive' => {
    switch (variant) {
      case 'goals':
        return 'goals';
      case 'projects':
        return 'default'; // Blue for projects
      case 'destructive':
        return 'destructive';
      default:
        return 'default';
    }
  };

  const getSubmitButtonClass = (): string => {
    switch (variant) {
      case 'projects':
        return 'bg-goalrate-blue hover:bg-goalrate-blue-hover text-white';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn('flex items-center gap-3', className)}
      data-testid={testId}
    >
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={isSubmitting}
        data-testid={testId ? `${testId}-cancel` : undefined}
      >
        {cancelText}
      </Button>
      <Button
        type="submit"
        variant={getSubmitButtonVariant()}
        onClick={onSubmit}
        disabled={disabled || isSubmitting}
        className={getSubmitButtonClass()}
        data-testid={testId ? `${testId}-submit` : undefined}
      >
        {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {submitText}
      </Button>
    </div>
  );
};

export default FormActions;
