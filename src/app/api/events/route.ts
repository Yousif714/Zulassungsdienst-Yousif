import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { requireSession } from '@/server/auth/session';
import { getActionProvider, getRepos } from '@/server/registry';
import { dispatchEvents, isClientEvent } from '@/server/state-service';

export async function POST(req: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }
  const event = typeof body === 'object' && body !== null ? (body as { event?: unknown }).event : undefined;
  if (!isClientEvent(event)) return NextResponse.json({ error: 'Ereignis nicht erlaubt' }, { status: 400 });
  try {
    const r = await dispatchEvents(getRepos(), [event], { at: realNow, provider: getActionProvider() });
    return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof Error && err.message === 'conflict') {
      return NextResponse.json({ error: 'Gleichzeitige Änderung, bitte erneut versuchen' }, { status: 409 });
    }
    throw err;
  }
}
