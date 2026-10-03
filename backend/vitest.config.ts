import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['backend/test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: { enabled: false },
  },
});
