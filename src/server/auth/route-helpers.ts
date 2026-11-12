import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from './session';
import type { ServerEnv } from '../env';
import { realNow } from '@/domain/clock';

export const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function startSession(env: ServerEnv): Promise<void> {
  const token = await createSessionToken(env.sessionSecret, realNow());
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(env.appOrigin));
}
