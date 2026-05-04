import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/bridge',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Run with the proper chromium binary (not headless shell) so OPFS works
        channel: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'pnpm exec vite --config tests/bridge/vite.fixture.config.ts',
    port: 5179,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
