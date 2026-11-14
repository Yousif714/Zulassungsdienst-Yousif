import { NextResponse, connection } from 'next/server';
import type { AppState } from '@/domain/types';
import { fixtureFetch } from '@/server/connectors/fixture-fetch';
import { createStripeWriter } from '@/server/connectors/stripe-write';
import { diffState } from '@/server/db/tables';
import { readEnv } from '@/server/env';
import { getRepos, resetTestRepos, setTestStripeWriter } from '@/server/registry';

const notFound = () => NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });

/** Nur Testmodus: Stand und Stripe-Fixtures für die Umstellungs-E2E setzen. */
export async function POST(req: Request) {
  if (!readEnv().testMemoryDb) return notFound();
  const body = (await req.json().catch(() => null)) as { routes?: Record<string, unknown>; state?: AppState } | null;
  resetTestRepos();
  const repos = getRepos();
  if (body?.state) {
    const { state, revision } = await repos.state.load();
    const r = await repos.state.save(diffState(state, body.state), revision);
    if (!r.ok) return NextResponse.json({ error: 'Stand nicht gesetzt' }, { status: 409 });
  }
  setTestStripeWriter(createStripeWriter({ key: 'test', fetch: fixtureFetch(body?.routes ?? {}), sleep: async () => {}, now: () => Date.now() }));
  return NextResponse.json({});
}

export async function GET() {
  await connection();
  if (!readEnv().testMemoryDb) return notFound();
  const { state } = await getRepos().state.load();
  return NextResponse.json({ takeovers: state.takeovers }, { headers: { 'cache-control': 'no-store' } });
}
