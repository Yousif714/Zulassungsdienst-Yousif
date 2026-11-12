import { expect, test, type Page } from '@playwright/test';

// Erstanmeldung mit virtuellem Passkey: Einrichtung, Echtmodus, Demo-Schalter, Abmelden, erneute Anmeldung.
test.describe.configure({ mode: 'serial' });

let page: Page;

test.beforeAll(async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Nur Desktop: virtueller Authenticator über CDP');
  expect((await request.post('/api/test/reset')).ok()).toBe(true);
  page = await browser.newContext({ baseURL: testInfo.project.use.baseURL }).then((c) => c.newPage());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
});

test.afterAll(async () => {
  await page?.context().close();
});

test('ohne Anmeldung: Demo-Etikett mit Link zur Anmeldung', async () => {
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toHaveText('Demo');
  await expect(page.getByRole('link', { name: 'Anmelden für echte Daten' })).toHaveAttribute('href', '/anmelden');
});

test('Einrichtung: Passkey anlegen, 10 Codes, danach leerer Echtmodus', async () => {
  await page.goto('/anmelden');
  await page.getByLabel('Einrichtungs-Code').fill('e2e-setup-token');
  await page.getByRole('button', { name: 'Passkey anlegen' }).click();
  await expect(page.getByRole('heading', { name: 'Wiederherstellungscodes' })).toBeVisible();
  await expect(page.locator('code')).toHaveCount(10);
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page.getByText('Noch nichts verbunden')).toBeVisible();
  await expect(page.getByTestId('mode-badge')).toHaveCount(0);
  await expect(page.getByTestId('reply-row')).toHaveCount(0);
});

test('Verbindungen: Einrichtungs-Liste mit 10 offenen Einträgen', async () => {
  await page.goto('/verbindungen');
  const list = page.getByTestId('setup-checklist');
  await expect(list.getByRole('heading', { name: 'Einrichtung' })).toBeVisible();
  await expect(list.locator('li')).toHaveCount(10);
  await expect(list.getByTestId('setup-check')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /simulieren|Wieder verbinden/ })).toHaveCount(0);
});

test('Demo-Schalter: an zeigt Demo-Daten, aus wieder leeren Echtzustand', async () => {
  await page.goto('/einstellungen');
  const konto = page.getByTestId('account-group');
  await konto.getByRole('switch', { name: 'Demo-Modus' }).check();
  await page.goto('/');
  await expect(page.getByTestId('mode-badge')).toHaveText('Demo');
  await expect(page.getByRole('link', { name: 'Anmelden für echte Daten' })).toHaveCount(0);
  await expect(page.getByTestId('reply-row').first()).toBeVisible();

  await page.goto('/einstellungen');
  await page.getByRole('switch', { name: 'Demo-Modus' }).uncheck();
  await page.goto('/');
  await expect(page.getByText('Noch nichts verbunden')).toBeVisible();
  await expect(page.getByTestId('mode-badge')).toHaveCount(0);
  await expect(page.getByTestId('reply-row')).toHaveCount(0);
});

test('Abmelden und mit demselben Passkey wieder anmelden', async () => {
  await page.goto('/einstellungen');
  await page.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/anmelden$/);
  await expect(page.getByRole('button', { name: 'Mit Passkey anmelden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Passkey anlegen' })).toHaveCount(0);
  expect(await page.evaluate(() => window.localStorage.getItem('nexus-angemeldet'))).toBeNull();

  await page.getByRole('button', { name: 'Mit Passkey anmelden' }).click();
  await expect(page.getByText('Noch nichts verbunden')).toBeVisible();
  await expect(page.getByTestId('mode-badge')).toHaveCount(0);
});

test('zweite Einrichtung ohne Sitzung wird abgewiesen', async ({ request }) => {
  const r = await request.post('/api/auth/register/options', { data: { setupToken: 'e2e-setup-token' } });
  expect(r.status()).toBe(401);
});
