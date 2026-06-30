import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['index.test.ts', 'acl-store.test.ts', 'http-ui.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['index.ts', 'acl-store.ts', 'http-ui.ts'],
    },
  },
});
