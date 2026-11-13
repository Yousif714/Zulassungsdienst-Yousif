import { HOW_TO } from '@/domain/connections';
import { ageText } from '@/domain/freshness';
import type { Connection } from '@/domain/types';

/** Untertitel einer Verbindung im Echtmodus: Stand, Störung im Klartext oder die Anleitung zum Einrichten. */
export function connectionSubtitle(c: Connection, at: Date): string {
  if (c.status === 'missing') return HOW_TO[c.id];
  const stand = c.lastSuccessAt ? ageText(c, at) : 'noch nie abgerufen';
  if (c.status === 'error') return `${c.lastError ? `Störung: ${c.lastError}` : 'Störung'} · ${stand}`;
  return c.lastSuccessAt ? `Verbunden · ${stand}` : 'Verbunden';
}
