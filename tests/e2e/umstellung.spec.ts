import { createHmac } from 'node:crypto';
import { expect, test } from '@playwright/test';

import { linkSentState } from '../fixtures/takeover-state';
import { stripeWriteRoutes } from '../fixtures/stripe-write';

const SECRET = 'whsec_e2e_nur_test';
const randomIp = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

test('ungültiger Link: neutrale Seite ohne App-Rahmen', async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': randomIp() });
  await page.goto('/zahlung/' + '0'.repeat(64));
  await expect(page.getByText('Link nicht mehr gültig, bitte melde dich bei NEXUS.')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('Fixture-Stripe: Plan sehen, weiter zu Stripe, Webhook richtet ein', async ({ page, request }, info) => {
  // Setzt den gemeinsamen Server-Stand: nur ein Projekt, sonst überschreiben sich iphone und desktop parallel.
  test.skip(info.project.name !== 'desktop', 'zustandsbehaftet, läuft nur im Desktop-Projekt');
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
