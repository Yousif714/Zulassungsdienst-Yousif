import { sourceFreshness } from '../freshness';
import type { AppState, Insight } from '../types';
import { connectionRef } from './refs';

export function detectStaleSources(s: AppState, now: Date): Insight[] {
  const out: Insight[] = [];
  for (const c of s.connections) {
    const f = sourceFreshness(c, now);
    if (f !== 'error' && f !== 'stale') continue;
    // Echte Abgleiche melden einen Fehler erst nach 3 Fehlversuchen; die Demo-Störung (ohne `sync`) sofort.
    if (f === 'error' && c.sync !== undefined && c.sync.failures < 3) continue;
    out.push({
      dedupeKey: `stale:${c.id}`,
      type: 'stale_source',
      company: c.company,
      priority: 'info',
      title: f === 'error' ? `${c.label}: Verbindungsfehler` : `${c.label}: Datenstand zu alt`,
      body: f === 'error' ? (c.lastError ?? 'Die Quelle meldet einen Fehler.') : 'Der letzte erfolgreiche Abruf ist älter als 45 Minuten.',
      refs: [connectionRef(c.id, c.label)],
      nextStep: 'Verbindung prüfen',
      needsSources: [],
    });
  }
  return out;
}
