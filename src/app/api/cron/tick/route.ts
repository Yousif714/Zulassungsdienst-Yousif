import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { runTick } from '@/server/cron';
import { readEnv } from '@/server/env';
import { getActionProvider, getRepos, getSyncDeps } from '@/server/registry';
import { syncConnections } from '@/server/sync';

const digest = (s: string) => createHash('sha256').update(s).digest();

export async function GET(req: Request) {
  // Zuerst als dynamisch markieren: sonst rendert der Build (cacheComponents) die Route vor und liest dabei die Umgebung.
  await connection();
  const expected = digest(`Bearer ${readEnv().cronSecret}`);
  // Gleich lange Hashes: timingSafeEqual wirft sonst bei ungleicher Länge und verrät sie nicht über die Laufzeit.
  if (!timingSafeEqual(digest(req.headers.get('authorization') ?? ''), expected)) {
    return NextResponse.json({ error: 'Nicht erlaubt' }, { status: 401 });
  }
  const repos = getRepos();
  const r = await runTick({ repos, at: realNow(), provider: getActionProvider(), sync: () => syncConnections(repos, getSyncDeps()) });
  return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
}
