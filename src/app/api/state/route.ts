import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { requireSession } from '@/server/auth/session';
import { getRepos } from '@/server/registry';
import { loadState } from '@/server/state-service';

export async function GET() {
  // Erst die Sitzung (Cookies): das macht die Route dynamisch.
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  const state = await loadState(getRepos(), realNow());
  return NextResponse.json({ state }, { headers: { 'cache-control': 'no-store' } });
}
