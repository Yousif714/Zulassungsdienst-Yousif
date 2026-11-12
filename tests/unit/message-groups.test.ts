import { describe, expect, test } from 'vitest';
import { placeMessages } from '@/components/message-groups';

type M = { side: 'in' | 'out' | null; at: string };
const at = (min: number) => new Date(Date.UTC(2026, 10, 12, 8, min)).toISOString();
const place = (ms: M[]) => placeMessages(ms, (m) => m.side, (m) => m.at).map(({ side, tail, stamp, first }) => ({ side, tail, stamp, first }));

describe('placeMessages', () => {
  test('Gruppe = gleiche Seite hintereinander; Schwänzchen nur an der letzten Blase; Zeitstempel nur am Anfang', () => {
    expect(place([{ side: 'out', at: at(0) }, { side: 'in', at: at(1) }, { side: 'in', at: at(2) }, { side: 'out', at: at(3) }])).toEqual([
      { side: 'out', tail: true, stamp: true, first: true },
      { side: 'in', tail: false, stamp: false, first: true },
      { side: 'in', tail: true, stamp: false, first: false },
      { side: 'out', tail: true, stamp: false, first: true },
    ]);
  });

  test('mehr als 15 Minuten Pause: neue Gruppe mit Zeitstempel, auch auf derselben Seite', () => {
    expect(place([{ side: 'in', at: at(0) }, { side: 'in', at: at(16) }])).toEqual([
      { side: 'in', tail: true, stamp: true, first: true },
      { side: 'in', tail: true, stamp: true, first: true },
    ]);
  });

  test('Systemzeile (null) trennt Gruppen', () => {
    const r = place([{ side: 'in', at: at(0) }, { side: null, at: at(1) }, { side: 'in', at: at(2) }]);
    expect(r.map((x) => [x.tail, x.first])).toEqual([[true, true], [true, true], [true, true]]);
  });
});
