import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/interface.ts',
    'src/errors.ts',
    'src/adapters/desktop/index.ts',
    'src/adapters/web/index.ts',
    'src/adapters/native/index.ts',
    'src/adapters/memory/index.ts',
    'src/adapters/team/index.ts',
    'src/react/index.ts',
    'src/testing/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: false, // TODO: Re-enable once all adapters are type-aligned
  clean: true,
  splitting: false,
  sourcemap: true,
  external: [
    'react',
    '@tauri-apps/api',
    '@react-native-async-storage/async-storage',
    '@goalrate-app/crypto',
  ],
});
