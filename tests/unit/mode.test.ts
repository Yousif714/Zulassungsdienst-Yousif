import { describe, expect, it } from 'vitest';
import { DEMO_FLAG_KEY, OFFLINE_NOTICE, resolveMode, type AppMode } from '@/data/mode';

describe('resolveMode', () => {
  const cases: [string, { authenticated: boolean; demoFlag: string | null; reachable: boolean }, AppMode][] = [
    ['nicht angemeldet → Demo', { authenticated: false, demoFlag: null, reachable: true }, 'demo'],
    ['nicht angemeldet, Server weg → Demo', { authenticated: false, demoFlag: null, reachable: false }, 'demo'],
    ['angemeldet ohne Flag → Echt', { authenticated: true, demoFlag: null, reachable: true }, 'real'],
    ['angemeldet, Flag „1“ → Demo', { authenticated: true, demoFlag: '1', reachable: true }, 'demo'],
    ['angemeldet, anderes Flag → Echt', { authenticated: true, demoFlag: '0', reachable: true }, 'real'],
    ['angemeldet, Server nicht erreichbar → offline (kein stilles Demo)', { authenticated: true, demoFlag: null, reachable: false }, 'offline'],
    ['angemeldet, Flag „1“, Server weg → Demo (ausdrücklich gewählt)', { authenticated: true, demoFlag: '1', reachable: false }, 'demo'],
  ];
  for (const [name, input, want] of cases) it(name, () => expect(resolveMode(input)).toBe(want));

  it('Schlüssel und Hinweistext', () => {
    expect(DEMO_FLAG_KEY).toBe('nexus-demo-mode');
    expect(OFFLINE_NOTICE).toBe('Server nicht erreichbar – Daten nicht aktuell');
  });
});
