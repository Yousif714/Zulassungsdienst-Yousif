import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';
import { checkSetupToken } from '@/server/auth/setup';
import { requireSession } from '@/server/auth/session';
import { CHALLENGE_COOKIE, readChallenge, verifyRegistrationFor } from '@/server/auth/webauthn';
import { generateRecoveryCodes, hashRecoveryCode } from '@/server/auth/recovery';
import { fail, readJson, startSession } from '@/server/auth/route-helpers';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';
import { realNow } from '@/domain/clock';

export async function POST(req: Request) {
  const env = readEnv();
  const jar = await cookies();
  // Challenge einmalig verwenden: sofort löschen, egal wie es weitergeht.
  const challenge = await readChallenge(jar.get(CHALLENGE_COOKIE)?.value, env.sessionSecret, 'register', realNow());
  jar.delete(CHALLENGE_COOKIE);

  const body = await readJson(req);
  const { auth } = getRepos();
  const first = (await auth.passkeyCount()) === 0;
  if (first) {
    const t = typeof body.setupToken === 'string' ? body.setupToken : undefined;
    if (!checkSetupToken(t, env.ownerSetupToken)) return fail('Einrichtungs-Code ungültig', 403);
  } else if (!(await requireSession())) {
    // Wer mit gültigem Einrichtungs-Code zu spät kommt (paralleler Erst-Passkey), bekommt 409 statt 401.
    const t = typeof body.setupToken === 'string' ? body.setupToken : undefined;
    return checkSetupToken(t, env.ownerSetupToken) ? fail('Bereits eingerichtet', 409) : fail('Nicht angemeldet', 401);
  }
  if (!challenge) return fail('Anfrage abgelaufen, bitte erneut versuchen', 400);

  const passkey = await verifyRegistrationFor(env, body.response as RegistrationResponseJSON, challenge);
  if (!passkey) return fail('Passkey konnte nicht geprüft werden', 400);

  if (!first) {
    await auth.addPasskey(passkey);
    return NextResponse.json({});
  }
  if (!(await auth.addFirstPasskey(passkey))) return fail('Bereits eingerichtet', 409);
  const recoveryCodes = generateRecoveryCodes();
  await auth.replaceRecoveryCodes(recoveryCodes.map((c) => hashRecoveryCode(c, env.sessionSecret)));
  await startSession(env);
  return NextResponse.json({ recoveryCodes });
}
