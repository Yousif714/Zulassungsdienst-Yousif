import { NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { generateRecoveryCodes, hashRecoveryCode } from '@/server/auth/recovery';
import { fail } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';

export async function POST() {
  if (!(await requireSession())) return fail('Nicht angemeldet', 401);
  const env = readEnv();
  const recoveryCodes = generateRecoveryCodes();
  await getRepos().auth.replaceRecoveryCodes(recoveryCodes.map((c) => hashRecoveryCode(c, env.sessionSecret)));
  return NextResponse.json({ recoveryCodes });
}
