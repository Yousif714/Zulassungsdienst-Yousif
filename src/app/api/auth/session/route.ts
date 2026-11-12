import { NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { getRepos } from '@/server/registry';

export async function GET() {
  // Erst die Cookies lesen: das macht die Route dynamisch, bevor die Umgebung gelesen wird.
  const authenticated = await requireSession();
  const count = await getRepos().auth.passkeyCount();
  return NextResponse.json({ authenticated, setupOpen: count === 0 });
}
