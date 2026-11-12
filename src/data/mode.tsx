'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { setClockMode } from '@/domain/clock';

/** demo: lokale Demo-Daten; real: Server-Zustand; offline: angemeldet, aber Server nicht erreichbar (keine Demo-Daten). */
export type AppMode = 'demo' | 'real' | 'offline';

/** Ausdrücklicher Demo-Schalter des angemeldeten Inhabers. */
export const DEMO_FLAG_KEY = 'nexus-demo-mode';
/** Merkt sich, dass dieses Gerät angemeldet war: nur so lässt sich ohne Server „offline“ von „Demo“ unterscheiden. Kein Geheimnis. */
export const AUTH_HINT_KEY = 'nexus-angemeldet';
export const OFFLINE_NOTICE = 'Server nicht erreichbar – Daten nicht aktuell';

const SESSION_TIMEOUT_MS = 5000;

/** Seite vollständig neu laden: der Modus wird nur beim Start bestimmt (nach Anmeldung, bei abgelaufener Sitzung). */
export function reloadTo(path: '/' | '/anmelden'): void {
  window.location.assign(path);
}

export function resolveMode(i: { authenticated: boolean; demoFlag: string | null; reachable: boolean }): AppMode {
  if (!i.authenticated || i.demoFlag === '1') return 'demo';
  return i.reachable ? 'real' : 'offline';
}

async function checkSession(): Promise<{ reachable: boolean; authenticated: boolean }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SESSION_TIMEOUT_MS);
  try {
    const r = await fetch('/api/auth/session', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const authenticated = ((await r.json()) as { authenticated?: unknown }).authenticated === true;
    if (authenticated) window.localStorage.setItem(AUTH_HINT_KEY, '1');
    else window.localStorage.removeItem(AUTH_HINT_KEY);
    return { reachable: true, authenticated };
  } catch {
    return { reachable: false, authenticated: window.localStorage.getItem(AUTH_HINT_KEY) === '1' };
  } finally {
    clearTimeout(timer);
  }
}

type ModeInfo = { mode: AppMode; authenticated: boolean; reachable: boolean };
type ModeValue = { mode: AppMode; authenticated: boolean; setDemo(on: boolean): void };
const ModeContext = createContext<ModeValue | null>(null);

function apply(info: Omit<ModeInfo, 'mode'>): ModeInfo {
  const mode = resolveMode({ ...info, demoFlag: window.localStorage.getItem(DEMO_FLAG_KEY) });
  setClockMode(mode === 'demo' ? 'demo' : 'real');
  return { ...info, mode };
}

/** Bestimmt beim Start den Modus (Sitzung über `/api/auth/session`) und stellt die Uhr passend. */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<ModeInfo | null>(null);

  useEffect(() => {
    let alive = true;
    void checkSession().then((r) => {
      if (alive) setInfo(apply(r));
    });
    return () => {
      alive = false;
    };
  }, []);

  const setDemo = useCallback((on: boolean) => {
    if (on) window.localStorage.setItem(DEMO_FLAG_KEY, '1');
    else window.localStorage.removeItem(DEMO_FLAG_KEY);
    setInfo((i) => (i ? apply(i) : i));
  }, []);

  if (!info) return null;
  return <ModeContext.Provider value={{ mode: info.mode, authenticated: info.authenticated, setDemo }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeValue {
  const m = useContext(ModeContext);
  if (!m) throw new Error('useMode muss innerhalb von <ModeProvider> verwendet werden.');
  return m;
}
