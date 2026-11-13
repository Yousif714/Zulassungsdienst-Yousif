import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { requireSession } from '@/server/auth/session';
import { getRepos, getSyncDeps } from '@/server/registry';
import { loadState } from '@/server/state-service';
import { sanitizeError, syncConnections } from '@/server/sync';

// Sekunden; das Sync-Budget (40 s) liegt darunter.
export const maxDuration = 60;

/** „Jetzt abgleichen“: derselbe Abgleich wie im Cron, höchstens einmal pro Minute (atomar über job_runs). */
export async function POST() {
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  const repos = getRepos();
  const at = realNow();
  const minuteKey = at.toISOString().slice(0, 16);
  if (!(await repos.state.claimJobRun('manual-sync:' + minuteKey, at))) {
    return NextResponse.json({ error: 'Bitte kurz warten, der letzte Abgleich ist gerade erst gelaufen.' }, { status: 429 });
  }
  const deps = getSyncDeps();
  try {
    await syncConnections(repos, deps);
  } catch (err) {
    const secrets = Object.values(deps.keys).filter((k): k is string => !!k);
    return NextResponse.json({ error: `Abgleich fehlgeschlagen: ${sanitizeError(err, secrets)}` }, { status: 502 });
  }
  const state = await loadState(repos, realNow());
  return NextResponse.json({ state }, { headers: { 'cache-control': 'no-store' } });
}
