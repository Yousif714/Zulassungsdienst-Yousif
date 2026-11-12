import { describe, expect, test } from 'vitest';

import { IMPORT_SINCE } from '@/domain/import/batch';
import { STRIPE_API_VERSION as DOMAIN_VERSION } from '@/domain/import/stripe';
import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { pullStripe, STRIPE_API_VERSION } from '@/server/connectors/stripe';
import type { PullContext } from '@/server/connectors/types';
import { stripeRoutes, stripeRoutesPaged } from '../../fixtures';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const ctx = (o: Partial<PullContext> = {}): PullContext => ({
  fetch: fixtureFetch(stripeRoutesPaged), key: 'sk_test_SECRET', sleep: async () => {}, now: () => NOW, deadline: NOW + 60_000, known: new Map(), ...o,
});
/** Budget über die Zahl der Anfragen: nach `n` fetch-Aufrufen ist `now()` hinter der Deadline (unabhängig vom Zeitverbrauch des Clients). */
const limitFetches = (routes: Record<string, unknown>, n: number) => {
  const inner = fixtureFetch(routes);
  let count = 0;
  const f = ((i: RequestInfo | URL, init?: RequestInit) => { count++; return inner(i, init); }) as typeof fetch;
  return { o: { fetch: f, now: () => (count >= n ? NOW + 1_000_000 : NOW), deadline: NOW + 60_000 } };
};
const ids = (r: { batch: { payments: { externalId: string }[] } }) => r.batch.payments.map((p) => p.externalId);
const sinceSec = Date.parse(`${IMPORT_SINCE}T00:00:00Z`) / 1000 - 7200; // Berlin-Mitternacht (Sommerzeit) als sichere Untergrenze

describe('pullStripe', () => {
  test('blättert über has_more/starting_after und liefert den gemappten Batch', async () => {
    const calls: string[] = [];
    const r = await pullStripe(null, ctx({ fetch: fixtureFetch(stripeRoutesPaged, { calls }) }));
    expect(calls.some((c) => c.includes('starting_after=in_A2'))).toBe(true);
    expect(r.complete).toBe(true);
    expect(ids(r)).toEqual(expect.arrayContaining(['in_A1', 'in_A2', 'in_A3', 'in_B1', 'in_D1', 're_B1']));
    expect(r.batch.subscriptions.length).toBeGreaterThan(0);
    expect(r.batch.disputes).toEqual([{ externalId: 'dp_1', invoiceExternalId: 'in_A3' }]);
    const firstInvoices = calls.find((c) => c.startsWith('/v1/invoices?'))!;
    expect(firstInvoices).toContain(`created%5Bgte%5D=${sinceSec}`); // Erstlauf ab IMPORT_SINCE
    expect(firstInvoices).toContain('status=paid');
  });

  test('fertiger Lauf liefert Folge-Cursor mit Wasserzeichen jetzt − 35 Tage; Folgelauf fragt ab dort', async () => {
    const calls: string[] = [];
    const first = await pullStripe(null, ctx());
    const cur = JSON.parse(first.cursor!);
    expect(cur).toEqual({ createdGte: NOW / 1000 - 35 * 86400, phase: 'invoices', startingAfter: null });
    await pullStripe(first.cursor, ctx({ fetch: fixtureFetch(stripeRoutes, { calls }) }));
    expect(calls.find((c) => c.startsWith('/v1/invoices?'))).toContain(`created%5Bgte%5D=${cur.createdGte}`);
  });

  test('Abbruch mitten in der Rechnungsliste → Cursor mit starting_after; Folgelauf liefert genau den Rest', async () => {
    const lim = limitFetches(stripeRoutesPaged, 3); // Abos, Produkte, Rechnungsseite 1
    const first = await pullStripe(null, ctx(lim.o));
    expect(first.complete).toBe(false);
    expect(ids(first).sort()).toEqual(['in_A1', 'in_A2']);
    expect(JSON.parse(first.cursor!)).toEqual({ createdGte: sinceSec, phase: 'invoices', startingAfter: 'in_A2' });
    const calls: string[] = [];
    const second = await pullStripe(first.cursor, ctx({ fetch: fixtureFetch(stripeRoutesPaged, { calls }) }));
    expect(second.complete).toBe(true);
    expect(calls.some((c) => c.startsWith('/v1/subscriptions'))).toBe(false); // Abos nur beim Lauf-Start
    expect(ids(second).sort()).toEqual(['in_A3', 'in_B1', 'in_D1', 're_B1']);
    expect(ids(first).filter((i) => ids(second).includes(i))).toEqual([]);
  });

  test('Abbruch zwischen Erstattungen und Streitfällen → Cursor phase disputes; Folgelauf nur Streitfälle', async () => {
    const lim = limitFetches(stripeRoutesPaged, 5); // Abos, Produkte, 2 Rechnungsseiten, Erstattungen
    const first = await pullStripe(null, ctx(lim.o));
    expect(first.complete).toBe(false);
    expect(ids(first)).toContain('re_B1');
    expect(first.batch.disputes).toEqual([]);
    expect(JSON.parse(first.cursor!)).toMatchObject({ phase: 'disputes', startingAfter: null });
    const calls: string[] = [];
    const second = await pullStripe(first.cursor, ctx({ fetch: fixtureFetch(stripeRoutesPaged, { calls }) }));
    expect(second.complete).toBe(true);
    expect(calls).toHaveLength(1);
    expect(second.batch.disputes).toEqual([{ externalId: 'dp_1', invoiceExternalId: 'in_A3' }]);
  });

  test('Budget schon vor der ersten Anfrage erreicht → leerer Batch, Cursor bleibt am Anfang', async () => {
    const calls: string[] = [];
    const r = await pullStripe(null, ctx({ fetch: fixtureFetch(stripeRoutesPaged, { calls }), deadline: NOW }));
    expect(calls).toEqual([]);
    expect(r.complete).toBe(false);
    expect(r.batch.payments).toEqual([]);
    expect(JSON.parse(r.cursor!)).toMatchObject({ createdGte: sinceSec, phase: 'invoices', startingAfter: null });
  });

  test('Stripe-Version und Bearer-Header gesetzt; Konstante stammt aus der Domain', async () => {
    expect(STRIPE_API_VERSION).toBe(DOMAIN_VERSION);
    const seen: Request[] = [];
    const inner = fixtureFetch(stripeRoutesPaged);
    const spy = ((i: RequestInfo | URL, init?: RequestInit) => { seen.push(new Request(i as string, init)); return inner(i, init); }) as typeof fetch;
    await pullStripe(null, ctx({ fetch: spy }));
    expect(seen.length).toBeGreaterThan(3);
    for (const r of seen) {
      expect(r.headers.get('stripe-version')).toBe(STRIPE_API_VERSION);
      expect(r.headers.get('authorization')).toBe('Bearer sk_test_SECRET');
      expect(r.url).not.toContain('SECRET');
    }
  });

  test('Erstattung ohne invoiceId wird über Zahlung → Rechnung aufgelöst (Charge → PaymentIntent → invoice_payments)', async () => {
    const calls: string[] = [];
    const routes = {
      ...stripeRoutesPaged,
      '/v1/refunds': { object: 'list', has_more: false, data: [{ id: 're_B1', amount: 5000, currency: 'eur', created: 1789905600, status: 'succeeded', charge: 'ch_B' }] },
      '/v1/disputes': { object: 'list', has_more: false, data: [{ id: 'dp_1', amount: 30000, currency: 'eur', created: 1793880000, payment_intent: 'pi_A3' }] },
      '/v1/charges/ch_B': { id: 'ch_B', payment_intent: 'pi_B' },
      [`/v1/invoice_payments?${new URLSearchParams({ 'payment[type]': 'payment_intent', 'payment[payment_intent]': 'pi_B', limit: '1' })}`]: { data: [{ invoice: 'in_B1' }] },
      [`/v1/invoice_payments?${new URLSearchParams({ 'payment[type]': 'payment_intent', 'payment[payment_intent]': 'pi_A3', limit: '1' })}`]: { data: [{ invoice: 'in_A3' }] },
    };
    const r = await pullStripe(null, ctx({ fetch: fixtureFetch(routes, { calls }) }));
    expect(r.batch.payments.find((p) => p.externalId === 're_B1')).toMatchObject({ amountCents: -5000, refundOf: 'in_B1' });
    expect(r.batch.disputes).toEqual([{ externalId: 'dp_1', invoiceExternalId: 'in_A3' }]);
  });

  test('Erstattung zu einer Rechnung außerhalb des Fensters: Rechnung wird nachgeladen', async () => {
    const calls: string[] = [];
    const routes = { ...stripeRoutesPaged, [`/v1/invoices?${new URLSearchParams({ status: 'paid', 'created[gte]': String(sinceSec), limit: '100' })}`]: { data: [], has_more: false } };
    const r = await pullStripe(null, ctx({ fetch: fixtureFetch(routes, { calls }) }));
    expect(calls).toContain('/v1/invoices/in_B1');
    expect(ids(r)).toContain('re_B1');
  });

  test('Fehler tragen den Schlüssel nicht', async () => {
    const f = (async () => new Response('{"error":"Invalid API Key provided: sk_test_SECRET"}', { status: 401 })) as typeof fetch;
    const err = await pullStripe(null, ctx({ fetch: f })).then(() => { throw new Error('kein Fehler'); }, (e: Error) => e);
    expect(err.message).toBe('Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen)');
  });
});
