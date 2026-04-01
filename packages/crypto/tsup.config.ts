import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/aes.ts',
    'src/keys.ts',
    'src/x25519.ts',
    'src/chacha.ts',
    'src/privateKeyStore.ts',
    'src/keySharing.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
});
