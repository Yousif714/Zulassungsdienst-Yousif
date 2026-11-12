import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { readEnv } from '../env';
import { realNow } from '@/domain/clock';

export const SESSION_COOKIE = 'nexus_session';
export const SESSION_MAX_AGE_S = 30 * 24 * 3600;

const key = (secret: string) => new TextEncoder().encode(secret);

export async function createSessionToken(secret: string, at: Date): Promise<string> {
  const iat = Math.floor(at.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('owner')
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_S)
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string, at: Date): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'], currentDate: at, subject: 'owner' });
    return payload.exp !== undefined;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(_appOrigin: string) {
  return { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: SESSION_MAX_AGE_S };
}

/** Für Route Handler und Server Actions. */
export async function requireSession(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, readEnv().sessionSecret, realNow());
}
