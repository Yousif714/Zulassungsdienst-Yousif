/** Gruppierung von Nachrichten wie in iMessage (rein, ohne React). */

export type Side = 'in' | 'out';

/** Neue Gruppe ab diesem Abstand zwischen zwei Nachrichten (wie iMessage, ~15 Min.). */
const GROUP_GAP_MS = 15 * 60_000;

export type Placed<T> = { item: T; side: Side; tail: boolean; stamp: boolean; first: boolean };

/**
 * Ordnet Nachrichten in Gruppen: aufeinanderfolgend von derselben Seite und ohne große Pause.
 * `tail` = letzte Blase der Gruppe, `stamp` = Zeitstempel davor. `side` null = Systemzeile (eigene Gruppe).
 */
export function placeMessages<T>(items: T[], side: (m: T) => Side | null, at: (m: T) => string | undefined): Placed<T>[] {
  return items.map((item, i) => {
    const s = side(item);
    const prev = items[i - 1];
    const next = items[i + 1];
    const gap = (a?: T, b?: T) => {
      const ta = a && at(a);
      const tb = b && at(b);
      return !!ta && !!tb && Math.abs(Date.parse(tb) - Date.parse(ta)) > GROUP_GAP_MS;
    };
    const stamp = i === 0 || gap(prev, item);
    const first = stamp || !prev || side(prev) !== s;
    const tail = !next || side(next) !== s || gap(item, next);
    return { item, side: s ?? 'in', tail, stamp, first };
  });
}
