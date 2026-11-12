import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { runTick } from '@/server/cron';
import { readEnv } from '@/server/env';
import { getActionProvider, getRepos } from '@/server/registry';

const digest = (s: string) => createHash('sha256').update(s).digest();

export async function GET(req: Request) {
  const expected = digest(`Bearer ${readEnv().cronSecret}`);
  // Gleich lange Hashes: timingSafeEqual wirft sonst bei ungleicher Länge und verrät sie nicht über die Laufzeit.
  if (!timingSafeEqual(digest(req.headers.get('authorization') ?? ''), expected)) {
    return NextResponse.json({ error: 'Nicht erlaubt' }, { status: 401 });
  }
  const r = await runTick({ repos: getRepos(), at: realNow(), provider: getActionProvider() });
  return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
}
