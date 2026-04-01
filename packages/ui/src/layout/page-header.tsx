import * as React from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '../utils/cn';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon: Icon,
  iconColor = 'text-primary',
  actions,
  children,
  className = '',
}) => {
  return (
    <header className={cn('space-y-2 mt-8 ml-4', className)} role="banner">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center text-foreground">
              {Icon && <Icon className={cn('h-8 w-8 mr-3', iconColor)} />}
              {title}
            </h1>
            {subtitle && (
              <p className="text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
};

export default PageHeader;
