'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { DemoProvider } from '@/domain/actions/demo-provider';
import { REJECT_REASON_DE } from '@/domain/actions/machine';
import { now } from '@/domain/clock';
import { ensureCatalogConnections, migrateState } from '@/domain/migrate';
import type { StoreEvent } from '@/domain/events';
import { newId } from '@/domain/ids';
import type { AppState } from '@/domain/types';
import { applyEvent, refresh, type EngineContext } from './engine';
import { checkAction, executeApproved, sweepStaleExecutions, type EventSink } from './executor';
import { createEmptyState } from './empty-state';
import { OFFLINE_NOTICE, reloadTo, useMode, type AppMode } from './mode';
import { UnauthorizedError, createRealClient } from './real-client';
import { createDemoState } from './seed';
import { createReloadGate, createWriteTracker } from './refresh';

const RELOAD_MIN_GAP_MS = 10_000;

export const STORE_KEY = 'nexus-demo-v1';

export type { StoreEvent };
export { REJECT_REASON_DE, refresh };

/** Kontext der lokalen Demo: Demo-Uhr, Demo-Protokoll, UUIDs. */
export const demoContext = (): EngineContext => ({ at: now(), isDemo: true, newId });

/** Ausführer der lokalen Demo: führt nie extern aus. */
const provider = new DemoProvider();

export function reducer(s: AppState, e: StoreEvent): AppState {
  return applyEvent(s, e, demoContext()).state;
}

// ---------- React ----------

type Dispatch = (e: StoreEvent) => Promise<{ created: string[]; ok?: boolean }>;
export type SyncResult = 'ok' | 'wait' | 'error';
type Store = {
  state: AppState; dispatch: Dispatch; mode: AppMode;
  /** Echtmodus: Zustand neu vom Server holen. Demo/offline: nichts zu tun. */
  reload: () => Promise<void>;
  /** Echtmodus: Abgleich mit den Quellen anstoßen und den neuen Zustand übernehmen. */
  syncNow: () => Promise<SyncResult>;
};
const noop = async () => {};
const noSync = async (): Promise<SyncResult> => 'ok';
const StoreContext = createContext<Store | null>(null);
/** Nur für den KI-Client: übernimmt einen vom Server gelieferten Zustand (Echtmodus). */
const AdoptContext = createContext<(s: AppState) => void>(() => {});

export const SAVE_FAILED = 'Konnte nicht gespeichert werden';

/** Startzustand aus dem Speicher (sonst Demo-Daten), neu abgeglichen. Bei `reset=1` wird die frische Demo sofort gespeichert,
 *  damit ein zweiter Lauf (React StrictMode) ohne Parameter denselben Zustand lädt. */
export function loadInitial(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  search: string,
  at: Date,
): { state: AppState; stripReset: boolean } {
  if (new URLSearchParams(search).get('reset') === '1') {
    const state = refresh(createDemoState(), at);
    storage.setItem(STORE_KEY, JSON.stringify(state));
    return { state, stripReset: true };
  }
  let s: AppState;
  try {
    const raw = storage.getItem(STORE_KEY);
    s = raw ? { ...createEmptyState(), ...(JSON.parse(raw) as AppState) } : createDemoState();
  } catch {
    s = createDemoState();
  }
  return { state: refresh(ensureCatalogConnections(migrateState(s)), at), stripReset: false };
}

function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const loaded = useRef(false);
  // Aktueller Stand synchron: schnell aufeinanderfolgende Dispatches (createAction + approveAction) sehen den neuen Stand sofort.
  const ref = useRef<AppState | null>(null);
  // Der Ausführer schreibt über denselben Weg wie `dispatch` in den Zustand.
  const [sink] = useState<EventSink>(() => ({
    current: () => ref.current as AppState,
    async apply(e) {
      const r = applyEvent(ref.current as AppState, e, demoContext());
      ref.current = r.state;
      setState(r.state);
      return r.state;
    },
  }));

  useEffect(() => {
    // Erst nach der Hydrierung laden: localStorage und URL gibt es nur im Browser. Der Ref verhindert doppeltes Laden (StrictMode).
    if (loaded.current) return;
    loaded.current = true;
    const { state: initial, stripReset } = loadInitial(window.localStorage, window.location.search, now());
    if (stripReset) {
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    ref.current = initial;
    setState(initial);
    // Liegengebliebene Ausführungen (Seite war zu) → „Ausgang unklar“; noch nicht ausgeführte Freigaben nachholen.
    void sweepStaleExecutions(sink, now()).then(() => executeApproved(sink, provider));
  }, [sink]);

  useEffect(() => {
    if (state) window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [state]);

  const dispatch = useCallback(async (e: StoreEvent) => {
    if (!ref.current) return { created: [] };
    const r = applyEvent(ref.current, e, demoContext());
    ref.current = r.state;
    setState(r.state);
    // Danach führt der Ausführer freigegebene Aktionen aus; erst dann ist der Aufruf fertig.
    await executeApproved(sink, provider);
    if (e.type === 'checkAction') await checkAction(sink, provider, e.id);
    return { created: r.created };
  }, [sink]);

  if (!state) return null;
  return <StoreContext.Provider value={{ state, dispatch, mode: 'demo', reload: noop, syncNow: noSync }}>{children}</StoreContext.Provider>;
}

/**
 * Echtmodus: Zustand vom Server (`/api/state`), Ereignisse an `/api/events`, Antwortzustand wird übernommen.
 * Nichts landet im Browser-Speicher. Offline: leerer Zustand mit Hinweis, keine Demo-Daten.
 */
function RealStoreProvider({ mode, children }: { mode: 'real' | 'offline'; children: ReactNode }) {
  const [client] = useState(() => createRealClient());
  const [state, setState] = useState<AppState | null>(() => (mode === 'offline' ? createEmptyState() : null));
  const [notice, setNotice] = useState(mode === 'offline' ? OFFLINE_NOTICE : '');
  const loaded = useRef(false);
  // Schreibzugriffe laufen: ein gleichzeitig geladener Zustand wäre älter als die Antwort und wird verworfen.
  const [writes] = useState(createWriteTracker);
  const gate = useRef(createReloadGate(RELOAD_MIN_GAP_MS));

  useEffect(() => {
    if (mode === 'offline' || loaded.current) return;
    loaded.current = true;
    client.load().then(setState, (err: unknown) => {
      if (err instanceof UnauthorizedError) return reloadTo('/anmelden');
      setState(createEmptyState());
      setNotice(OFFLINE_NOTICE);
    });
  }, [client, mode]);

  const dispatch = useCallback<Dispatch>(async (e) => {
    const w = writes;
    w.begin();
    try {
      const r = await client.dispatch(e);
      setState(r.state);
      setNotice('');
      return { created: r.created, ok: true };
    } catch (err) {
      if (err instanceof UnauthorizedError) reloadTo('/anmelden');
      else setNotice(SAVE_FAILED);
      return { created: [], ok: false };
    } finally {
      w.end();
    }
  }, [client, writes]);

  /** Holt den Zustand neu; Fehler lassen den alten Stand stehen. Läuft zwischendurch ein Schreibzugriff, gewinnt dessen Antwort. */
  const reload = useCallback(async () => {
    if (writes.pending > 0) return;
    const snap = writes.snapshot();
    try {
      const s = await client.load();
      if (writes.canApply(snap)) setState(s);
    } catch (err) {
      if (err instanceof UnauthorizedError) reloadTo('/anmelden');
    }
  }, [client, writes]);

  const syncNow = useCallback(async (): Promise<SyncResult> => {
    const snap = writes.snapshot();
    try {
      const r = await client.syncNow();
      if (!r.ok) return 'wait';
      if (writes.canApply(snap)) {
        writes.bump();
        setState(r.state);
      }
      return 'ok';
    } catch (err) {
      if (err instanceof UnauthorizedError) reloadTo('/anmelden');
      return 'error';
    }
  }, [client, writes]);

  // Die installierte App bleibt im Hintergrund am Leben: beim Zurückkehren neu laden (höchstens alle 10 s).
  useEffect(() => {
    if (mode === 'offline') return;
    const back = () => {
      if (document.visibilityState === 'visible' && writes.pending === 0 && gate.current()) void reload();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, [mode, reload, writes]);

  const adopt = useCallback((s: AppState) => {
    writes.bump();
    setState(s);
    setNotice('');
  }, [writes]);

  if (!state) return null;
  return (
    <StoreContext.Provider value={{ state, dispatch, mode, reload, syncNow }}>
      <AdoptContext.Provider value={adopt}>
        <p role="status" className="store-notice">{notice}</p>
        {children}
      </AdoptContext.Provider>
    </StoreContext.Provider>
  );
}

/** Wählt nach dem Modus den lokalen Demo-Speicher oder den Server. Ein Moduswechsel hängt alles neu ein. */
export function AppStoreProvider({ children }: { children: ReactNode }) {
  const { mode } = useMode();
  return mode === 'demo'
    ? <DemoStoreProvider>{children}</DemoStoreProvider>
    : <RealStoreProvider key={mode} mode={mode}>{children}</RealStoreProvider>;
}

export function useAdoptState(): (s: AppState) => void {
  return useContext(AdoptContext);
}

export function useAppStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useAppStore muss innerhalb von <AppStoreProvider> verwendet werden.');
  return store;
}
