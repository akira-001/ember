import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['dist/**', 'node_modules/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 10_000,
    teardownTimeout: 5_000,
  },
});
