import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Toast notification component using Sonner.
 * Place this component at the root of your app to enable toast notifications.
 *
 * Usage:
 * ```tsx
 * import { toast } from 'sonner';
 *
 * // Show a success toast
 * toast.success('Changes saved!');
 *
 * // Show an error toast
 * toast.error('Something went wrong');
 *
 * // Show a custom toast
 * toast('Hello world!');
 * ```
 */
const Toaster = ({ ...props }: ToasterProps): React.ReactElement => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton:
            'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton:
            'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

// Re-export toast function from sonner for convenience
export { toast } from 'sonner';
export { Toaster };
