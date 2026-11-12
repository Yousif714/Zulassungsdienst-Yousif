import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { CHALLENGE_COOKIE, readChallenge, verifyAuthenticationFor } from '@/server/auth/webauthn';
import { fail, readJson, startSession } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';
import { realNow } from '@/domain/clock';

const DENIED = 'Anmeldung fehlgeschlagen';

export async function POST(req: Request) {
  const env = readEnv();
  const jar = await cookies();
  const challenge = await readChallenge(jar.get(CHALLENGE_COOKIE)?.value, env.sessionSecret, 'login', realNow());
  jar.delete(CHALLENGE_COOKIE);
  if (!challenge) return fail(DENIED, 401);

  const response = (await readJson(req)).response as AuthenticationResponseJSON | undefined;
  const { auth } = getRepos();
  const passkey = (await auth.listPasskeys()).find((p) => p.id === response?.id);
  if (!response || !passkey) return fail(DENIED, 401);

  const v = await verifyAuthenticationFor(env, response, challenge, passkey);
  if (!v.ok) return fail(DENIED, 401);
  await auth.updateCounter(passkey.id, v.newCounter);
  await startSession(env);
  return NextResponse.json({});
}
