import { NextResponse } from 'next/server';
import { hashRecoveryCode } from '@/server/auth/recovery';
import { fail, readJson, startSession } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';
import { realNow } from '@/domain/clock';

export async function POST(req: Request) {
  const env = readEnv();
  const code = (await readJson(req)).code;
  if (typeof code !== 'string' || !code.trim()) return fail('Code ungültig', 401);
  const ok = await getRepos().auth.consumeRecoveryCode(hashRecoveryCode(code, env.sessionSecret), realNow());
  if (!ok) return fail('Code ungültig', 401);
  await startSession(env);
  return NextResponse.json({});
}
