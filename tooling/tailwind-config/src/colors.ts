/**
 * Unified Color System
 * Single source of truth for all colors in the application
 * See: UNIFIED_DESIGN_SYSTEM.md for complete specifications
 */

// ============================================================================
// COLOR PALETTES (Full shade scales 50-900)
// ============================================================================

/**
 * Purple palette - Goal contexts (Golden Ratio Scale)
 * Primary: #6301A0 (700) at 38% lightness (1/phi anchor)
 * Key anchor: #BD66D8 (400) at 62% lightness (phi-1 anchor)
 */
export const purple = {
  50: '#FBF5FC',   // L=97% - Near white
  100: '#F6E8FA',  // L=94% - Very light
  200: '#EBCEF4',  // L=86% - Light
  300: '#D9A8E9',  // L=76% - Light-medium
  400: '#BD66D8',  // L=62% <- phi - 1 anchor
  500: '#9B2CB8',  // L=50% - Medium
  600: '#7B0199',  // L=38% <- 1/phi anchor
  700: '#6301A0',  // L=32% - Base primary
  800: '#4A0078',  // L=24% - Dark
  900: '#2E004A',  // L=15% - Very dark
  950: '#170026',  // L=8% - Near black
} as const

/**
 * Blue palette - Project contexts (Golden Ratio Scale)
 * Primary: #015FA0 (700) at 38% lightness (1/phi anchor)
 * Key anchor: #3EAEFE (400) at 62% lightness (phi-1 anchor)
 */
export const blue = {
  50: '#F0F9FF',   // L=97% - Near white
  100: '#E1F2FF',  // L=94% - Very light
  200: '#B8E1FF',  // L=86% - Light
  300: '#85CCFE',  // L=76% - Light-medium
  400: '#3EAEFE',  // L=62% <- Golden ratio anchor (phi-1)
  500: '#0194FE',  // L=50% - Medium
  600: '#0171C1',  // L=38% <- Golden ratio anchor (1/phi) - Primary
  700: '#015FA0',  // L=32% - Base primary
  800: '#01497D',  // L=24% - Dark
  900: '#002D4D',  // L=15% - Very dark
  950: '#001829',  // L=8% - Near black
} as const

/**
 * Orange palette - Progress start, energy
 * Base color: #955401 (700)
 */
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
} as const

/**
 * Yellow palette - Progress mid, momentum
 * Base color: #958001 (700)
 */
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
} as const

/**
 * Green palette - Progress end, success
 * Base color: #019201 (700)
 */
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
} as const

/**
 * Gray palette - Golden Ratio Neutral Scale
 *
 * Key anchor points based on golden ratio (phi = 1.618):
 * - gray-400: 62% lightness (phi-1 ~ 0.618)
 * - gray-600: 38% lightness (1/phi ~ 0.382)
 *
 * Uses subtle cool undertone (HSL hue 220, saturation 4%)
 * for modern, sophisticated appearance.
 */
export const gray = {
  50: '#F7F8F8',   // L=97%
  100: '#EEEFF0',  // L=94%
  200: '#D6D7DA',  // L=85%
  300: '#C0C1C5',  // L=76%
  400: '#9C9EA4',  // L=62% <- Golden ratio anchor (phi-1)
  500: '#7D7F85',  // L=50%
  600: '#5F6066',  // L=38% <- Golden ratio anchor (1/phi)
  700: '#434448',  // L=27%
  800: '#2A2B2D',  // L=17%
  900: '#161617',  // L=9%
} as const

/**
 * White and Black - Pure neutrals
 */
export const white = '#FFFFFF' as const
export const black = '#000000' as const

/**
 * Red palette - Errors, destructive actions
 */
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
} as const

// ============================================================================
// CORE COLORS (Semantic mappings)
// ============================================================================

export const COLORS = {
  // Brand Colors
  brand: {
    primary: black,          // Default buttons, primary actions
    secondary: gray[500],    // Secondary text, muted actions
  },

  // Context Colors (reference palette)
  goal: {
    primary: purple[700],
    light: purple[600],
    dark: purple[800],
    bg: purple[50],
    border: purple[200],
  },

  project: {
    primary: blue[700],
    light: blue[600],
    dark: blue[800],
    bg: blue[50],
    border: blue[200],
  },

  ai: {
    primary: yellow[700],
    gradient: `linear-gradient(135deg, ${yellow[600]} 0%, ${yellow[700]} 100%)`,
  },

  // Progress Colors (Orange -> Yellow -> Green)
  progress: {
    start: orange[700],      // 0-25%
    mid: yellow[700],        // 25-75%
    end: green[700],         // 75-100%
    complete: green[700],    // 100%
  },

  // Health Status Colors (Expanded 8-level system)
  health: {
    completed: green[700],
    aheadStrong: blue[400],
    ahead: blue[600],
    onTrack: green[400],
    onTrackSlipping: green[600],
    atRiskLight: yellow[400],
    atRisk: yellow[600],
    overdueLight: orange[600],
    overdue: red[400],
    notStarted: gray[400],
  },

  // Text Colors
  text: {
    primary: gray[900],
    secondary: gray[500],
    tertiary: gray[400],
    inverse: white,
  },

  // Background Colors
  bg: {
    primary: white,
    secondary: gray[50],
    tertiary: gray[200],
    dark: gray[900],
  },

  // Border Colors
  border: {
    default: gray[200],
    light: gray[100],
    dark: gray[300],
  },

  // Semantic Colors
  success: green[500],
  warning: yellow[500],
  error: red[500],
  info: blue[500],
} as const

// ============================================================================
// TAILWIND COLOR EXPORTS
// ============================================================================

/**
 * Full color palettes for Tailwind CSS configuration
 */
export const tailwindColors = {
  // Full palettes (50-900 shades)
  purple,
  blue,
  orange,
  yellow,
  green,
  gray,
  red,

  // Pure neutrals
  white,
  black,

  // GoalRate semantic colors
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
    black: black,
    'black-hover': gray[900],
    white: white,
    // Progress colors
    orange: orange[700],
    yellow: yellow[700],
    green: green[700],
  },

  text: {
    primary: COLORS.text.primary,
    secondary: COLORS.text.secondary,
    tertiary: COLORS.text.tertiary,
    inverse: COLORS.text.inverse,
  },

  bg: {
    primary: COLORS.bg.primary,
    secondary: COLORS.bg.secondary,
    tertiary: COLORS.bg.tertiary,
    dark: COLORS.bg.dark,
  },

  border: {
    DEFAULT: COLORS.border.default,
    light: COLORS.border.light,
    dark: COLORS.border.dark,
  },

  progress: {
    start: COLORS.progress.start,
    mid: COLORS.progress.mid,
    end: COLORS.progress.end,
  },

  // Button colors
  'button-default': black,

  // Functional/semantic colors
  success: COLORS.success,
  warning: COLORS.warning,
  error: COLORS.error,
  info: COLORS.info,
}

// ============================================================================
// CSS CUSTOM PROPERTIES EXPORT
// ============================================================================

/**
 * Generate CSS custom properties string for use in stylesheets
 * This ensures CSS variables stay in sync with TypeScript definitions
 */
export function generateCSSVariables(): string {
  return `
  /* Purple palette */
  --color-purple-50: ${purple[50]};
  --color-purple-100: ${purple[100]};
  --color-purple-200: ${purple[200]};
  --color-purple-300: ${purple[300]};
  --color-purple-400: ${purple[400]};
  --color-purple-500: ${purple[500]};
  --color-purple-600: ${purple[600]};
  --color-purple-700: ${purple[700]};
  --color-purple-800: ${purple[800]};
  --color-purple-900: ${purple[900]};
  --color-purple-950: ${purple[950]};
  --color-purple-primary: ${purple[700]};
  --color-purple-hover: ${purple[800]};
  --color-purple-light: ${purple[100]};
  --color-purple-border: ${purple[200]};

  /* Blue palette */
  --color-blue-50: ${blue[50]};
  --color-blue-100: ${blue[100]};
  --color-blue-200: ${blue[200]};
  --color-blue-300: ${blue[300]};
  --color-blue-400: ${blue[400]};
  --color-blue-500: ${blue[500]};
  --color-blue-600: ${blue[600]};
  --color-blue-700: ${blue[700]};
  --color-blue-800: ${blue[800]};
  --color-blue-900: ${blue[900]};
  --color-blue-950: ${blue[950]};
  --color-blue-primary: ${blue[700]};
  --color-blue-hover: ${blue[800]};
  --color-blue-light: ${blue[100]};
  --color-blue-border: ${blue[200]};

  /* Orange palette */
  --color-orange-50: ${orange[50]};
  --color-orange-100: ${orange[100]};
  --color-orange-200: ${orange[200]};
  --color-orange-300: ${orange[300]};
  --color-orange-400: ${orange[400]};
  --color-orange-500: ${orange[500]};
  --color-orange-600: ${orange[600]};
  --color-orange-700: ${orange[700]};
  --color-orange-800: ${orange[800]};
  --color-orange-900: ${orange[900]};
  --color-orange-950: ${orange[950]};

  /* Yellow palette */
  --color-yellow-50: ${yellow[50]};
  --color-yellow-100: ${yellow[100]};
  --color-yellow-200: ${yellow[200]};
  --color-yellow-300: ${yellow[300]};
  --color-yellow-400: ${yellow[400]};
  --color-yellow-500: ${yellow[500]};
  --color-yellow-600: ${yellow[600]};
  --color-yellow-700: ${yellow[700]};
  --color-yellow-800: ${yellow[800]};
  --color-yellow-900: ${yellow[900]};
  --color-yellow-950: ${yellow[950]};

  /* Green palette */
  --color-green-50: ${green[50]};
  --color-green-100: ${green[100]};
  --color-green-200: ${green[200]};
  --color-green-300: ${green[300]};
  --color-green-400: ${green[400]};
  --color-green-500: ${green[500]};
  --color-green-600: ${green[600]};
  --color-green-700: ${green[700]};
  --color-green-800: ${green[800]};
  --color-green-900: ${green[900]};
  --color-green-950: ${green[950]};

  /* Gray palette - Golden Ratio Scale
   * Key anchors: 400 at 62% (phi-1), 600 at 38% (1/phi) */
  --color-gray-50: ${gray[50]};
  --color-gray-100: ${gray[100]};
  --color-gray-200: ${gray[200]};
  --color-gray-300: ${gray[300]};
  --color-gray-400: ${gray[400]};
  --color-gray-500: ${gray[500]};
  --color-gray-600: ${gray[600]};
  --color-gray-700: ${gray[700]};
  --color-gray-800: ${gray[800]};
  --color-gray-900: ${gray[900]};

  /* Pure neutrals */
  --white: ${white};
  --black: ${black};

  /* Red palette */
  --color-red-50: ${red[50]};
  --color-red-100: ${red[100]};
  --color-red-200: ${red[200]};
  --color-red-300: ${red[300]};
  --color-red-400: ${red[400]};
  --color-red-500: ${red[500]};
  --color-red-600: ${red[600]};
  --color-red-700: ${red[700]};
  --color-red-800: ${red[800]};
  --color-red-900: ${red[900]};
  --color-red-950: ${red[950]};

  /* Semantic colors */
  --color-success: ${COLORS.success};
  --color-warning: ${COLORS.warning};
  --color-error: ${COLORS.error};
  --color-info: ${COLORS.info};

  /* Progress colors */
  --progress-low: ${COLORS.progress.start};
  --progress-medium: ${COLORS.progress.mid};
  --progress-high: ${COLORS.progress.end};

  /* Logo colors */
  --logo-purple: ${purple[700]};
  --logo-blue: ${blue[700]};
  --logo-orange: ${orange[700]};
  --logo-yellow: ${yellow[700]};
  --logo-green: ${green[700]};
  `.trim()
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get health status color
 */
export function getHealthStatusColor(status: keyof typeof COLORS.health): string {
  return COLORS.health[status] || COLORS.health.notStarted
}

/**
 * Get progress color based on percentage
 */
export function getProgressColorByPercent(percent: number): string {
  if (percent >= 100) {
    return COLORS.progress.complete
  }
  if (percent >= 66) {
    return COLORS.progress.end
  }
  if (percent >= 33) {
    return COLORS.progress.mid
  }
  return COLORS.progress.start
}

/**
 * Get context color (goal or project)
 */
export function getContextColor(context: 'goal' | 'project'): string {
  return context === 'goal' ? COLORS.goal.primary : COLORS.project.primary
}

/**
 * Get a shade from a palette
 */
export function getShade(
  palette: 'purple' | 'blue' | 'orange' | 'yellow' | 'green' | 'gray' | 'red',
  shade: 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
): string {
  const palettes = { purple, blue, orange, yellow, green, gray, red }
  return palettes[palette][shade]
}
