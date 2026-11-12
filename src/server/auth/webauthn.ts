import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import type { ServerEnv } from '../env';
import type { StoredPasskey } from '../db/repository';
import { realNow } from '@/domain/clock';

export const CHALLENGE_COOKIE = 'nexus_webauthn';
export const CHALLENGE_MAX_AGE_S = 5 * 60;
const RP_NAME = 'Nexus Assistent';
const USER_NAME = 'Inhaber';

export type ChallengePurpose = 'register' | 'login';

const key = (secret: string) => new TextEncoder().encode(secret);
const rpID = (env: ServerEnv) => new URL(env.appOrigin).hostname;
const toB64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const fromB64u = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export function challengeCookieOptions() {
  return { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: CHALLENGE_MAX_AGE_S };
}

export async function signChallenge(secret: string, c: { challenge: string; purpose: ChallengePurpose }, at: Date): Promise<string> {
  const iat = Math.floor(at.getTime() / 1000);
  return new SignJWT({ challenge: c.challenge, purpose: c.purpose })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(iat)
    .setExpirationTime(iat + CHALLENGE_MAX_AGE_S)
    .sign(key(secret));
}

export async function readChallenge(token: string | undefined, secret: string, purpose: ChallengePurpose, at: Date): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], currentDate: at });
    if (payload.purpose !== purpose || typeof payload.challenge !== 'string') return null;
    return payload.challenge;
  } catch {
    return null;
  }
}

export function registrationOptionsFor(env: ServerEnv, existing: StoredPasskey[]) {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(env),
    userName: USER_NAME,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
}

export async function verifyRegistrationFor(
  env: ServerEnv,
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<StoredPasskey | null> {
  try {
    const v = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.appOrigin,
      expectedRPID: rpID(env),
      requireUserVerification: true,
    });
    if (!v.verified) return null;
    const c = v.registrationInfo.credential;
    return {
      id: c.id,
      publicKey: toB64u(c.publicKey),
      counter: c.counter,
      transports: c.transports ?? [],
      createdAt: realNow().toISOString(),
    };
  } catch {
    return null;
  }
}

export function authenticationOptionsFor(env: ServerEnv, passkeys: StoredPasskey[]) {
  return generateAuthenticationOptions({
    rpID: rpID(env),
    userVerification: 'required',
    allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })),
  });
}

export async function verifyAuthenticationFor(
  env: ServerEnv,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: StoredPasskey,
): Promise<{ ok: boolean; newCounter: number }> {
  try {
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: env.appOrigin,
      expectedRPID: rpID(env),
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: fromB64u(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    return { ok: v.verified, newCounter: v.authenticationInfo.newCounter };
  } catch {
    return { ok: false, newCounter: passkey.counter };
  }
}
