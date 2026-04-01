import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/auth/index.ts',
    'src/vaults/index.ts',
    'src/goals/index.ts',
    'src/projects/index.ts',
    'src/epics/index.ts',
    'src/sprints/index.ts',
    'src/focus/index.ts',
    'src/social/index.ts',
    'src/subscriptions/index.ts',
    'src/users/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['@goalrate-app/shared'],
});
