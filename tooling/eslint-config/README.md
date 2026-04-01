# @goalrate-app/eslint-config

Shared ESLint configurations for the GoalRate monorepo. Uses ESLint 9+ flat config format.

## Available Configs

| Config | Purpose | Used By |
|--------|---------|---------|
| `index.js` (default) | Base TypeScript config | (internal base) |
| `library.js` | Non-React library packages | packages/shared, packages/core |
| `react.js` | React apps and libraries | packages/ui, packages/storage, apps/web |

## Usage

### Library Package (no React)

```javascript
// eslint.config.js
import { libraryConfig } from '@goalrate-app/eslint-config/library'

export default libraryConfig
```

### React App or Library

React plugins must be installed and passed to the config factory:

```javascript
// eslint.config.js
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { createReactConfig } from '@goalrate-app/eslint-config/react'

export default createReactConfig({
  reactHooks,
  reactRefresh,
  jsxA11y,
})
```

For UI libraries (no react-refresh needed):

```javascript
// eslint.config.js
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { createReactConfig } from '@goalrate-app/eslint-config/react'

export default createReactConfig({ jsxA11y })
```

## Rules Included

### Code Quality
- `no-console`: warn (allow: warn, error)
- `@typescript-eslint/no-explicit-any`: error
- `@typescript-eslint/explicit-function-return-type`: warn
- `@typescript-eslint/no-unused-vars`: error (ignores `_` prefixed)
- `prefer-const`, `no-var`, `no-debugger`: error
- `eqeqeq`, `curly`, `no-throw-literal`: error

### React (when plugins provided)
- `react-hooks/rules-of-hooks`: error
- `react-hooks/exhaustive-deps`: warn
- `react-refresh/only-export-components`: warn

### Accessibility (when jsx-a11y provided)
- `jsx-a11y/alt-text`: error
- `jsx-a11y/aria-props`: error
- `jsx-a11y/aria-proptypes`: error
- Full recommended ruleset

### Test File Overrides
Test files (`*.test.ts`, `*.spec.ts`, `__tests__/*`) have relaxed rules:
- `no-console`: off
- `explicit-function-return-type`: off
- `no-explicit-any`: off

## Peer Dependencies

Required for all configs:
- `eslint` ^9.0.0

Optional for React configs:
- `eslint-plugin-react-hooks` ^5.0.0
- `eslint-plugin-react-refresh` ^0.4.14
- `eslint-plugin-jsx-a11y` ^6.8.0
