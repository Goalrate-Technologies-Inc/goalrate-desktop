# @goalrate-app/typescript-config

Shared TypeScript configurations for the GoalRate monorepo.

## Available Configs

| Config | Purpose | Used By |
|--------|---------|---------|
| `base.json` | Shared compiler options all configs extend | (internal) |
| `library.json` | Library packages with declaration files | packages/shared, packages/core |
| `react-library.json` | React library packages with JSX | packages/ui, packages/storage |
| `react-app.json` | React apps (noEmit, bundler handles build) | apps/web, apps/desktop |
| `node.json` | Node.js/Vite configs (ES2022 target) | vite.config.ts, tsup.config.ts |

## Usage

### Library Package (no JSX)

```json
{
  "extends": "@goalrate-app/typescript-config/library.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### React Library Package

```json
{
  "extends": "@goalrate-app/typescript-config/react-library.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### React App

```json
{
  "extends": "@goalrate-app/typescript-config/react-app.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

### Vite/Node Config

```json
{
  "extends": "@goalrate-app/typescript-config/node.json",
  "include": ["vite.config.ts"]
}
```

## Key Settings

All configs share these base settings:
- **Target**: ES2020 (ES2022 for node.json)
- **Module**: ESNext with bundler resolution
- **Strict**: All strict checks enabled
- **Interop**: esModuleInterop, isolatedModules, resolveJsonModule
