import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/colors.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['tailwindcss', 'tailwindcss-animate'],
})
