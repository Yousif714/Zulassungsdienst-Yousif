import { beforeEach, describe, expect, test } from 'vitest';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { deriveProposals } from '@/domain/import/proposals';
import { createMemoryRepos } from '@/server/db/memory';
import type { Repos } from '@/server/db/repository';
import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { sanitizeError, syncConnections, type SyncDeps } from '@/server/sync';
import { ConnectorError } from '@/server/connectors/types';
import { lexwareRoutes, stripeRoutes } from '../fixtures';

const NOW = new Date('2026-11-12T10:00:00Z');
let repos: Repos;
beforeEach(() => { repos = createMemoryRepos(); });
const deps = (p: Partial<SyncDeps> = {}): SyncDeps => ({
  at: () => NOW, keys: { stripe_nexus: 'SK', lexware_nexus: 'LK' }, fetch: fixtureFetch({ ...stripeRoutes, ...lexwareRoutes }),
  sleep: async () => {}, now: () => 0, budgetMs: 40_000, provider: new DemoProvider(), ...p,
});
const conn = async (id: string) => (await repos.state.load()).state.connections.find((c) => c.id === id)!;

describe('syncConnections', () => {
  test('ohne Schlüssel bleibt die Verbindung missing', async () => {
    const r = await syncConnections(repos, deps({ keys: {} }));
    expect(r).toEqual({ stripe_nexus: 'skipped', lexware_nexus: 'skipped', lexware_zulassung: 'skipped' });
    expect((await conn('stripe_nexus')).status).toBe('missing');
  });
  test('Erfolg: Daten im Zustand, verbunden, Vorschläge ableitbar', async () => {
    expect((await syncConnections(repos, deps())).stripe_nexus).toBe('ok');
    const s = (await repos.state.load()).state;
    expect(s.subscriptions.length).toBeGreaterThan(0);
    expect((await conn('stripe_nexus')).status).toBe('connected');
    expect(deriveProposals(s).map((p) => p.id)).toEqual(expect.arrayContaining(['stripe_nexus:sub_A', 'lexware_nexus:c-77']));
  });
  test('zweiter Lauf erzeugt keine Doppelten', async () => {
    await syncConnections(repos, deps());
    const a = (await repos.state.load()).state;
    await syncConnections(repos, deps());
    const b = (await repos.state.load()).state;
    expect(b.payments.length).toBe(a.payments.length);
    expect(b.invoices.length).toBe(a.invoices.length);
  });
  test('Folge-Slice ohne Abo-Betrag behält den alten Betrag', async () => {
    await syncConnections(repos, deps({ only: ['stripe_nexus'] }));
    const before = (await repos.state.load()).state.subscriptions;
    expect(before.some((x) => x.amountCents !== null)).toBe(true);
    // Folgelauf: Abos kommen wieder, aber ohne bezahlte Rechnungen
    await syncConnections(repos, deps({ only: ['stripe_nexus'], fetch: fixtureFetch({ ...stripeRoutes, '/v1/invoices': { object: 'list', data: [], has_more: false } }) }));
    const after = (await repos.state.load()).state.subscriptions;
    for (const b of before) expect(after.find((x) => x.externalId === b.externalId)?.amountCents).toBe(b.amountCents);
  });
  test('Fehler: error + bereinigter Text, alte Daten bleiben', async () => {
    await syncConnections(repos, deps());
    const before = (await repos.state.load()).state;
    await syncConnections(repos, deps({ fetch: async () => { throw new Error('boom SK'); } }));
    const s = (await repos.state.load()).state;
    const c = s.connections.find((x) => x.id === 'stripe_nexus')!;
    expect(c.status).toBe('error');
    expect(c.lastError).not.toContain('SK');
    expect(JSON.stringify(s.audit)).not.toContain('SK');
    expect(s.payments).toEqual(before.payments);
  });
  test('eine fehlgeschlagene Verbindung stoppt die anderen nicht', async () => {
    const f = fixtureFetch({ ...stripeRoutes, ...lexwareRoutes });
    const r = await syncConnections(repos, deps({ fetch: (async (i: RequestInfo | URL, o?: RequestInit) => { if (String(i).includes('stripe')) throw new Error('x'); return f(i, o); }) as typeof fetch }));
    expect(r.stripe_nexus).toBe('error');
    expect(r.lexware_nexus).toBe('ok');
  });
  test('Fehlerzähler wächst je Fehlschlag', async () => {
    const bad = deps({ fetch: async () => { throw new Error('x'); } });
    for (let i = 0; i < 3; i++) await syncConnections(repos, { ...bad, only: ['stripe_nexus'] });
    expect((await conn('stripe_nexus')).sync?.failures).toBe(3);
  });
  test('Budget erschöpft → partial, nächster Lauf setzt fort', async () => {
    let t = 0;
    expect((await syncConnections(repos, deps({ now: () => (t += 10_000), budgetMs: 25_000 }))).lexware_nexus).toBe('partial');
    await syncConnections(repos, deps());
    expect((await conn('lexware_nexus')).sync!.complete).toBe(true);
  });
  test('only begrenzt auf eine Verbindung', async () => {
    expect(Object.keys(await syncConnections(repos, deps({ only: ['stripe_nexus'] })))).toEqual(['stripe_nexus']);
  });
});

describe('sanitizeError', () => {
  test('ConnectorError-Text, Geheimnisse maskiert; sonst fester Text', () => {
    expect(sanitizeError(new ConnectorError('Stripe: Zugriff abgelehnt'), [])).toBe('Stripe: Zugriff abgelehnt');
    expect(sanitizeError(new ConnectorError('Fehler SK123'), ['SK123'])).toBe('Fehler ***');
    expect(sanitizeError(new Error('boom SK'), ['SK'])).toBe('Unbekannter Fehler');
  });
});
