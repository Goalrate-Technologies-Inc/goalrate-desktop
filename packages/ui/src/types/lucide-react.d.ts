declare module 'lucide-react' {
  import * as React from 'react';

  export type LucideProps = React.SVGProps<SVGSVGElement> & {
    size?: number | string;
    color?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  };

  export type LucideIcon = React.FC<LucideProps>;

  export const ArrowLeft: LucideIcon;
  export const BarChart3: LucideIcon;
  export const Calendar: LucideIcon;
  export const CalendarDays: LucideIcon;
  export const Check: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const ChevronUp: LucideIcon;
  export const Circle: LucideIcon;
  export const ClipboardList: LucideIcon;
  export const Clock: LucideIcon;
  export const FastForward: LucideIcon;
  export const Flame: LucideIcon;
  export const Frown: LucideIcon;
  export const GripVertical: LucideIcon;
  export const Layers: LucideIcon;
  export const Loader2: LucideIcon;
  export const Meh: LucideIcon;
  export const Minus: LucideIcon;
  export const MoreHorizontal: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Smile: LucideIcon;
  export const Star: LucideIcon;
  export const Target: LucideIcon;
  export const Trophy: LucideIcon;
  export const TrendingDown: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const X: LucideIcon;

  const iconExports: Record<string, LucideIcon>;
  export default iconExports;
}
