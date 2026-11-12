'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import { REJECT_REASON_DE } from '@/domain/actions/machine';
import { now } from '@/domain/clock';
import type { StoreEvent } from '@/domain/events';
import { newId } from '@/domain/ids';
import type { AppState } from '@/domain/types';
import { applyEvent, refresh, type EngineContext } from './engine';
import { createDemoState } from './seed';

export const STORE_KEY = 'nexus-demo-v1';

export type { StoreEvent };
export { REJECT_REASON_DE, refresh };

/** Kontext der lokalen Demo: Demo-Uhr, Demo-Protokoll, UUIDs. */
export const demoContext = (): EngineContext => ({ at: now(), isDemo: true, newId });

export function reducer(s: AppState, e: StoreEvent): AppState {
  return applyEvent(s, e, demoContext()).state;
}

// ---------- React ----------

type Store = { state: AppState; dispatch: (e: StoreEvent) => Promise<{ created: string[] }> };
const StoreContext = createContext<Store | null>(null);

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
    s = raw ? (JSON.parse(raw) as AppState) : createDemoState();
  } catch {
    s = createDemoState();
  }
  return { state: refresh(s, at), stripReset: false };
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const loaded = useRef(false);
  // Aktueller Stand synchron: schnell aufeinanderfolgende Dispatches (createAction + approveAction) sehen den neuen Stand sofort.
  const ref = useRef<AppState | null>(null);

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
  }, []);

  useEffect(() => {
    if (state) window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }, [state]);

  const dispatch = useCallback(async (e: StoreEvent) => {
    if (!ref.current) return { created: [] };
    const r = applyEvent(ref.current, e, demoContext());
    ref.current = r.state;
    setState(r.state);
    return { created: r.created };
  }, []);

  if (!state) return null;
  return <StoreContext.Provider value={{ state, dispatch }}>{children}</StoreContext.Provider>;
}

export function useAppStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useAppStore muss innerhalb von <AppStoreProvider> verwendet werden.');
  return store;
}
