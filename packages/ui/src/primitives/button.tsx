import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../utils/cn';

// Note: Using text-[#FFFFFF] instead of text-white because text-white gets inverted in dark mode via CSS variables
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-base font-medium transition-all duration-200 ease-out focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Context-Aware Primary Variants - Logo-Based Colors
        goals:
          'bg-goalrate-purple text-[#FFFFFF] shadow-sm hover:bg-goalrate-purple-hover hover:transform hover:translate-y-[-1px] hover:shadow-lg focus-visible:ring-2 focus-visible:ring-goalrate-purple focus-visible:ring-offset-2 active:transform active:translate-y-0 active:shadow-sm transition-all duration-200',
        projects:
          'bg-goalrate-blue text-[#FFFFFF] shadow-sm hover:bg-goalrate-blue-hover hover:transform hover:translate-y-[-1px] hover:shadow-lg focus-visible:ring-2 focus-visible:ring-goalrate-blue focus-visible:ring-offset-2 active:transform active:translate-y-0 active:shadow-sm transition-all duration-200',

        // Authentication context - Bold primary action
        auth: 'bg-zinc-900 text-[#FFFFFF] shadow-lg hover:bg-zinc-800 hover:transform hover:scale-[1.02] hover:shadow-xl focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 transition-all duration-200',

        // Universal Variants - Black as Default per Unified Design System
        default:
          'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:transform hover:translate-y-[-1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-all duration-200',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:transform hover:translate-y-[-1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2 transition-all duration-200',
        outline:
          'border-2 border-border bg-background text-foreground hover:bg-muted hover:border-muted-foreground/50 hover:transform hover:translate-y-[-1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-all duration-200',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:transform hover:translate-y-[-1px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-all duration-200',
        ghost:
          'text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors duration-200',
        link: 'text-muted-foreground underline-offset-4 hover:underline hover:opacity-80 font-normal focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors duration-200',
        success:
          'bg-goalrate-green text-[#FFFFFF] shadow-sm hover:opacity-90 hover:transform hover:translate-y-[-1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-goalrate-green focus-visible:ring-offset-2 transition-all duration-200',
        warning:
          'bg-goalrate-orange text-[#FFFFFF] shadow-sm hover:bg-orange hover:transform hover:translate-y-[-1px] hover:shadow-md focus-visible:ring-2 focus-visible:ring-goalrate-orange focus-visible:ring-offset-2 transition-all duration-200',
      },
      size: {
        default: 'h-11 px-4 py-2 min-w-[44px] text-base',
        sm: 'h-8 px-3 py-1.5 text-sm min-w-8',
        lg: 'h-12 px-6 py-3 text-lg min-w-12',
        xl: 'h-14 px-8 py-4 text-lg min-w-14 font-semibold',
        icon: 'h-11 w-11 p-0 min-w-[44px]',
        'icon-sm': 'h-8 w-8 p-0 min-w-8',
        'icon-lg': 'h-12 w-12 p-0 min-w-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
