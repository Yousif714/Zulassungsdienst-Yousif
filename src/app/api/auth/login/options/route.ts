import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { CHALLENGE_COOKIE, authenticationOptionsFor, challengeCookieOptions, signChallenge } from '@/server/auth/webauthn';
import { fail } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';
import { realNow } from '@/domain/clock';

export async function POST() {
  const env = readEnv();
  const passkeys = await getRepos().auth.listPasskeys();
  if (passkeys.length === 0) return fail('Noch kein Passkey eingerichtet', 409);
  const options = await authenticationOptionsFor(env, passkeys);
  const token = await signChallenge(env.sessionSecret, { challenge: options.challenge, purpose: 'login' }, realNow());
  (await cookies()).set(CHALLENGE_COOKIE, token, challengeCookieOptions());
  return NextResponse.json(options);
}
