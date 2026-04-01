/**
 * Goalrate Design System - Color Palette
 * Single source of truth for all colors in the application
 *
 * Color values follow the Golden Ratio Scale where:
 * - 400 = 62% lightness (φ-1 anchor)
 * - 600 = 38% lightness (1/φ anchor)
 */

// Purple palette - Goal contexts
export const purple = {
  50: '#FBF5FC',
  100: '#F6E8FA',
  200: '#EBCEF4',
  300: '#D9A8E9',
  400: '#BD66D8', // φ-1 anchor
  500: '#9B2CB8',
  600: '#7B0199', // 1/φ anchor
  700: '#6301A0', // Primary
  800: '#4A0078',
  900: '#2E004A',
  950: '#170026',
} as const;

// Blue palette - Project contexts
export const blue = {
  50: '#F0F9FF',
  100: '#E1F2FF',
  200: '#B8E1FF',
  300: '#85CCFE',
  400: '#3EAEFE', // φ-1 anchor
  500: '#0194FE',
  600: '#0171C1', // 1/φ anchor
  700: '#015FA0', // Primary
  800: '#01497D',
  900: '#002D4D',
  950: '#001829',
} as const;

// Orange palette - Progress start, energy
export const orange = {
  50: '#FFF8F0',
  100: '#FFF2E1',
  200: '#FFE0B8',
  300: '#FECA85',
  400: '#FEAB3E',
  500: '#FE9001',
  600: '#C16E01',
  700: '#955401', // Primary
  800: '#704000',
  900: '#472800',
  950: '#241400',
} as const;

// Yellow palette - Progress mid, momentum
export const yellow = {
  50: '#FFFDF0',
  100: '#FFFBE1',
  200: '#FFF5B8',
  300: '#FEEE85',
  400: '#FEE43E',
  500: '#FEDC01',
  600: '#C1A701',
  700: '#958001', // Primary
  800: '#706100',
  900: '#473E00',
  950: '#241F00',
} as const;

// Green palette - Progress end, success
export const green = {
  50: '#F0FFF0',
  100: '#E1FFE1',
  200: '#B3FFB3',
  300: '#85FE85',
  400: '#3EFE3E',
  500: '#01FE01',
  600: '#01C101',
  700: '#019201', // Primary
  800: '#005B00',
  900: '#003800',
  950: '#001900',
} as const;

// Gray palette - Golden Ratio Neutral Scale
export const gray = {
  50: '#F7F8F8', // L=97%
  100: '#EEEFF0', // L=94%
  200: '#D6D7DA', // L=85%
  300: '#C0C1C5', // L=76%
  400: '#9C9EA4', // L=62% ← φ-1 anchor
  500: '#7D7F85', // L=50%
  600: '#5F6066', // L=38% ← 1/φ anchor
  700: '#434448', // L=27%
  800: '#2A2B2D', // L=17%
  900: '#161617', // L=9%
} as const;

// Red palette - Errors, destructive actions
export const red = {
  50: '#FFF0F0',
  100: '#FFE1E1',
  200: '#FFB3B3',
  300: '#FE8585',
  400: '#FE3E3E',
  500: '#FE0101',
  600: '#C10101',
  700: '#920101',
  800: '#5B0000',
  900: '#380000',
  950: '#190000',
} as const;

// Pure neutrals
export const white = '#FFFFFF' as const;
// Match app header bar background in dark mode.
export const black = '#030711' as const;

// Semantic color mappings
export const COLORS = {
  brand: {
    primary: black,
    secondary: gray[500],
  },
  goal: {
    primary: purple[700],
    light: purple[100],
    dark: purple[800],
    hover: purple[800],
    border: purple[200],
  },
  project: {
    primary: blue[700],
    light: blue[100],
    dark: blue[800],
    hover: blue[800],
    border: blue[200],
  },
  progress: {
    start: orange[700],
    mid: yellow[700],
    end: green[700],
    complete: green[700],
  },
  text: {
    primary: gray[900],
    secondary: gray[500],
    tertiary: gray[400],
    inverse: white,
  },
  bg: {
    primary: white,
    secondary: gray[50],
    tertiary: gray[200],
    dark: gray[900],
  },
  border: {
    default: gray[200],
    light: gray[100],
    dark: gray[300],
  },
  success: green[500],
  warning: yellow[500],
  error: red[500],
  info: blue[500],
} as const;

// Tailwind color exports for extending tailwind.config.js
export const tailwindColors = {
  purple,
  blue,
  orange,
  yellow,
  green,
  gray,
  red,
  white,
  black,
  goalrate: {
    purple: purple[700],
    'purple-light': purple[100],
    'purple-dark': purple[800],
    'purple-hover': purple[800],
    'purple-border': purple[200],
    blue: blue[700],
    'blue-light': blue[100],
    'blue-dark': blue[800],
    'blue-hover': blue[800],
    'blue-border': blue[200],
    orange: orange[700],
    yellow: yellow[700],
    green: green[700],
    black: black,
    white: white,
  },
};

// Utility functions
export function getContextColor(context: 'goal' | 'project'): string {
  return context === 'goal' ? COLORS.goal.primary : COLORS.project.primary;
}

export function getProgressColor(percent: number): string {
  if (percent >= 100) {return COLORS.progress.complete;}
  if (percent >= 66) {return COLORS.progress.end;}
  if (percent >= 33) {return COLORS.progress.mid;}
  return COLORS.progress.start;
}
