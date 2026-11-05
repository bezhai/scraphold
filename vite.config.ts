import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  // Relative asset paths so the built dist/ can be opened from any static host or path.
  base: './',
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
