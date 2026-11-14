import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromiumPath = '/opt/pw-browsers/chromium';
const executablePath = existsSync(chromiumPath) ? chromiumPath : undefined;
const clipboard = ['clipboard-read', 'clipboard-write'];

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run build && npm run start -- -p 3100',
    port: 3100,
    reuseExistingServer: true,
    timeout: 300_000,
    // Testserver mit Speicher-Datenbank; nur Testwerte, keine echten Zugangsdaten.
    env: {
      NEXUS_TEST_MEMORY_DB: '1',
      SESSION_SECRET: 'e2e-session-secret-nur-fuer-tests-0123456789',
      OWNER_SETUP_TOKEN: 'e2e-setup-token',
      CRON_SECRET: 'e2e-cron',
      APP_ORIGIN: 'http://localhost:3100',
      STRIPE_WEBHOOK_SECRET: 'whsec_e2e_nur_test',
    },
  },
  use: { baseURL: 'http://localhost:3100' },
  projects: [
    {
      name: 'iphone',
      use: {
        ...devices['iPhone 15'],
        browserName: 'chromium',
        permissions: clipboard,
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        permissions: clipboard,
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    ...(process.env.E2E_WEBKIT === '1'
      ? [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }]
      : []),
  ],
});
