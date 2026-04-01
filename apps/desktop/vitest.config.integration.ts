/**
 * Vitest Configuration for Integration Tests
 * These tests run against the real Tauri backend
 *
 * Prerequisites:
 * 1. Start the desktop app: pnpm run dev:desktop
 * 2. Run integration tests: pnpm run test:integration
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/integration-setup.ts'],
    include: ['src/**/*.integration.test.{ts,tsx}'],
    // Longer timeout for real backend operations
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run sequentially to avoid race conditions with file system
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Disable parallelism for integration tests
    sequence: {
      shuffle: false,
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
