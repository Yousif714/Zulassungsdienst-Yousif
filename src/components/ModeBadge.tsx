'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useMode } from '@/data/mode';

/** Zeigt im Demo-Modus „Demo“, ohne Anmeldung mit Link zur Anmeldung. Im Echtmodus nichts. */
export function ModeBadge() {
  const { mode, authenticated } = useMode();
  const pathname = usePathname();
  if (mode !== 'demo' || pathname === '/anmelden') return null;
  return (
    <div className="mode-bar">
      <span className="demo-badge" data-testid="mode-badge">Demo</span>
      {!authenticated && <Link href="/anmelden">Anmelden für echte Daten</Link>}
    </div>
  );
}
