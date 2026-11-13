import { expect, test, type Page } from '@playwright/test';
import { lexwareRoutes, portalListCsv, portalListText, qontoRoutes, stripeRoutes } from '../fixtures';

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

test('Verbindungen: Einrichtungs-Liste mit 12 offenen Einträgen', async () => {
  await page.goto('/verbindungen');
  const list = page.getByTestId('setup-checklist');
  await expect(list.getByRole('heading', { name: 'Einrichtung' })).toBeVisible();
  await expect(list.locator('li')).toHaveCount(12);
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

test('Echtmodus: Qonto-Import → Vorschlag → Ja → zweite Zahlung derselben IBAN automatisch; Offen ohne Doppelzählung', async () => {
  const r = await page.request.post('/api/test/import', { data: { qonto: true, routes: { ...stripeRoutes, ...lexwareRoutes, ...qontoRoutes } } });
  expect(r.ok()).toBe(true);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-bank_qonto')).toContainText(/Verbunden · Stand vor \d+ Min/);
  await expect(page.getByText('Sparkasse (Zulassung)')).toBeVisible();
  await expect(page.getByText(/Kommt als Upload/)).toBeVisible();
  await page.goto('/nexus/zuordnen');
  const cards = page.locator('[data-testid^="match-"]').filter({ has: page.getByRole('button', { name: /Ja, gehört zu Murat Demir/ }) }); // Vorschlag-Karten (Auswahllisten anderer Karten nennen den Namen auch)
  await expect(cards).toHaveCount(2);
  await expect(page.locator('[data-testid^="match-"]', { hasText: 'Stripe Technologies' })).toHaveCount(0);
  await cards.first().getByRole('button', { name: /Ja, gehört zu Murat Demir/ }).click();
  await expect(cards).toHaveCount(0);
  await page.goto('/nexus');
  await expect(page.getByText('Überweisung · Bank nicht verbunden')).toHaveCount(0);
  await page.getByTestId('open-link').click();
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1101' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1043' })).toHaveCount(0);
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1110' })).toHaveCount(1);
});

test('Echtmodus: Gesamtrechnung ohne Tag ist zum Monatsende fällig; leerer Tag sperrt Übernehmen, Ergänzen gibt frei', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  const card = page.getByTestId('proposal-lexware_nexus:c-83'); // Gesamtrechnung ohne Fälligkeitstag
  await expect(card).toContainText('zum Monatsende');
  await expect(card).not.toContainText('bitte ergänzen');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await card.getByLabel('Fälligkeitstag').fill('');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await card.getByLabel('Fälligkeitstag').fill('15');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
  await expect(card).toContainText('am 15.');
});

test('Echtmodus: Mitgliederliste einfügen, Status, Vertrag anlegen, Kein zahlendes Mitglied, CSV', async () => {
  await page.goto('/nexus');
  await expect(page.getByTestId('portal-link')).toContainText('Liste einfügen');
  await page.getByTestId('portal-link').click();
  await page.getByLabel('Mitgliederliste', { exact: true }).fill(portalListText);
  await expect(page.getByTestId('portal-preview')).toHaveText(/5 Mitglieder erkannt · 1 doppelt · 3 Zeilen ohne E-Mail/);
  await page.getByRole('button', { name: '5 Mitglieder übernehmen' }).click();
  await expect(page.getByTestId('portal-summary')).toContainText('5 im Portal · 2 mit Vertrag · 1 Vorschlag offen · 2 ohne Rechnung');
  await expect(page.getByTestId('portal-row-ayse@example.de')).toContainText('Vertrag');
  await expect(page.getByTestId('portal-row-murat@example.de')).toContainText('Vertrag');
  await expect(page.getByTestId('portal-row-nina@example.de')).toContainText('Vorschlag offen');
  await page.getByRole('radio', { name: 'Ohne Rechnung' }).check();
  await expect(page.locator('[data-testid^="portal-row-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Kein zahlendes Mitglied: team' }).click();
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Ausgeblendet (1)' }).check();
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toContainText('Kein zahlendes Mitglied');
  await page.getByRole('button', { name: 'Wieder einblenden: team' }).click();
  await expect(page.getByRole('radio', { name: /Ausgeblendet/ })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Ohne Rechnung' }).check();
  await expect(page.locator('[data-testid^="portal-row-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Kein zahlendes Mitglied: team' }).click();
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toHaveCount(0);
  await page.getByRole('button', { name: 'Vertrag anlegen für Paula Neu' }).click();
  const card = page.getByTestId('proposal-portal_nexus:neu@example.de');
  await expect(card).toContainText('bitte ergänzen');
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await card.getByLabel('Gesamt').fill('600,00');
  await card.getByLabel('Raten', { exact: true }).fill('6');
  await card.getByLabel('Rate', { exact: true }).fill('100,00');
  await card.getByLabel('Fälligkeitstag').fill('1');
  await card.getByLabel('Start').fill('2026-10-01');
  await card.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page).toHaveURL(/\/nexus\/mitglieder\/[^/]+\/uebernahme$/);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-portal_nexus')).toContainText(/Verbunden · Stand vor \d+ Min/);
  await page.goto('/nexus/mitglieder');
  await expect(page.getByTestId('portal-summary')).toContainText('4 im Portal · 3 mit Vertrag · 1 Vorschlag offen · 0 ohne Rechnung');
  // CSV-Upload: zweite, andere Liste → Fehlende werden nur markiert
  await page.getByRole('button', { name: 'Mitgliederliste einfügen' }).click();
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'mitglieder.csv', mimeType: 'text/csv', buffer: Buffer.from(portalListCsv, 'utf8') });
  await expect(page.getByTestId('portal-preview')).toHaveText(/3 Mitglieder erkannt · 0 doppelt · 1 Zeilen ohne E-Mail/);
  await page.getByRole('button', { name: '3 Mitglieder übernehmen' }).click();
  await expect(page.getByTestId('portal-row-murat@example.de')).toContainText('nicht mehr in Liste');
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toHaveCount(0);
});

test('Echtmodus: Excel-Export (.xlsx) hochladen, Vorschau, Übernehmen mit Beigetreten und Zuletzt aktiv', async () => {
  await page.goto('/nexus/mitglieder');
  await page.getByRole('button', { name: 'Mitgliederliste einfügen' }).click();
  const input = page.getByLabel('Excel- oder CSV-Datei');
  await input.setInputFiles({ name: 'gross.csv', mimeType: 'text/csv', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 'a') });
  await expect(page.locator('.form-error')).toContainText('zu groß');
  await input.setInputFiles({ name: 'alt.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') });
  await expect(page.locator('.form-error')).toContainText('Dateiformat');
  await input.setInputFiles('tests/fixtures/portal/mitglieder-portal-export.xlsx');
  await expect(page.getByTestId('portal-preview')).toHaveText(/4 Mitglieder erkannt · 0 doppelt · 0 Zeilen ohne E-Mail/);
  await page.getByRole('button', { name: '4 Mitglieder übernehmen' }).click();
  const row = page.getByTestId('portal-row-max@example.de');
  await expect(row).toContainText('m.mustermann@firma-example.de');
  await expect(row).toContainText('Beigetreten 10.08.2026');
  await expect(row).toContainText('Zuletzt aktiv 01.11.2026');
  await expect(page.getByTestId('portal-row-calvin.beispiel@example.de')).toContainText('Zuletzt aktiv nie');
});

test('Echtmodus: Lexware-AB aus dem Test-Import → Vorschlag „Lexware (AB)“ und Portal-Hinweis „Rechnung fehlt“', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  const card = page.getByTestId('proposal-lexware_nexus:c-84');
  await expect(card).toContainText('Lexware (AB)');
  await expect(card).toContainText('Auftragsbestätigung AB-2001');
  await expect(card).toContainText('zum Monatsende');
  await expect(page.getByTestId('proposal-lexware_nexus:c-85')).toHaveCount(0);
  await page.goto('/nexus/mitglieder');
  await page.getByRole('button', { name: 'Mitgliederliste einfügen' }).click();
  await page.getByLabel('Mitgliederliste', { exact: true }).fill('Name\tE-Mail\nTom Beispiel\ttom@example.de\nLisa Beispiel\tlisa@example.de');
  await page.getByRole('button', { name: '2 Mitglieder übernehmen' }).click();
  await expect(page.getByTestId('portal-row-tom@example.de')).toContainText('Vorschlag offen');
  await expect(page.getByTestId('portal-row-tom@example.de')).toContainText('AB AB-2001 vorhanden, Rechnung fehlt');
  await expect(page.getByTestId('portal-row-lisa@example.de')).toContainText('Keine Rechnung');
  await expect(page.getByTestId('portal-row-lisa@example.de')).toContainText('AB AB-2002 vorhanden, Rechnung fehlt');
});

test('Echtmodus: „Jetzt abgleichen“ gleicht ab, zweiter Klick binnen einer Minute bittet um Geduld', async () => {
  await page.goto('/verbindungen');
  await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
  await expect(page.getByTestId('sync-now-msg')).toHaveText('Abgeglichen');
  await expect(page.getByTestId('setup-checklist')).toBeVisible();
  await page.getByRole('button', { name: 'Jetzt abgleichen' }).click();
  await expect(page.getByTestId('sync-now-msg')).toHaveText('Bitte kurz warten');
});
