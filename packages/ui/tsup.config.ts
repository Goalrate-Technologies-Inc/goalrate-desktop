import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/primitives/index.ts',
    'src/overlay/index.ts',
    'src/feedback/index.ts',
    'src/data-display/index.ts',
    'src/navigation/index.ts',
    'src/forms/index.ts',
    'src/layout/index.ts',
    'src/kanban/index.ts',
    'src/focus/index.ts',
    'src/styles/index.ts',
    'src/utils/index.ts',
    'src/presence/index.ts',
    'src/sync/index.ts',
    'src/brand/index.ts',
    'src/theme/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  external: ['react', 'react-dom', '@goalrate-app/shared'],
});
