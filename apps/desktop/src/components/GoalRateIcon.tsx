import { useId } from 'react';

interface GoalRateIconProps {
  className?: string;
}

export function GoalRateIcon({ className }: GoalRateIconProps): React.ReactElement {
  const maskId = useId();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" className={className} style={{ color: 'var(--text-primary)' }}>
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="white"/>
          <line x1="32" y1="32" x2="56" y2="8" stroke="black" strokeWidth="8" strokeLinecap="round"/>
          <polyline points="47,8 56,8 56,17" stroke="black" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </mask>
      </defs>
      {/* Full circle with mask to create gap around arrow */}
      <circle cx="32" cy="32" r="22" stroke="#7B1FD4" strokeWidth="3.5" fill="none" mask={`url(#${maskId})`}/>
      {/* Ascending arrow */}
      <line x1="32" y1="32" x2="56" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <polyline points="47,8 56,8 56,17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    </svg>
  );
}
