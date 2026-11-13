import { beforeEach, describe, expect, it, vi } from 'vitest';

let session = false;
vi.mock('@/server/auth/session', () => ({ requireSession: async () => session }));
const calls: string[] = [];
let failWith: Error | null = null;
vi.mock('@/server/sync', async (orig) => ({
  ...(await orig<typeof import('@/server/sync')>()),
  syncConnections: async () => {
    calls.push('sync');
    if (failWith) throw failWith;
    return {};
  },
}));

import { resetTestRepos } from '@/server/registry';
import { POST } from '@/app/api/sync/route';

beforeEach(() => {
  session = true;
  calls.length = 0;
  failWith = null;
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  vi.stubEnv('STRIPE_RESTRICTED_KEY', 'rk_live_SECRET123');
  resetTestRepos();
});

describe('POST /api/sync', () => {
  it('ohne Sitzung 401, ohne Abgleich', async () => {
    session = false;
    expect((await POST()).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it('gleicht ab und liefert den Zustand', async () => {
    const r = await POST();
    expect(r.status).toBe(200);
    const body = (await r.json()) as { state: { contacts: unknown[] } };
    expect(Array.isArray(body.state.contacts)).toBe(true);
    expect(calls).toEqual(['sync']);
  });
  it('zweiter Aufruf in derselben Minute → 429 auf Deutsch, kein zweiter Abgleich', async () => {
    await POST();
    const r = await POST();
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toMatch(/warten/);
    expect(calls).toEqual(['sync']);
  });
  it('Fehler verrät keine Schlüssel', async () => {
    failWith = new Error('boom rk_live_SECRET123');
    const r = await POST();
    expect(r.status).toBe(502);
    expect(JSON.stringify(await r.json())).not.toContain('SECRET123');
  });
});
