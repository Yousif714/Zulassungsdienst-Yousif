import { expect, test } from '@playwright/test';

import { createDemoState } from '@/data/seed';
import { formatEuro } from '@/domain/money';

const KAYA = createDemoState().contracts.find((c) => c.contactId === 'm-kaya')!.id;
const STRIPE_LEX = '[data-key="stripe-lex:i-lex-118"]';

test('Abnahme 2: überfälliges Mitglied → Rechenweg → Erinnerung mit Link', async ({ page }) => {
  await page.goto('/nexus?reset=1'); await page.getByTestId(`member-row-${KAYA}`).click();
  await expect(page.getByTestId('arrears')).toHaveText(formatEuro(15000));
  await expect(page.getByTestId('future')).toHaveText(formatEuro(60000));
  await page.getByRole('button', { name: 'Erinnerung vorbereiten' }).click();
  await expect(page.getByTestId('draft-text')).toContainText('https://buy.stripe.com/demo/');
});

test('Abnahme 3: Übernahme Referenzbeispiel', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}/uebernahme?reset=1`);
  await expect(page.getByTestId('arrears')).toHaveText(formatEuro(15000));
  await expect(page.getByTestId('future')).toHaveText(formatEuro(60000));
  await expect(page.getByTestId('open-total')).toHaveText(formatEuro(75000));
  await expect(page.getByTestId('rate-amounts')).toHaveText([formatEuro(45000), formatEuro(30000)].join(' · '));
  await page.getByRole('radio', { name: /verteilen/i }).check();
  await expect(page.getByTestId('rate-amounts')).toHaveText([formatEuro(37500), formatEuro(37500)].join(' · '));
});

test('Abnahme 4: unbekannte Überweisung zuordnen, IBAN lernen', async ({ page }) => {
  await page.goto('/nexus/zuordnen?reset=1');
  await page.getByTestId('match-p-yilmaz-1').getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByRole('button', { name: 'Überweisung simulieren' }).click();
  await page.getByLabel('IBAN').fill('DE02120300000000202051'); await page.getByLabel('Name').fill('Selin Yilmaz'); await page.getByLabel('Betrag').fill('300');
  await page.getByRole('button', { name: 'Buchen' }).click();
  await expect(page.getByText('Automatisch zugeordnet: Selin Yilmaz')).toBeVisible();
});

test('Abnahme 5: Stripe bezahlt, Lexware offen', async ({ page }) => {
  await page.goto('/?reset=1');
  await expect(page.getByTestId('top-insights')).toBeVisible();
  // Der Hinweis steht auf Heute nur sicher in der Liste, wenn er unter den Top 3 ist.
  if (await page.locator(STRIPE_LEX).count()) await page.locator(STRIPE_LEX).click();
  else await page.goto('/nexus/zuordnen');
  await expect(page).toHaveURL(/\/nexus\/zuordnen/);
  await page.getByRole('button', { name: 'Als durch Stripe bezahlt markieren' }).click();
  await expect(page.getByTestId('stripe-case-i-lex-118')).toHaveCount(0);
  await page.goto('/'); await expect(page.getByTestId('top-insights')).toBeVisible();
  await expect(page.locator(STRIPE_LEX)).toHaveCount(0);
  await page.goto('/nexus/zuordnen'); await expect(page.getByTestId('match-p-yilmaz-1')).toBeVisible();
  await expect(page.getByTestId('stripe-case-i-lex-118')).toHaveCount(0);
});

test('Abnahme 6: SEELE-Folien für Gamma kopieren', async ({ page, browserName }) => {
  await page.goto('/nexus/calls/call-seele?reset=1');
  await page.getByRole('button', { name: 'Folientexte vorbereiten' }).click();
  await expect(page.getByTestId('slide')).toHaveCount(10);
  await page.getByRole('button', { name: 'Für Gamma kopieren' }).click();
  await expect(page.getByText('Kopiert')).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# Folie 10:');
});

test('NEXUS-Übersicht: Filter überfällig, Zuordnen-Einstieg, Content-Board', async ({ page }) => {
  await page.goto('/nexus?reset=1');
  await expect(page.getByTestId('money-card-nexus')).toBeVisible();
  await expect(page.getByTestId('forecast')).toContainText('wackelig');
  const all = await page.locator('[data-testid^="member-row-"]').count();
  await page.getByRole('radio', { name: 'Überfällig' }).check();
  const overdue = page.locator('[data-testid^="member-row-"]');
  await expect(overdue.first()).toBeVisible();
  expect(await overdue.count()).toBeLessThan(all);
  await expect(page.getByTestId(`member-row-${KAYA}`)).toBeVisible();
  await expect(page.getByRole('link', { name: /Zuordnen \(\d+\)/ })).toBeVisible();
  await page.goto('/nexus/content');
  await expect(page.getByTestId('content-stage')).toHaveCount(5);
});

const storedActions = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('nexus-demo-v1') ?? '{}').actions ?? []) as { id: string; type: string; payload: Record<string, unknown> }[]);

test('Folie bearbeiten: Fokus bleibt beim Wechsel vom Titel zum Text', async ({ page }) => {
  await page.goto('/nexus/calls/call-seele?reset=1');
  await page.getByRole('button', { name: 'Folientexte vorbereiten' }).click();
  const title = page.getByLabel('Titel Folie 1', { exact: true });
  const body = page.getByLabel('Text Folie 1', { exact: true });
  await title.click(); await page.keyboard.press('End'); await page.keyboard.type(' neu');
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  await page.keyboard.type('X');
  await expect(body).toBeFocused();
  await expect(body).toHaveValue(/X/);
  await expect(title).toHaveValue(/ neu$/);
});

test('Übernahme: nur ein Stripe-Plan pro Vertrag, auch nach Moduswechsel', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}/uebernahme?reset=1`);
  const prepare = page.getByRole('button', { name: 'Stripe-Plan vorbereiten (Demo)' });
  await prepare.click();
  const status = page.getByTestId('plan-status');
  await expect(status).toContainText('Entwurf angelegt');
  await page.getByRole('radio', { name: /verteilen/i }).check();
  await expect(prepare).toBeDisabled();
  await expect(status).toContainText('Mit erster Rate nachzahlen');
  await expect(status).toContainText([formatEuro(45000), formatEuro(30000)].join(' · '));
  const plans = (await storedActions(page)).filter((a) => a.type === 'create_invoice_draft');
  expect(plans.map((a) => a.id)).toEqual([`stripe-plan-${KAYA}`]);
});

test('Erinnerung: eigene Aktion je Rückstandsstand', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}?reset=1`);
  await page.getByRole('button', { name: 'Erinnerung vorbereiten' }).click();
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('action-status')).toContainText('Gesendet (Demo)');
  const ids = (await storedActions(page)).filter((a) => a.type === 'send_reminder').map((a) => a.id);
  expect(ids).toEqual([`reminder-${KAYA}-2026-11-01`]);
});

test('Wiederholte Knöpfe nennen im Namen, worum es geht', async ({ page }) => {
  await page.goto('/nexus/zuordnen?reset=1');
  await expect(page.getByRole('button', { name: 'Zahlung von S. Yilmaz an Selin Yilmaz bestätigen', exact: true })).toBeVisible();
  await page.goto('/zulassung/auftraege/j-mueller-1');
  await expect(page.getByRole('button', { name: 'Rechnung RE-Z-2026-311 zuordnen', exact: true })).toBeVisible();
});

test('Demo: keine Vorschlagskarte, Übernahme zeigt Demo-Etikett', async ({ page }) => {
  await page.goto('/nexus?reset=1');
  await expect(page.getByTestId('proposals-card')).toHaveCount(0);
  await page.goto('/nexus/mitglieder/mc-schulz/uebernahme');
  await expect(page.getByTestId('demo-badge').first()).toBeVisible();
});
