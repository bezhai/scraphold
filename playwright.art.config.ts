import { defineConfig, devices } from '@playwright/test';

const PORT = 4319;

/**
 * Visual review and render performance for the art pass, separate from the main e2e suite:
 * builds to dist-art/ and serves it on its own port, so it never touches dist/ or port 4317.
 * Screenshots go to e2e-art/screenshots/.
 */
export default defineConfig({
  testDir: 'e2e-art',
  timeout: 300_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
  webServer: {
    command: `pnpm exec vite build --outDir dist-art && pnpm exec vite preview --outDir dist-art --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
