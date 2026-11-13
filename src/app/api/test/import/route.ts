import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { readEnv } from '@/server/env';
import { getActionProvider, getRepos } from '@/server/registry';
import { syncConnections } from '@/server/sync';

/** Nur Testmodus (auf Vercel unmöglich, siehe readEnv): Sync gegen Fixtures aus dem Body, ohne Netz. */
export async function POST(req: Request) {
  if (!readEnv().testMemoryDb) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { routes?: Record<string, unknown> } | null;
  const routes = body && typeof body.routes === 'object' && body.routes ? body.routes : {};
  const r = await syncConnections(getRepos(), {
    at: realNow, keys: { stripe_nexus: 'test', lexware_nexus: 'test', bank_qonto: 'test:test', lexware_zulassung: 'test' },
    fetch: fixtureFetch(routes), sleep: async () => {}, now: () => realNow().getTime(), budgetMs: 40_000, provider: getActionProvider(),
  });
  return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
}
