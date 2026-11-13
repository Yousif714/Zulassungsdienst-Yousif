import { formatBerlin } from './clock';
import type { Connection, ConnectionId } from './types';

export const STALE_AFTER_MINUTES = 45;

/** Abweichende Frist je Verbindung: die Portal-Mitgliederliste wird von Hand eingefügt und gilt 30 Tage. */
export const STALE_AFTER_MINUTES_BY_CONNECTION: Partial<Record<ConnectionId, number>> = { portal_nexus: 30 * 24 * 60 };

export function staleAfterMinutes(id: ConnectionId): number {
  return STALE_AFTER_MINUTES_BY_CONNECTION[id] ?? STALE_AFTER_MINUTES;
}

export function sourceFreshness(c: Connection, now: Date): 'fresh' | 'stale' | 'error' | 'missing' {
  if (c.status === 'missing') return 'missing';
  if (c.status === 'error') return 'error';
  if (!c.lastSuccessAt) return 'stale';
  const ageMin = (now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000;
  return ageMin > staleAfterMinutes(c.id) ? 'stale' : 'fresh';
}

/** Ganze Minuten seit dem letzten erfolgreichen Abruf (`null`, wenn nie abgerufen). */
export function ageMinutes(c: Connection, now: Date): number | null {
  if (!c.lastSuccessAt) return null;
  return Math.floor((now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000);
}

/** Altersanzeige: Minuten bis zur ersten Stunde, danach Datum und Uhrzeit (Europe/Berlin). */
export function ageText(c: Connection, at: Date): string {
  const age = ageMinutes(c, at);
  if (age === null) return 'Noch nie abgerufen';
  if (age < 60) return `Stand vor ${age} Min.`;
  return `Stand vom ${formatBerlin(new Date(c.lastSuccessAt as string), 'dd.MM.yyyy, HH:mm')} Uhr`;
}

/** Liefert die Quellen, deren Datenstand nicht frisch ist (veraltet, Fehler oder nicht verbunden). Unbekannte IDs werden ignoriert. */
export function areaStale(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[] {
  return sources.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return !!c && sourceFreshness(c, now) !== 'fresh';
  });
}
