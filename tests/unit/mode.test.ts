import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_HINT_KEY, DEMO_FLAG_KEY, OFFLINE_NOTICE, resolveMode, signOut, type AppMode } from '@/data/mode';

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

describe('signOut', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubBrowser(fetchImpl: () => Promise<Response>) {
    const store = new Map<string, string>([[AUTH_HINT_KEY, '1'], [DEMO_FLAG_KEY, '1']]);
    const assign = vi.fn();
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
      location: { assign },
    });
    return { store, assign, fetchMock };
  }

  it('beendet die Sitzung, löscht Merker und Demo-Schalter und lädt die Anmeldung', async () => {
    const b = stubBrowser(async () => new Response('{}', { status: 200 }));
    expect(await signOut()).toBe(true);
    expect(b.fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
    expect(b.store.size).toBe(0);
    expect(b.assign).toHaveBeenCalledWith('/anmelden');
  });

  it('ohne Server: nichts löschen, nicht umleiten', async () => {
    const b = stubBrowser(async () => { throw new TypeError('offline'); });
    expect(await signOut()).toBe(false);
    expect(b.store.size).toBe(2);
    expect(b.assign).not.toHaveBeenCalled();
  });
});
