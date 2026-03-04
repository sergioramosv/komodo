import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/skills/**',
      '**/dashboard/**',
    ],
    isolate: false,
  },
});
