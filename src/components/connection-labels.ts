import { HOW_TO } from '@/domain/connections';
import { ageMinutes } from '@/domain/freshness';
import type { Connection } from '@/domain/types';

/** Untertitel einer Verbindung im Echtmodus: Stand, Störung im Klartext oder die Anleitung zum Einrichten. */
export function connectionSubtitle(c: Connection, at: Date): string {
  if (c.status === 'missing') return HOW_TO[c.id];
  const age = ageMinutes(c, at);
  const stand = age === null ? 'noch nie abgerufen' : `Stand vor ${age} Min.`;
  if (c.status === 'error') return `${c.lastError ? `Störung: ${c.lastError}` : 'Störung'} · ${stand}`;
  return age === null ? 'Verbunden' : `Verbunden · ${stand}`;
}
