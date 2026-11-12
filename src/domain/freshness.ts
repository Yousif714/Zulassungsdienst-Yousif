import type { Connection, ConnectionId } from './types';

export const STALE_AFTER_MINUTES = 45;

export function sourceFreshness(c: Connection, now: Date): 'fresh' | 'stale' | 'error' | 'missing' {
  if (c.status === 'missing') return 'missing';
  if (c.status === 'error') return 'error';
  if (!c.lastSuccessAt) return 'stale';
  const ageMin = (now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000;
  return ageMin > STALE_AFTER_MINUTES ? 'stale' : 'fresh';
}

/** Ganze Minuten seit dem letzten erfolgreichen Abruf (`null`, wenn nie abgerufen). */
export function ageMinutes(c: Connection, now: Date): number | null {
  if (!c.lastSuccessAt) return null;
  return Math.floor((now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000);
}

/** Liefert die Quellen, deren Datenstand nicht frisch ist (veraltet, Fehler oder nicht verbunden). Unbekannte IDs werden ignoriert. */
export function areaStale(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[] {
  return sources.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return !!c && sourceFreshness(c, now) !== 'fresh';
  });
}
