import { expect, test, type Page } from '@playwright/test';
import { lexwareRoutes, stripeRoutes } from '../fixtures';

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

test('Assistent im Echtmodus antwortet dem Inhaber auch ohne gespeicherte Inhaber-Nummer', async () => {
  await page.goto('/assistent');
  await page.getByTestId('wa-input').fill('Was ist heute noch offen?');
  await page.getByTestId('wa-send').click();
  await expect(page.getByTestId('wa-msg')).toHaveCount(2);
  await expect(page.getByTestId('wa-ignored')).toHaveCount(0);
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

// Paket 2b-1: Echtmodus mit Import aus den Test-Fixtures (Memory-DB, gefälschter fetch). Nach „Noch nichts verbunden“-Tests, daher am Ende.
test('Echtmodus: Import, Vorschläge, Übernehmen führt zur Übernahme ohne Demo-Kopf', async () => {
  const r = await page.request.post('/api/test/import', { data: { routes: { ...stripeRoutes, ...lexwareRoutes } } });
  expect(r.ok()).toBe(true);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-stripe_nexus')).toContainText(/Verbunden · Stand vor \d+ Min/);
  await page.goto('/nexus');
  await expect(page.getByTestId('proposals-card')).toContainText('Verträge zum Bestätigen');
  await page.getByTestId('proposals-card').click();
  const card = page.getByTestId('proposal-stripe_nexus:sub_A');
  await expect(card).toContainText('1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026');
  await expect(card).toContainText('vollständig');
  await card.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page).toHaveURL(/\/nexus\/mitglieder\/[^/]+\/uebernahme$/);
  await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  await expect(page.getByTestId('previous-payments').locator('li')).toHaveCount(3);
});

test('Echtmodus: Verwerfen bleibt verworfen, Lexware-Vertrag zeigt „Bank nicht verbunden“', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  await page.getByTestId('proposal-stripe_nexus:sub_E').getByRole('button', { name: 'Verwerfen' }).click();
  await page.reload();
  await expect(page.getByTestId('proposal-stripe_nexus:sub_E')).toHaveCount(0);
  await page.getByTestId('proposal-lexware_nexus:c-77').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('bank-missing')).toHaveText(/Bank nicht verbunden/);
  await page.goto('/nexus');
  await expect(page.getByText('Überweisung · Bank nicht verbunden')).toBeVisible();
});

test('Echtmodus: unvollständiger Vorschlag lässt sich erst nach Ergänzen übernehmen', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  const card = page.getByTestId('proposal-lexware_nexus:c-83'); // Gesamtrechnung ohne Fälligkeitstag
  await expect(card).toContainText('bitte ergänzen');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await card.getByLabel('Fälligkeitstag').fill('15');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
});

test('Echtmodus: „Jetzt abgleichen“ gleicht ab, zweiter Klick binnen einer Minute bittet um Geduld', async () => {
  await page.goto('/verbindungen');
  await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
  await expect(page.getByTestId('sync-now-msg')).toHaveText('Abgeglichen');
  await expect(page.getByTestId('setup-checklist')).toBeVisible();
  await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
  await expect(page.getByTestId('sync-now-msg')).toHaveText('Bitte kurz warten');
});
