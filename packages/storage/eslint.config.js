import jsxA11y from 'eslint-plugin-jsx-a11y'
import { createReactConfig } from '@goalrate-app/eslint-config/react'

// Storage is a React library, but doesn't need react-refresh
export default createReactConfig({ jsxA11y })
