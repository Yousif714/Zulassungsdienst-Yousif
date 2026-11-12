import 'server-only';
import type { AuthRepository, Repos, StateRepository, StoredPasskey } from './repository';
import { fromRows, type Row, type TableName } from './tables';

/** In-Memory-Implementierung (Demo, Tests). Alle Methoden laufen synchron im Kern und sind daher atomar. */
export function createMemoryRepos(): Repos {
  const tables = new Map<TableName, Map<string, Row>>();
  const jobRuns = new Set<string>();
  let revision = 0;

  const state: StateRepository = {
    async load() {
      const rows: Partial<Record<TableName, Row[]>> = {};
      for (const [t, m] of tables) rows[t] = [...m.values()];
      return { state: structuredClone(fromRows(rows, [...jobRuns])), revision };
    },
    async save(changes, expectedRevision) {
      if (expectedRevision !== revision) return { ok: false, reason: 'conflict' };
      for (const [t, c] of Object.entries(changes) as [TableName, { upsert: Row[]; delete: string[] }][]) {
        if (!c.upsert.length && !c.delete.length) continue;
        const m = tables.get(t) ?? new Map<string, Row>();
        for (const id of c.delete) m.delete(id);
        for (const row of c.upsert) m.set(row.id, structuredClone(row));
        tables.set(t, m);
      }
      revision += 1;
      return { ok: true, revision };
    },
    async claimJobRun(key) {
      if (jobRuns.has(key)) return false;
      jobRuns.add(key);
      return true;
    },
  };

  let passkeys: StoredPasskey[] = [];
  let codes = new Map<string, Date | null>();
  const auth: AuthRepository = {
    async passkeyCount() { return passkeys.length; },
    async listPasskeys() { return structuredClone(passkeys); },
    async addFirstPasskey(p) {
      if (passkeys.length > 0) return false;
      passkeys = [structuredClone(p)];
      return true;
    },
    async addPasskey(p) { passkeys.push(structuredClone(p)); },
    async updateCounter(id, counter) {
      const p = passkeys.find((x) => x.id === id);
      if (p) p.counter = counter;
    },
    async replaceRecoveryCodes(hashes) { codes = new Map(hashes.map((h) => [h, null])); },
    async consumeRecoveryCode(hash, at) {
      if (!codes.has(hash) || codes.get(hash) !== null) return false;
      codes.set(hash, at);
      return true;
    },
  };
  return { state, auth };
}
