import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromiumPath = '/opt/pw-browsers/chromium';
const executablePath = existsSync(chromiumPath) ? chromiumPath : undefined;
const clipboard = ['clipboard-read', 'clipboard-write'];
// Zustandsbehaftete Specs (setzen/ändern den gemeinsamen Server-Stand, z. B. /api/test/takeover): nie parallel zu anderen Specs.
const stateful = ['**/auth.spec.ts', '**/umstellung.spec.ts'];

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
      testIgnore: stateful,
      use: {
        ...devices['iPhone 15'],
        browserName: 'chromium',
        permissions: clipboard,
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    {
      name: 'desktop',
      testIgnore: stateful,
      use: {
        ...devices['Desktop Chrome'],
        permissions: clipboard,
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
    // Zustandsbehaftet: laufen erst nach allen übrigen Specs und nacheinander (Projekt-Abhängigkeiten statt paralleler Worker),
    // nur mit Desktop-Gerät (auth.spec überspringt andere Projekte).
    {
      name: 'stateful-auth',
      testMatch: '**/auth.spec.ts',
      dependencies: ['iphone', 'desktop'],
      use: { ...devices['Desktop Chrome'], permissions: clipboard, launchOptions: executablePath ? { executablePath } : {} },
    },
    {
      name: 'stateful-umstellung',
      testMatch: '**/umstellung.spec.ts',
      dependencies: ['stateful-auth'],
      use: { ...devices['Desktop Chrome'], permissions: clipboard, launchOptions: executablePath ? { executablePath } : {} },
    },
    ...(process.env.E2E_WEBKIT === '1'
      ? [{ name: 'iphone-webkit', use: { ...devices['iPhone 15'] } }]
      : []),
  ],
});
