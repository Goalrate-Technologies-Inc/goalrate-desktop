/**
 * Goalrate Design System - Spacing System
 * Based on 4px grid system
 */

// Base spacing values (in pixels)
export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
} as const;

// Component spacing presets
export const COMPONENT_SPACING = {
  card: {
    padding: 'p-6',
    gap: 'space-y-1.5',
  },
  button: {
    padding: 'px-4 py-2',
    gap: 'gap-2',
  },
  form: {
    gap: 'space-y-4',
    fieldGap: 'space-y-2',
  },
  section: {
    gap: 'space-y-6',
    padding: 'p-6',
  },
  list: {
    gap: 'space-y-2',
    itemPadding: 'p-3',
  },
  modal: {
    padding: 'p-6',
    gap: 'space-y-4',
  },
  inline: {
    gap: 'gap-2',
    tightGap: 'gap-1',
    wideGap: 'gap-4',
  },
} as const;

// Typography scale
export const typography = {
  display: '48px',
  h1: '36px',
  h2: '30px',
  h3: '24px',
  h4: '20px',
  large: '18px',
  base: '16px',
  small: '14px',
  caption: '12px',
} as const;

// Border radius
export const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export type SpacingKey = keyof typeof spacing;
export type ComponentSpacingKey = keyof typeof COMPONENT_SPACING;
