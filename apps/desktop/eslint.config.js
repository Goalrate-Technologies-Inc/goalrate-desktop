import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { createReactConfig } from '@goalrate-app/eslint-config/react'

export default createReactConfig({
  reactHooks,
  reactRefresh,
  jsxA11y,
})
