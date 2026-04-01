import type { Config } from 'tailwindcss'
import { tailwindColors } from './colors'
import animate from 'tailwindcss-animate'

/**
 * GoalRate Tailwind CSS Preset
 * Provides consistent design tokens across all packages
 */
export const goalratePreset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        lg: '10px',      // Standard card radius
        md: '6px',
        sm: '4px',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Full color palettes (50-900 shades)
        purple: tailwindColors.purple,
        blue: tailwindColors.blue,
        orange: tailwindColors.orange,
        yellow: tailwindColors.yellow,
        green: tailwindColors.green,
        gray: tailwindColors.gray,
        red: tailwindColors.red,

        // GoalRate branded colors
        goalrate: tailwindColors.goalrate,

        // Progress colors
        progress: tailwindColors.progress,

        // Text Colors
        text: tailwindColors.text,

        // Background Colors
        bg: tailwindColors.bg,

        // Border Colors
        border: tailwindColors.border,

        // Shadcn UI theme colors for dark mode support
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        divider: 'hsl(var(--divider))',
        ring: 'hsl(var(--ring))',

        // Default Button Color
        'button-default': tailwindColors['button-default'],

        // Functional Colors
        success: tailwindColors.success,
        warning: tailwindColors.warning,
        error: tailwindColors.error,
        info: tailwindColors.info,
      },

      // Typography Scale - Plus Jakarta Sans Font
      fontSize: {
        h1: ['68px', { lineHeight: '74px', fontWeight: '700' }],
        h2: ['42px', { lineHeight: '50px', fontWeight: '600' }],
        h3: ['26px', { lineHeight: '34px', fontWeight: '600' }],
        h4: ['16px', { lineHeight: '24px', fontWeight: '700' }],
        body: ['16px', { lineHeight: '26px', fontWeight: '400' }],
        small: ['13px', { lineHeight: '21px', fontWeight: '500' }],
        caption: ['10px', { lineHeight: '16px', fontWeight: '500' }],
      },

      // Spacing - 4px Grid System
      spacing: {
        'grid-1': '1px',
        'grid-2': '2px',
        'grid-3': '3px',
        'grid-4': '4px',
        'grid-5': '5px',
        'grid-6': '6px',
        'grid-8': '8px',
      },

      // Box Shadows
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px 0 rgb(0 0 0 / 0.06)',
        hover: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -1px rgb(0 0 0 / 0.06)',
      },

      // Animation keyframes
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-down': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },

      // Animation utilities
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-down': 'fade-down 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        // Staggered delays for orchestrated reveals
        'fade-up-1': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both',
        'fade-up-2': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both',
        'fade-up-3': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.3s both',
        'fade-up-4': 'fade-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both',
      },
    },
  },
  plugins: [animate],
}

// Re-export colors for direct access
export * from './colors'

export default goalratePreset
