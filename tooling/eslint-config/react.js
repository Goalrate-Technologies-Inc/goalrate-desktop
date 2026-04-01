import globals from 'globals'
import tseslint from 'typescript-eslint'
import { baseConfig } from './index.js'

/**
 * React-specific ESLint configuration
 * Requires peer dependencies: eslint-plugin-react-hooks, eslint-plugin-react-refresh, eslint-plugin-jsx-a11y
 * @param {Object} plugins - Plugin instances (reactHooks, reactRefresh, jsxA11y)
 * @returns {import('typescript-eslint').Config}
 */
export function createReactConfig(plugins = {}) {
  const { reactHooks, reactRefresh, jsxA11y } = plugins

  return tseslint.config(
    ...baseConfig,
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        globals: globals.browser,
        parserOptions: {
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        ...(reactHooks && { 'react-hooks': reactHooks }),
        ...(reactRefresh && { 'react-refresh': reactRefresh }),
        ...(jsxA11y && { 'jsx-a11y': jsxA11y }),
      },
      rules: {
        ...(reactHooks && reactHooks.configs?.recommended?.rules),
        ...(jsxA11y && jsxA11y.configs?.recommended?.rules),
        ...(reactRefresh && {
          'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
        }),
        // Accessibility rules
        ...(jsxA11y && {
          'jsx-a11y/alt-text': 'error',
          'jsx-a11y/aria-props': 'error',
          'jsx-a11y/aria-proptypes': 'error',
          'jsx-a11y/aria-unsupported-elements': 'error',
          'jsx-a11y/role-has-required-aria-props': 'error',
          'jsx-a11y/role-supports-aria-props': 'error',
        }),
      },
    },
    // Override for test files in React projects
    {
      files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', '**/test/**/*.{ts,tsx}'],
      rules: {
        ...(reactRefresh && { 'react-refresh/only-export-components': 'off' }),
      },
    }
  )
}

export default createReactConfig
