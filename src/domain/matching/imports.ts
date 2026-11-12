import type { ConnectionId } from '@/domain/types';

type Importable = { connectionId: ConnectionId | null; externalId: string };

export function importKey(x: Importable): string {
  return `${x.connectionId}:${x.externalId}`;
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
