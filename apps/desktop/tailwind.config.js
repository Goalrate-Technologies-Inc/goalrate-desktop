/**
 * Tailwind CSS Configuration for Desktop App
 * Uses @goalrate-app/tailwind-config preset for consistent design system.
 */
import { goalratePreset } from '@goalrate-app/tailwind-config'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [goalratePreset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
    // Include UI package for component styling
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
}
