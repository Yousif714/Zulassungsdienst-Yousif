import { sourceFreshness } from '../freshness';
import { shortDateDe } from '../import/statement';
import type { AppState, Insight } from '../types';
import { connectionRef } from './refs';

export function detectStaleSources(s: AppState, now: Date): Insight[] {
  const out: Insight[] = [];
  for (const c of s.connections) {
    const f = sourceFreshness(c, now);
    if (f !== 'error' && f !== 'stale') continue;
    if (c.id === 'bank_sparkasse' && f === 'stale') {
      const cursor = c.sync?.cursor;
      out.push({
        dedupeKey: `stale:${c.id}`,
        type: 'stale_source',
        company: 'zulassung',
        priority: 'info',
        title: 'Sparkasse-Auszug ist älter als 7 Tage – neuen hochladen',
        body: `${cursor ? `Letzter Auszug bis ${shortDateDe(cursor)} ` : ''}Neuen Export (CAMT oder CSV) hochladen.`,
        refs: [connectionRef(c.id, c.label)],
        nextStep: 'Verbindung prüfen',
        needsSources: [],
      });
      continue;
    }
    // Echte Abgleiche melden einen Fehler erst nach 3 Fehlversuchen; die Demo-Störung (ohne `sync`) sofort.
    if (f === 'error' && c.sync !== undefined && c.sync.failures < 3) continue;
    out.push({
      dedupeKey: `stale:${c.id}`,
      type: 'stale_source',
      company: c.company,
      priority: 'info',
      title: f === 'error' ? `${c.label}: Verbindungsfehler` : `${c.label}: Datenstand zu alt`,
      body: f === 'error' ? (c.lastError ?? 'Die Quelle meldet einen Fehler.') : c.id === 'portal_nexus' ? 'Die Mitgliederliste ist älter als 30 Tage. Bitte neu einfügen.' : 'Der letzte erfolgreiche Abruf ist älter als 45 Minuten.',
      refs: [connectionRef(c.id, c.label)],
      nextStep: 'Verbindung prüfen',
      needsSources: [],
    });
  }
  return out;
}
