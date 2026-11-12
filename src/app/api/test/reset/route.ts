import { NextResponse } from 'next/server';
import { readEnv } from '@/server/env';
import { resetTestRepos } from '@/server/registry';

export async function POST() {
  if (!readEnv().testMemoryDb) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  resetTestRepos();
  return NextResponse.json({});
}
