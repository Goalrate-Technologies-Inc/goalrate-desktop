import * as React from 'react';
import { cn } from '../utils';

export interface CompletionRingProps {
  size?: number;
  className?: string;
  animate?: boolean;
}

const RING_STROKE = '#015FA0';

export function CompletionRing({
  size = 18,
  className,
  animate = false,
}: CompletionRingProps): React.ReactElement {
  const uniqueId = React.useId();
  const gradientId = `completion-gradient-${uniqueId}`;
  const animationId = `completion-ring-fill-${uniqueId}`;
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const ringStyle: React.CSSProperties = {
    transformOrigin: '50% 50%',
    transformBox: 'fill-box',
    transform: 'rotate(-90deg) scaleX(-1)',
    strokeDasharray: circumference,
    strokeDashoffset: animate ? circumference : 0,
    animation: animate ? `${animationId} 700ms ease-out forwards` : undefined,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('flex-shrink-0', className)}
      role="img"
      aria-label="Completion"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6301A0" />
          <stop offset="33%" stopColor="#955401" />
          <stop offset="66%" stopColor="#958001" />
          <stop offset="100%" stopColor="#019201" />
        </linearGradient>
      </defs>
      {animate ? (
        <style>{`@keyframes ${animationId} { from { stroke-dashoffset: ${circumference}; } to { stroke-dashoffset: 0; } }`}</style>
      ) : null}
      <circle
        cx="32"
        cy="32"
        r={radius}
        stroke={RING_STROKE}
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
        style={ringStyle}
      />
      <polyline
        points="27.5,41.3 38.9,28.3 47,39.7 61.5,23.5"
        stroke={`url(#${gradientId})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <polyline
        points="50.13,23.5 61.5,23.5 61.5,34.88"
        stroke={`url(#${gradientId})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="miter"
        fill="none"
      />
    </svg>
  );
}
