import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/server/auth/session';

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.json({});
}
