# @goalrate-app/tailwind-config

Shared Tailwind CSS configuration preset for the GoalRate monorepo.

## Installation

The package is automatically linked via pnpm workspace.

## Usage

### As a Preset (Recommended)

```javascript
// tailwind.config.js
import { goalratePreset } from '@goalrate-app/tailwind-config'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [goalratePreset],
  content: ['./src/**/*.{ts,tsx}'],
  // Optional: extend or override preset settings
  theme: {
    extend: {
      // Your custom additions
    },
  },
}
```

### Importing Colors Directly

```typescript
// For TypeScript usage (not Tailwind config)
import {
  purple,
  blue,
  COLORS,
  getProgressColorByPercent,
  getHealthStatusColor,
} from '@goalrate-app/tailwind-config/colors'

// Use in component logic
const progressColor = getProgressColorByPercent(75)
const goalColor = COLORS.goal.primary
```

## What's Included

### Color Palettes (50-950 shades)
- **purple** - Goal contexts
- **blue** - Project contexts
- **orange** - Progress start
- **yellow** - Progress mid
- **green** - Progress end / success
- **gray** - Neutral scale (Golden Ratio)
- **red** - Errors, destructive

### Semantic Colors
- `goalrate.*` - Brand colors
- `progress.*` - Progress indicators
- `text.*` - Text colors (primary, secondary, tertiary, inverse)
- `bg.*` - Background colors
- `border.*` - Border colors
- `success`, `warning`, `error`, `info` - Functional colors

### Typography
- `text-h1` through `text-h4` - Heading styles
- `text-body`, `text-small`, `text-caption` - Body styles
- Plus Jakarta Sans font family

### Spacing
- `grid-1` through `grid-8` - 4px grid system

### Shadows
- `shadow-card` - Default card shadow
- `shadow-hover` - Hover state shadow

### Animations
- `animate-accordion-down/up` - Radix accordion
- `animate-fade-in`, `animate-fade-up`, `animate-fade-down`
- `animate-scale-in`, `animate-slide-in-right`
- `animate-fade-up-1` through `animate-fade-up-4` - Staggered reveals

### shadcn/ui Support
Built-in support for shadcn/ui theme colors via CSS variables:
- `background`, `foreground`
- `card`, `popover`, `primary`, `secondary`
- `muted`, `accent`, `destructive`, `ring`

## Utility Functions

```typescript
import {
  getHealthStatusColor,
  getProgressColorByPercent,
  getContextColor,
  getShade,
  generateCSSVariables,
} from '@goalrate-app/tailwind-config/colors'

// Get health status color
getHealthStatusColor('onTrack')  // '#3EFE3E'

// Get progress color by percentage
getProgressColorByPercent(75)    // '#019201' (green)

// Get context color
getContextColor('goal')          // '#6301A0' (purple)
getContextColor('project')       // '#015FA0' (blue)

// Get specific shade
getShade('purple', 500)          // '#9B2CB8'

// Generate CSS variables string for stylesheets
const cssVars = generateCSSVariables()
```

## Building

```bash
cd tooling/tailwind-config
pnpm build
```

This generates CJS and ESM outputs in `dist/` with TypeScript declarations.
