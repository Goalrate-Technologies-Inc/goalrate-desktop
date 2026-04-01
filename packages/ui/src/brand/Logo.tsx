import * as React from 'react';
import { cn } from '../utils';

interface LogoProps {
  /** Size in pixels (applies to both width and height of icon) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to show the text alongside the icon */
  showText?: boolean;
  /** Text color mode */
  textColor?: 'auto' | 'light' | 'dark';
}

/**
 * Goalrate logo with optional text.
 *
 * @example
 * ```tsx
 * // Icon only
 * <Logo size={32} />
 *
 * // With text
 * <Logo size={24} showText />
 *
 * // Full logo for sidebar header
 * <Logo size={24} showText className="h-6" />
 * ```
 */
export function Logo({
  size = 32,
  className = '',
  showText = false,
  textColor = 'auto',
}: LogoProps): React.ReactElement {
  const getTextColorClass = (): string => {
    switch (textColor) {
      case 'light':
        return 'text-white';
      case 'dark':
        return 'text-foreground';
      case 'auto':
      default:
        return 'text-foreground';
    }
  };

  const uniqueId = React.useId();
  const maskId = `logo-mask-${uniqueId}`;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0"
        aria-hidden={showText ? 'true' : undefined}
        role={showText ? undefined : 'img'}
        aria-label={showText ? undefined : 'GOALRATE'}
      >
        <defs>
          <mask id={maskId}>
            <rect width="64" height="64" fill="white"/>
            <line x1="32" y1="32" x2="56" y2="8" stroke="black" strokeWidth="8" strokeLinecap="round"/>
            <polyline points="47,8 56,8 56,17" stroke="black" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </mask>
        </defs>
        <circle cx="32" cy="32" r="22" stroke="#7B1FD4" strokeWidth="3.5" fill="none" mask={`url(#${maskId})`}/>
        <line x1="32" y1="32" x2="56" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        <polyline points="47,8 56,8 56,17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>
      {showText && (
        <span className={cn('text-lg leading-none', getTextColorClass())}>
          <span className="font-bold uppercase">GOAL</span>
          <span className="font-normal uppercase">RATE</span>
        </span>
      )}
    </div>
  );
}

/**
 * Goalrate icon only (no text option).
 * Use this for smaller contexts like favicons or compact headers.
 */
export function LogoIcon({
  size = 24,
  className = '',
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  return <Logo size={size} className={className} showText={false} />;
}

/**
 * Monochrome Goalrate mark that inherits currentColor.
 */
export function LogoMark({
  size = 20,
  className = '',
}: {
  size?: number;
  className?: string;
}): React.ReactElement {
  const uniqueId = React.useId();
  const maskId = `logo-mark-mask-${uniqueId}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-shrink-0', className)}
      role="img"
      aria-label="GoalRate"
    >
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="white"/>
          <line x1="32" y1="32" x2="56" y2="8" stroke="black" strokeWidth="8" strokeLinecap="round"/>
          <polyline points="47,8 56,8 56,17" stroke="black" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </mask>
      </defs>
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="3.5" fill="none" mask={`url(#${maskId})`}/>
      <line x1="32" y1="32" x2="56" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <polyline points="47,8 56,8 56,17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
