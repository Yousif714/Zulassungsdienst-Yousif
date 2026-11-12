import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { checkSetupToken } from '@/server/auth/setup';
import { requireSession } from '@/server/auth/session';
import { CHALLENGE_COOKIE, challengeCookieOptions, registrationOptionsFor, signChallenge } from '@/server/auth/webauthn';
import { fail, readJson } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';
import { realNow } from '@/domain/clock';

export async function POST(req: Request) {
  const env = readEnv();
  const body = await readJson(req);
  const existing = await getRepos().auth.listPasskeys();
  if (existing.length === 0) {
    const t = typeof body.setupToken === 'string' ? body.setupToken : undefined;
    if (!checkSetupToken(t, env.ownerSetupToken)) return fail('Einrichtungs-Code ungültig', 403);
  } else if (!(await requireSession())) {
    return fail('Nicht angemeldet', 401);
  }
  const options = await registrationOptionsFor(env, existing);
  const token = await signChallenge(env.sessionSecret, { challenge: options.challenge, purpose: 'register' }, realNow());
  (await cookies()).set(CHALLENGE_COOKIE, token, challengeCookieOptions());
  return NextResponse.json(options);
}
