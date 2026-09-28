import { defineConfig } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Serial, single worker, and no `projects`: every spec launches its own persistent Chromium
 * profile with the extension loaded and binds the test server to port 3000 (the origin the
 * shipped manifest trusts), so two specs cannot run concurrently without colliding.
 */
export default defineConfig({
  testDir: './tests/e2e/specs',
  outputDir: './tests/e2e/.artifacts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'tests/e2e/.artifacts/results.json' }]] : 'list',
  use: { actionTimeout: 15_000, trace: 'off', video: 'off', screenshot: 'only-on-failure' },
});
