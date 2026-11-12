import 'server-only';
import { createEmptyState } from '@/data/empty-state';
import type { AppState } from '@/domain/types';

export type Row = { id: string; data: unknown; connection_id?: string | null; external_id?: string | null; dedupe_key?: string };

type ArrayKey = 'connections' | 'contacts' | 'contracts' | 'payments' | 'invoices' | 'messages' | 'commitments' | 'events' | 'calls' | 'content' | 'vehicles' | 'jobs' | 'actions';
const SIMPLE: ArrayKey[] = ['connections', 'contacts', 'contracts', 'payments', 'invoices', 'messages', 'commitments', 'events', 'calls', 'content', 'vehicles', 'jobs', 'actions'];
const WITH_EXTERNAL = new Set<ArrayKey>(['payments', 'invoices', 'messages', 'events']);

/** AppState-Schlüssel → Tabelle (job_runs läuft ausschließlich über claimJobRun). */
export const TABLES = {
  connections: 'connections', contacts: 'contacts', contracts: 'contracts', payments: 'payments', invoices: 'invoices',
  messages: 'messages', commitments: 'commitments', events: 'events', calls: 'calls', content: 'content', vehicles: 'vehicles',
  jobs: 'jobs', actions: 'actions', insights: 'insights', assistantChat: 'assistant_messages', allocations: 'allocations',
  ibanLinks: 'iban_links', exceptions: 'contract_exceptions', audit: 'audit', settings: 'settings',
} as const;
export type TableName = (typeof TABLES)[keyof typeof TABLES];
const TABLE_NAMES = [...new Set(Object.values(TABLES))] as TableName[];

export type ChangeSet = Record<TableName, { upsert: Row[]; delete: string[] }>;

const auditId = (i: number) => String(i).padStart(8, '0');
type Loose = Record<string, unknown>;

function emptyRows(): Record<TableName, Row[]> {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;
}

export function toRows(s: AppState): Record<TableName, Row[]> {
  const r = emptyRows();
  for (const k of SIMPLE) {
    r[TABLES[k]] = (s[k] as unknown as Loose[]).map((x) => {
      const row: Row = { id: x.id as string, data: x };
      if (WITH_EXTERNAL.has(k)) {
        row.connection_id = (x.connectionId as string | undefined) ?? null;
        row.external_id = (x.externalId as string | undefined) ?? null;
      }
      return row;
    });
  }
  r.insights = s.insights.map((x) => ({ id: x.dedupeKey, data: x, dedupe_key: x.dedupeKey }));
  r.assistant_messages = s.assistantChat.map((x) => ({ id: x.id, data: x }));
  const seen = new Map<string, number>();
  r.allocations = s.allocations.map((x) => {
    const pair = `${x.paymentId}:${x.contractId}`;
    const n = seen.get(pair) ?? 0;
    seen.set(pair, n + 1);
    return { id: `${pair}:${n}`, data: x };
  });
  r.iban_links = s.ibanLinks.map((x) => ({ id: x.iban, data: x }));
  r.contract_exceptions = Object.entries(s.exceptions).map(([id, data]) => ({ id, data }));
  r.audit = s.audit.map((x, i) => ({ id: auditId(i), data: x }));
  r.settings = [{ id: 'owner', data: s.settings }];
  return r;
}

export function fromRows(r: Partial<Record<TableName, Row[]>>, jobRunKeys: string[]): AppState {
  const s = createEmptyState();
  const out = s as unknown as Loose;
  for (const k of SIMPLE) if (r[TABLES[k]]) out[k] = r[TABLES[k]]!.map((x) => x.data);
  if (r.insights) s.insights = r.insights.map((x) => x.data as AppState['insights'][number]);
  if (r.assistant_messages) s.assistantChat = r.assistant_messages.map((x) => x.data as AppState['assistantChat'][number]);
  if (r.allocations) s.allocations = r.allocations.map((x) => x.data as AppState['allocations'][number]);
  if (r.iban_links) s.ibanLinks = r.iban_links.map((x) => x.data as AppState['ibanLinks'][number]);
  if (r.contract_exceptions) s.exceptions = Object.fromEntries(r.contract_exceptions.map((x) => [x.id, x.data])) as AppState['exceptions'];
  if (r.audit) s.audit = [...r.audit].sort((a, b) => a.id.localeCompare(b.id)).map((x) => x.data as AppState['audit'][number]);
  const settings = r.settings?.find((x) => x.id === 'owner');
  if (settings) s.settings = settings.data as AppState['settings'];
  s.jobRuns = [...jobRunKeys];
  return s;
}

export function diffState(prev: AppState, next: AppState): ChangeSet {
  const a = toRows(prev);
  const b = toRows(next);
  const out = {} as ChangeSet;
  for (const t of TABLE_NAMES) {
    const old = new Map(a[t].map((x) => [x.id, JSON.stringify(x)]));
    const upsert = b[t].filter((x) => old.get(x.id) !== JSON.stringify(x));
    const keep = new Set(b[t].map((x) => x.id));
    out[t] = { upsert, delete: a[t].filter((x) => !keep.has(x.id)).map((x) => x.id) };
  }
  return out;
}
