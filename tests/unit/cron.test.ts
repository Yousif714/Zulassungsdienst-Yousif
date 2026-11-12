import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runTick } from '@/server/cron';
import { dispatchEvents } from '@/server/state-service';
import { createMemoryRepos } from '@/server/db/memory';
import type { Repos } from '@/server/db/repository';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { GET } from '@/app/api/cron/tick/route';
import { resetTestRepos } from '@/server/registry';

// `connection()` braucht einen echten Request-Kontext; im Unit-Test reicht ein No-op.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

let repos: Repos;
const provider = new DemoProvider();
beforeEach(() => {
  repos = createMemoryRepos();
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  resetTestRepos();
});
const chat = async () => (await repos.state.load()).state.assistantChat;

describe('runTick', () => {
  test('zwei parallele Ticks ergeben genau einen Lauf je Schlüssel', async () => {
    const at = new Date('2026-11-12T06:05:00Z'); // 07:05 Berlin
    const [a, b] = await Promise.all([runTick({ repos, at, provider }), runTick({ repos, at, provider })]);
    expect([...a.ran, ...b.ran].filter((k) => k === 'briefing_morning:2026-11-12:07:00')).toHaveLength(1);
    expect([...a.skipped, ...b.skipped]).toContain('briefing_morning:2026-11-12:07:00');
    expect((await chat()).filter((m) => m.text.startsWith('Guten Morgen'))).toHaveLength(1);
  });
  test('Briefings aus → nur sync', async () => {
    await dispatchEvents(repos, [{ type: 'updateSettings', patch: { briefingsEnabled: false } }], { at: () => new Date('2026-11-12T05:00:00Z'), provider });
    const r = await runTick({ repos, at: new Date('2026-11-12T06:05:00Z'), provider });
    expect(r.ran.every((k) => k.startsWith('sync:'))).toBe(true);
    expect(r.ran.length).toBeGreaterThan(0);
    expect(await chat()).toHaveLength(0);
  });
  test('Sonntag 19:05 → review_evening und review_weekly', async () => {
    const r = await runTick({ repos, at: new Date('2026-11-15T18:05:00Z'), provider }); // So 19:05 Berlin
    expect(r.ran).toContain('review_evening:2026-11-15:19:00');
    expect(r.ran).toContain('review_weekly:2026-11-15:19:00');
    const texts = (await chat()).map((m) => m.text);
    expect(texts.some((t) => t.startsWith('Guten Abend'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Wochenrückblick'))).toBe(true);
  });
  test('Briefing-Nachricht trägt delivery "push"', async () => {
    await runTick({ repos, at: new Date('2026-11-12T06:05:00Z'), provider });
    const m = (await chat()).find((x) => x.text.startsWith('Guten Morgen'));
    expect(m?.delivery).toBe('push');
    expect(m?.direction).toBe('to_owner');
  });
  test('Schlüssel bleiben nach weiteren Speicherungen erhalten', async () => {
    const at = new Date('2026-11-12T06:05:00Z');
    await runTick({ repos, at, provider });
    const r2 = await runTick({ repos, at: new Date('2026-11-12T06:10:00Z'), provider });
    expect(r2.ran).toEqual([]);
    expect(await repos.state.recentJobRuns(new Date('2026-11-12T00:00:00Z'))).toContain('briefing_morning:2026-11-12:07:00');
  });
  test('sync setzt executing älter als 5 Min. auf uncertain', async () => {
    const t0 = new Date('2026-11-12T05:00:00Z');
    const action = { id: 'a-1', type: 'create_calendar_event' as const, company: 'zulassung' as const, title: 'T', payload: {}, version: 1, status: 'draft' as const, createdAt: t0.toISOString(), isDemo: false };
    await dispatchEvents(repos, [{ type: 'createAction', action }], { at: () => t0, provider });
    // Ausführung hängt: Start gespeichert, nie beendet
    const hanging = { simulated: true, execute: () => new Promise<never>(() => {}), lookup: async () => false };
    void dispatchEvents(repos, [{ type: 'approveAction', id: 'a-1', version: 1, via: 'app' }], { at: () => t0, provider: hanging });
    await new Promise((r) => setTimeout(r, 50));
    expect((await repos.state.load()).state.actions[0].status).toBe('executing');
    await runTick({ repos, at: new Date('2026-11-12T05:10:00Z'), provider });
    expect((await repos.state.load()).state.actions[0].status).toBe('uncertain');
  });
});

describe('GET /api/cron/tick', () => {
  const call = (auth?: string) => GET(new Request('http://x/api/cron/tick', { headers: auth ? { authorization: auth } : {} }));
  test('falsches oder fehlendes Bearer → 401', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer falsch')).status).toBe(401);
    expect((await call(`Bearer ${process.env.CRON_SECRET}x`)).status).toBe(401);
  });
  test('richtiges Bearer → 200 mit ran/skipped', async () => {
    const r = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.ran) && Array.isArray(j.skipped)).toBe(true);
  });
});
