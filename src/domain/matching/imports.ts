import type { ConnectionId } from '@/domain/types';

type Importable = { connectionId: ConnectionId | null; externalId: string };

export function importKey(x: Importable): string {
  return `${x.connectionId}:${x.externalId}`;
}

/**
 * Mischt Importe in den Bestand: bekannter Schlüssel → `build(next, old)` mit alter ID an gleicher Position,
 * unbekannter → `build(next, null)` mit neuer ID hinten dran.
 */
export function upsertImported<T extends Importable & { id: string }, I extends Importable>(
  existing: T[],
  incoming: I[],
  build: (next: I, old: T | null) => Omit<T, 'id'>,
  newId: () => string,
): { items: T[]; added: number } {
  const items = [...existing];
  const index = new Map(items.map((x, i) => [importKey(x), i]));
  let added = 0;
  for (const next of incoming) {
    const key = importKey(next);
    const at = index.get(key);
    if (at !== undefined) {
      const old = items[at];
      items[at] = { ...build(next, old), id: old.id } as T;
    } else {
      index.set(key, items.length);
      items.push({ ...build(next, null), id: newId() } as T);
      added++;
    }
  }
  return { items, added };
}

/** Bestehende Einträge gewinnen; nur unbekannte Schlüssel kommen dazu. */
export function mergeImported<T extends Importable>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map(importKey));
  const result = [...existing];
  for (const item of incoming) {
    const key = importKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
