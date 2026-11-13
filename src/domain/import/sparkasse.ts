import { normalizeIban } from '@/domain/matching/payments';
import type { IsoDate } from '@/domain/types';
import { IMPORT_SINCE, type ImportedPayment } from './batch';
import { splitCsv } from './portal-list';

export type SkipReason = 'expense' | 'pending' | 'currency' | 'before_since' | 'unreadable';
export interface SparkasseResult {
  format: 'csv' | 'camt';
  payments: ImportedPayment[];
  skipped: { reason: SkipReason; count: number }[];
  from: IsoDate | null;
  to: IsoDate | null;
  account: string | null;
}
export type SparkasseParse = ({ ok: true } & SparkasseResult) | { ok: false; error: string };

export const NOT_SPARKASSE = 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).';

// gegen echte Datei prüfen: Buchungstexte, die eine Rückbuchung kennzeichnen (Teilstring, klein geschrieben).
export const RETURN_TEXTS: readonly string[] = ['retoure', 'rücklastschrift', 'ruecklastschrift', 'rückbuchung', 'rueckbuchung', 'rückgabe', 'rueckgabe'];
// gegen echte Datei prüfen: Bank-Transaktionscodes für Rückgaben in CAMT.053 (Task 4).
export const RETURN_BANK_CODES: readonly string[] = [];
// gegen echte Datei prüfen: Spaltennamen der Sparkassen-CSV (CSV-CAMT V2).
export const CSV_COLUMNS = {
  account: 'Auftragskonto', booked: 'Buchungstag', text: 'Buchungstext', reference: 'Verwendungszweck',
  name: 'Beguenstigter/Zahlungspflichtiger', iban: 'Kontonummer/IBAN', amount: 'Betrag', currency: 'Waehrung', info: 'Info',
};
const SKIP_ORDER: SkipReason[] = ['expense', 'pending', 'currency', 'before_since', 'unreadable'];

// FNV-1a 64 Bit; Ziel ES2017, daher BigInt(...) statt 0n-Literalen.
const FNV_OFFSET = BigInt('0xcbf29ce484222325');
const FNV_PRIME = BigInt('0x100000001b3');
const MASK = BigInt('0xffffffffffffffff');

export function fnv1a64(text: string): string {
  let h = FNV_OFFSET;
  for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK;
  return h.toString(16).padStart(16, '0');
}

export const normalizeReference = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** Formatunabhängiger Importschlüssel (CSV und CAMT): Datum | Cent | IBAN | Zweck | laufende Nummer. */
export function statementKey(b: { bookedOn: IsoDate; amountCents: number; iban: string; reference: string }, seq: number): string {
  return 'spk-' + fnv1a64([b.bookedOn, b.amountCents, normalizeIban(b.iban), normalizeReference(b.reference), seq].join('|'));
}

/**
 * Laufende Nummer je Datei und gleicher Basis (Datum, Cent, IBAN, Zweck), in Dateireihenfolge ab 0.
 * Annahme: Exporte enthalten immer ganze Buchungstage (Spec 4.7); Abnahme prüft das.
 */
export function createKeyer(): (b: { bookedOn: IsoDate; amountCents: number; iban: string; reference: string }) => string {
  const seen = new Map<string, number>();
  return (b) => {
    const base = [b.bookedOn, b.amountCents, normalizeIban(b.iban), normalizeReference(b.reference)].join('|');
    const seq = seen.get(base) ?? 0;
    seen.set(base, seq + 1);
    return statementKey(b, seq);
  };
}

export function parseDeAmountCents(s: string): number | null {
  const m = /^([+-])?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const euros = parseInt(m[2].replace(/\./g, ''), 10);
  const cents = m[3] === undefined ? 0 : parseInt(m[3].padEnd(2, '0'), 10);
  const total = euros * 100 + cents;
  if (!Number.isSafeInteger(total)) return null;
  return m[1] === '-' ? -total : total;
}

export function parseDeDate(s: string): IsoDate | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${m[2]}-${m[1]}`;
}

const headKey = (s: string): string => s.replace(/"/g, '').trim().toLowerCase();

/** null = Kopfzeile nicht erkannt. */
export function parseSparkasseCsv(text: string): SparkasseResult | null {
  const rows = splitCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return null;
  const head = rows[0].map(headKey);
  const col = (name: string): number => head.indexOf(headKey(name));
  const idx = Object.fromEntries(Object.entries(CSV_COLUMNS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof CSV_COLUMNS, number>;
  if (idx.booked < 0 || idx.reference < 0 || idx.name < 0 || idx.iban < 0 || idx.amount < 0) return null;

  const cell = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? '').trim() : '');
  const counts: Record<SkipReason, number> = { expense: 0, pending: 0, currency: 0, before_since: 0, unreadable: 0 };
  const payments: ImportedPayment[] = [];
  const key = createKeyer();
  let from: IsoDate | null = null, to: IsoDate | null = null, account: string | null = null;

  rows.slice(1).forEach((r, n) => {
    if (n === 0) account = cell(r, idx.account) ? normalizeIban(cell(r, idx.account)) : null;
    const bookedOn = parseDeDate(cell(r, idx.booked));
    if (bookedOn) {
      if (from === null || bookedOn < from) from = bookedOn;
      if (to === null || bookedOn > to) to = bookedOn;
    }
    const amountCents = parseDeAmountCents(cell(r, idx.amount));
    const currency = cell(r, idx.currency);
    if (cell(r, idx.info).toLowerCase().includes('vorgemerkt')) return void counts.pending++;
    if (currency !== '' && currency.toUpperCase() !== 'EUR') return void counts.currency++;
    if (!bookedOn || amountCents === null) return void counts.unreadable++;
    const isReturn = RETURN_TEXTS.some((t) => cell(r, idx.text).toLowerCase().includes(t));
    if (amountCents < 0 && !isReturn) return void counts.expense++;
    if (bookedOn < IMPORT_SINCE) return void counts.before_since++;
    const iban = normalizeIban(cell(r, idx.iban));
    const reference = cell(r, idx.reference);
    payments.push({
      company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming',
      externalId: key({ bookedOn, amountCents, iban, reference }), amountCents, bookedOn,
      payerName: cell(r, idx.name), iban, reference,
    });
  });

  return {
    format: 'csv', payments, from, to, account,
    skipped: SKIP_ORDER.filter((reason) => counts[reason] > 0).map((reason) => ({ reason, count: counts[reason] })),
  };
}
