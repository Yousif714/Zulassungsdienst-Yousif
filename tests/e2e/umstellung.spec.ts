import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { createDemoState } from '@/data/seed';
import { linkSentState } from '../fixtures/takeover-state';
import { stripeWriteRoutes } from '../fixtures/stripe-write';

const KAYA = createDemoState().contracts.find((c) => c.contactId === 'm-kaya')!.id;
const SECRET = 'whsec_e2e_nur_test';
const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

test('ungültiger Link: neutrale Seite ohne App-Rahmen', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': randomIp() });
  await page.goto('/zahlung/' + '0'.repeat(64));
  await expect(page.getByText('Link nicht mehr gültig, bitte melde dich bei NEXUS.')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page).toHaveTitle('NEXUS – Ratenplan');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
});

test('Fixture-Stripe: Plan sehen, weiter zu Stripe, Webhook richtet ein', async ({ page, request }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': randomIp() });
  const state = linkSentState();
  const token = state.takeovers[0].token;
  const routes = { ...stripeWriteRoutes, 'POST /v1/checkout/sessions': { id: 'cs_test_1', url: 'http://localhost:3100/zahlung/danke', setup_intent: 'seti_test_1' } };
  expect((await request.post('/api/test/takeover', { data: { routes, state } })).ok()).toBe(true);

  await page.goto(`/zahlung/${token}`);
  await expect(page.getByText('2 Raten')).toBeVisible();
  await expect(page.getByText('Erste Abbuchung: 01.12.2026')).toBeVisible();
  await expect(page.getByText('Letzte Abbuchung: 01.01.2027')).toBeVisible();
  await expect(page.getByText('Erika')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page).toHaveTitle('NEXUS – Ratenplan');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"], meta[name="application-name"], meta[name="description"], meta[name="format-detection"]')).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  await page.getByRole('button', { name: 'Weiter zu Stripe' }).click();
  await expect(page).toHaveURL(/\/zahlung\/danke$/);
  await expect(page.getByText('Danke!')).toBeVisible();

  const body = JSON.stringify({
    id: 'evt_e2e_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_1', object: 'checkout.session', mode: 'setup', setup_intent: 'seti_test_1', customer: 'cus_test_1', metadata: { takeoverId: state.takeovers[0].id, contractId: 'c1' } } },
  });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
  const hook = await request.post('/api/webhooks/stripe', { data: body, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });
  expect(hook.status()).toBe(200);
  const got = (await (await request.get('/api/test/takeover')).json()) as { takeovers: { status: string }[] };
  expect(got.takeovers[0].status).toBe('set_up');
});

test('GET weiter legt keine Sitzung an', async ({ request }) => {
  const res = await request.get(`/zahlung/${'0'.repeat(64)}/weiter`, { headers: { 'x-forwarded-for': randomIp() } });
  expect(res.status()).toBe(405);
});

// Demo-Teil: reiner Browser-Stand (localStorage), kein Server-Zustand; Demo-Uhr 12.11.2026.
test('Umstellung im Demo-Modus: vorbereiten, freigeben, Link kopieren, einrichten', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}/uebernahme?reset=1`);
  await page.getByRole('button', { name: 'Auf Stripe umstellen' }).click();
  const chip = page.getByTestId('takeover-status');
  await expect(chip).toHaveText('vorbereitet');
  await page.getByRole('button', { name: 'Freigeben' }).click();
  await expect(chip).toHaveText('Link verschickt');
  const share = page.getByRole('textbox', { name: 'Nachricht an das Mitglied' });
  await expect(share).toHaveValue(/\/zahlung\/demo-/);
  await expect(share).toHaveValue(/^Hallo Mehmet, [\s\S]*Dauerauftrag/);
  await expect(share).toHaveValue(/http:\/\/localhost:3100\/zahlung\/demo-/);
  await page.getByRole('button', { name: 'Kopieren' }).click();
  await expect(page.getByText('Kopiert', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/zahlung/demo-');
  await page.getByRole('button', { name: 'Zahlungsmittel hinterlegt (Demo)' }).click();
  await expect(chip).toHaveText('eingerichtet');
  await expect(page.getByText('Raten laufen über Stripe')).toBeVisible();
  await page.goto(`/nexus/mitglieder/${KAYA}`);
  await expect(page.getByText('läuft über Stripe')).toBeVisible();
  await expect(page.getByRole('link', { name: /Umstellung.*eingerichtet/ })).toBeVisible();
  // Raten laufen über Stripe: keine Zahlungserinnerung (Doppelzahlung), stattdessen sichtbarer Grund.
  await expect(page.getByRole('button', { name: 'Erinnerung vorbereiten' })).toHaveCount(0);
  await expect(page.getByTestId('reminder-via-stripe')).toHaveText('Raten laufen über Stripe – keine Erinnerung nötig.');
});

test('Alle umstellen und Sammelfreigabe', async ({ page }) => {
  await page.goto('/nexus/umstellung?reset=1');
  const all = page.getByRole('button', { name: /^Alle umstellen \(\d+\)$/ });
  const n = Number(/\((\d+)\)/.exec((await all.textContent()) ?? '')![1]);
  expect(n).toBeGreaterThan(0);
  await all.click();
  await expect(page.getByTestId('takeover-rows').getByText('vorbereitet', { exact: true })).toHaveCount(n);
  await page.getByRole('button', { name: `Alle freigeben (${n})`, exact: true }).first().click();
  await expect(page.getByTestId('takeover-rows').getByText('Link verschickt', { exact: true })).toHaveCount(n);
  await expect(page.getByTestId('takeover-rows').getByText('vorbereitet', { exact: true })).toHaveCount(0);
});

test('Zurückziehen macht den Link ungültig', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}/uebernahme?reset=1`);
  await page.getByRole('button', { name: 'Auf Stripe umstellen' }).click();
  await page.getByRole('button', { name: 'Freigeben' }).click();
  await expect(page.getByTestId('takeover-status')).toHaveText('Link verschickt');
  await page.getByRole('button', { name: 'Zurückziehen' }).click();
  await expect(page.getByTestId('takeover-status')).toHaveText('zurückgezogen');
  await expect(page.getByRole('textbox', { name: 'Nachricht an das Mitglied' })).toHaveCount(0);
});

test('Einstellungen: Erinnerungstage', async ({ page }) => {
  await page.goto('/einstellungen?reset=1');
  const days = page.getByLabel('Erinnerung vor Fälligkeit (Tage)');
  await expect(days).toHaveValue('3');
  await days.fill('5');
  await days.blur();
  await page.reload();
  await expect(page.getByLabel('Erinnerung vor Fälligkeit (Tage)')).toHaveValue('5');
  await expect(page.getByLabel('Hinweis, wenn Link ungenutzt (Tage)')).toHaveValue('7');
});
