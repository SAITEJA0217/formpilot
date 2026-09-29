import { defineConfig } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * Serial, single worker, and no `projects`: every spec launches its own persistent Chromium
 * profile with the extension loaded and binds the test server to port 3000 (the origin the
 * shipped manifest trusts), so two specs cannot run concurrently without colliding.
 *
 * `webServer` starts the repo's real Next.js dev server on 3100 for the Next-specific spec.
 * The Firebase values below are deliberate throwaways: the root layout calls `getAuth()`
 * during render and Firebase rejects an empty `apiKey`, so the page 500s without them. They
 * are shaped like real keys and point nowhere — no request in these tests leaves the
 * container, and the specs never sign in. They live here rather than in a committed
 * `.env.local` so a checkout carries no file that looks like real configuration.
 */
const FAKE_FIREBASE_ENV = {
  NEXT_PUBLIC_FIREBASE_API_KEY: 'AIzaSyFAKE-not-a-real-key-e2e-only',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'formpilot-e2e.invalid',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'formpilot-e2e',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'formpilot-e2e.invalid',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:e2e0000000000000000000',
};

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
  webServer: {
    command: 'npx next dev -p 3100',
    cwd: 'frontend',
    url: 'http://127.0.0.1:3100/test-forms',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: FAKE_FIREBASE_ENV,
  },
});
