import 'server-only';
import { createEmptyState } from '@/data/empty-state';
import { migrateState } from '@/domain/migrate';
import type { AppState } from '@/domain/types';

/** `ord` = Position im AppState-Array; die Persistenz muss danach sortieren (kein impliziter Tabellenreihenfolge-Vertrag). */
export type Row = { id: string; ord: number; data: unknown; connection_id?: string | null; external_id?: string | null; dedupe_key?: string };

type ArrayKey = 'connections' | 'contacts' | 'contracts' | 'payments' | 'invoices' | 'messages' | 'commitments' | 'events' | 'calls' | 'content' | 'vehicles' | 'jobs' | 'actions' | 'subscriptions' | 'portalMembers' | 'orderConfirmations' | 'invoiceReadings';
const SIMPLE: ArrayKey[] = ['connections', 'contacts', 'contracts', 'payments', 'invoices', 'messages', 'commitments', 'events', 'calls', 'content', 'vehicles', 'jobs', 'actions', 'subscriptions', 'portalMembers', 'orderConfirmations', 'invoiceReadings'];

/** AppState-Schlüssel → Tabelle (job_runs läuft ausschließlich über claimJobRun). */
export const TABLES = {
  connections: 'connections', contacts: 'contacts', contracts: 'contracts', payments: 'payments', invoices: 'invoices',
  messages: 'messages', commitments: 'commitments', events: 'events', calls: 'calls', content: 'content', vehicles: 'vehicles',
  jobs: 'jobs', actions: 'actions', insights: 'insights', assistantChat: 'assistant_messages', allocations: 'allocations',
  ibanLinks: 'iban_links', exceptions: 'contract_exceptions', audit: 'audit', settings: 'settings',
  subscriptions: 'subscriptions', dismissedProposals: 'dismissed_proposals',
  portalMembers: 'portal_members', ignoredPortalMembers: 'ignored_portal_members',
  orderConfirmations: 'order_confirmations',
  invoiceReadings: 'invoice_readings',
} as const;
export type TableName = (typeof TABLES)[keyof typeof TABLES];
/** Tabellen mit Schlüsselspalten connection_id/external_id (eindeutig je Quelle). */
export const WITH_EXTERNAL_TABLES: ReadonlySet<TableName> = new Set<TableName>(['payments', 'invoices', 'messages', 'events', 'subscriptions', 'portal_members', 'order_confirmations']);
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
    r[TABLES[k]] = (s[k] as unknown as Loose[]).map((x, i) => {
      const row: Row = { id: x.id as string, ord: i, data: x };
      if (WITH_EXTERNAL_TABLES.has(TABLES[k])) {
        row.connection_id = (x.connectionId as string | undefined) ?? null;
        row.external_id = (x.externalId as string | undefined) ?? null;
      }
      return row;
    });
  }
  r.insights = s.insights.map((x, i) => ({ id: x.dedupeKey, ord: i, data: x, dedupe_key: x.dedupeKey }));
  r.assistant_messages = s.assistantChat.map((x, i) => ({ id: x.id, ord: i, data: x }));
  const seen = new Map<string, number>();
  r.allocations = s.allocations.map((x, i) => {
    const pair = `${x.paymentId}:${x.contractId ?? `inv:${x.invoiceId}`}`;
    const n = seen.get(pair) ?? 0;
    seen.set(pair, n + 1);
    return { id: `${pair}:${n}`, ord: i, data: x };
  });
  r.iban_links = s.ibanLinks.map((x, i) => ({ id: `${x.iban}:${x.contactId}`, ord: i, data: x }));
  r.contract_exceptions = Object.entries(s.exceptions).map(([id, data], i) => ({ id, ord: i, data }));
  r.audit = s.audit.map((x, i) => ({ id: auditId(i), ord: i, data: x }));
  r.dismissed_proposals = s.dismissedProposals.map((x, i) => ({ id: x, ord: i, data: x }));
  r.ignored_portal_members = s.ignoredPortalMembers.map((x, i) => ({ id: x, ord: i, data: x }));
  r.settings = [{ id: 'owner', ord: 0, data: s.settings }];
  return r;
}

export function fromRows(input: Partial<Record<TableName, Row[]>>): AppState {
  const r: Partial<Record<TableName, Row[]>> = {};
  for (const [k, v] of Object.entries(input) as [TableName, Row[]][]) r[k] = [...v].sort((x, y) => x.ord - y.ord);
  const s = createEmptyState();
  const out = s as unknown as Loose;
  for (const k of SIMPLE) if (r[TABLES[k]]) out[k] = r[TABLES[k]]!.map((x) => x.data);
  if (r.insights) s.insights = r.insights.map((x) => x.data as AppState['insights'][number]);
  if (r.assistant_messages) s.assistantChat = r.assistant_messages.map((x) => x.data as AppState['assistantChat'][number]);
  if (r.allocations) s.allocations = r.allocations.map((x) => x.data as AppState['allocations'][number]);
  if (r.iban_links) s.ibanLinks = r.iban_links.map((x) => x.data as AppState['ibanLinks'][number]);
  if (r.contract_exceptions) s.exceptions = Object.fromEntries(r.contract_exceptions.map((x) => [x.id, x.data])) as AppState['exceptions'];
  if (r.audit) s.audit = r.audit.map((x) => x.data as AppState['audit'][number]);
  if (r.dismissed_proposals) s.dismissedProposals = r.dismissed_proposals.map((x) => x.data as string);
  if (r.ignored_portal_members) s.ignoredPortalMembers = r.ignored_portal_members.map((x) => x.data as string);
  const settings = r.settings?.find((x) => x.id === 'owner');
  if (settings) s.settings = settings.data as AppState['settings'];
  // Frische Datenbank oder neuer Katalog-Eintrag: jede bekannte Verbindung existiert immer (sonst fehlen
  // Einrichtungs-Checkliste und „Noch nichts verbunden“).
  // Erst migrieren (bank → bank_qonto), sonst entstünde bank_qonto doppelt.
  const m = migrateState(s);
  const known = new Set(m.connections.map((c) => c.id));
  const connections = [...m.connections, ...createEmptyState().connections.filter((c) => !known.has(c.id))];
  return { ...m, connections };
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
