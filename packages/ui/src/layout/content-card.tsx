import * as React from 'react';
import { Card, CardContent, CardHeader } from '../primitives/card';
import { Progress } from '../feedback/progress';
import { Badge } from '../feedback/badge';
import { Button } from '../primitives/button';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../utils/cn';

export interface ContentCardProps {
  title: string | React.ReactNode;
  description?: string;
  progress?: number;
  badges?: {
    text: string;
    variant?: 'default' | 'secondary' | 'destructive' | 'outline';
    className?: string;
  }[];
  additionalBadges?: React.ReactNode;
  metadata?: { label: string; value: string | React.ReactNode }[];
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  showMenu?: boolean;
  onMenuClick?: (e: React.MouseEvent) => void;
  borderLeftColor?: string;
  'data-testid'?: string;
}

export const ContentCard: React.FC<ContentCardProps> = ({
  title,
  description,
  progress,
  badges = [],
  additionalBadges,
  metadata = [],
  actions,
  children,
  className = '',
  onClick,
  showMenu = false,
  onMenuClick,
  borderLeftColor,
  'data-testid': testId,
}) => {
  const cardStyle = borderLeftColor
    ? { borderLeftColor, borderLeftWidth: '4px' }
    : undefined;

  return (
    <Card
      className={cn(onClick && 'cursor-pointer', className)}
      onClick={onClick}
      style={cardStyle}
      data-testid={testId}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            {typeof title === 'string' ? (
              <>
                <div className="text-lg font-semibold leading-tight truncate">
                  {title}
                </div>
                {description && (
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {description}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="text-lg font-semibold leading-tight">
                  {title}
                </div>
                {description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </>
            )}
            {(badges.length > 0 || additionalBadges) && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {badges.map((badge, index) => (
                  <Badge
                    key={index}
                    variant={badge.variant || 'outline'}
                    className={cn('text-xs', badge.className)}
                  >
                    {badge.text}
                  </Badge>
                ))}
                {additionalBadges}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 ml-4">
            {actions}
            {showMenu && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onMenuClick}
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {progress !== undefined && (
          <div>
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}

        {metadata.length > 0 && (
          <div className="space-y-3">
            {metadata.map((item, index) => (
              <div key={index} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground tracking-wide">
                  {item.label}
                </div>
                <div className="text-sm font-medium text-foreground">
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {children}
      </CardContent>
    </Card>
  );
};

export default ContentCard;
