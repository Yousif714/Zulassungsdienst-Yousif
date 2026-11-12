import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), 'src'),
      'server-only': path.resolve(process.cwd(), 'tests/unit/stubs/server-only.ts'),
    },
  },
  test: { include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'] },
});
