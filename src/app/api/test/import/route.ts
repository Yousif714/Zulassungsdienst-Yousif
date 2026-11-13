import { NextResponse } from 'next/server';
import { demoInvoiceReader } from '@/ai/demo-invoice-reader';
import { realNow } from '@/domain/clock';
import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { readEnv } from '@/server/env';
import { getActionProvider, getRepos } from '@/server/registry';
import { syncConnections } from '@/server/sync';

/** Nur Testmodus (auf Vercel unmöglich, siehe readEnv): Sync gegen Fixtures aus dem Body, ohne Netz. Qonto nur mit `qonto: true` verbunden, Rechnungen lesen (Demo-Leser) nur mit `claude: true`. */
export async function POST(req: Request) {
  if (!readEnv().testMemoryDb) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { routes?: Record<string, unknown>; qonto?: boolean; claude?: boolean } | null;
  const routes = body && typeof body.routes === 'object' && body.routes ? body.routes : {};
  const r = await syncConnections(getRepos(), {
    at: realNow, keys: { stripe_nexus: 'test', lexware_nexus: 'test', lexware_zulassung: 'test', ...(body?.qonto ? { bank_qonto: 'test:test' } : {}) },
    fetch: fixtureFetch(routes), sleep: async () => {}, now: () => realNow().getTime(), budgetMs: 40_000, provider: getActionProvider(),
    ...(body?.claude ? { reader: demoInvoiceReader } : {}),
  });
  return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
}
