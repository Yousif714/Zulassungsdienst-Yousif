import { normalizeIban } from '@/domain/matching/payments';
import type { IsoDate } from '@/domain/types';
import { IMPORT_SINCE, type ImportedPayment } from './batch';
import { decodeListFile, splitCsv } from './portal-list';
import { attrOf, childText, elements, stripNamespaces } from './xml';

export type SkipReason = 'expense' | 'pending' | 'currency' | 'before_since' | 'unreadable' | 'zero';
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
export const RETURN_BANK_CODES: readonly string[] = ['RRTN', 'UPDD', 'RPCR', 'ARET', '109', '159'];
// gegen echte Datei prüfen: Spaltennamen der Sparkassen-CSV (CSV-CAMT V2).
export const CSV_COLUMNS = {
  account: 'Auftragskonto', booked: 'Buchungstag', text: 'Buchungstext', reference: 'Verwendungszweck',
  name: 'Beguenstigter/Zahlungspflichtiger', iban: 'Kontonummer/IBAN', amount: 'Betrag', currency: 'Waehrung', info: 'Info',
};
const SKIP_ORDER: SkipReason[] = ['expense', 'pending', 'currency', 'before_since', 'unreadable', 'zero'];

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
  return m[1] === '-' && total !== 0 ? -total : total;
}

export function parseDeDate(s: string): IsoDate | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${m[2]}-${m[1]}`;
}

/** Betrag mit Dezimalpunkt (CAMT): '640.00' → 64000, '0.5' → 50. Kein Vorzeichen, keine Tausendertrennung. */
export function parseDotAmountCents(s: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const total = parseInt(m[1], 10) * 100 + (m[2] === undefined ? 0 : parseInt(m[2].padEnd(2, '0'), 10));
  return Number.isSafeInteger(total) ? total : null;
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
  const counts: Record<SkipReason, number> = { expense: 0, pending: 0, currency: 0, before_since: 0, unreadable: 0, zero: 0 };
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
    if (amountCents === 0) return void counts.zero++;
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

// ---------------------------------------------------------------------------
// CAMT.053

const emptyCounts = (): Record<SkipReason, number> => ({ expense: 0, pending: 0, currency: 0, before_since: 0, unreadable: 0, zero: 0 });
const skippedList = (counts: Record<SkipReason, number>): SparkasseResult['skipped'] =>
  SKIP_ORDER.filter((reason) => counts[reason] > 0).map((reason) => ({ reason, count: counts[reason] }));

/** Rückbuchung: Storno-Kennzeichen oder Rückgabe-Code (SubFmlyCd bzw. Ziffern nach `+` im proprietären Code). */
function isCamtReturn(ntry: string): boolean {
  if (childText(ntry, ['RvslInd'])?.toLowerCase() === 'true') return true;
  const sub = childText(ntry, ['BkTxCd', 'Domn', 'Fmly', 'SubFmlyCd'])?.toUpperCase();
  if (sub && RETURN_BANK_CODES.includes(sub)) return true;
  const prtry = childText(ntry, ['BkTxCd', 'Prtry', 'Cd']);
  return !!prtry && prtry.split('+').slice(1).some((part) => RETURN_BANK_CODES.includes(part.trim().toUpperCase()));
}

const camtDate = (ntry: string): IsoDate | null => {
  const raw = childText(ntry, ['BookgDt', 'Dt']) ?? childText(ntry, ['BookgDt', 'DtTm'])?.slice(0, 10) ?? childText(ntry, ['ValDt', 'Dt']) ?? childText(ntry, ['ValDt', 'DtTm'])?.slice(0, 10);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? (raw as IsoDate) : null;
};

/** null = kein camt.053 (Document/BkToCstmrStmt fehlt). */
export function parseCamt053(xmlText: string): SparkasseResult | null {
  const xml = stripNamespaces(xmlText);
  if (elements(xml, 'Document').length === 0 || elements(xml, 'BkToCstmrStmt').length === 0) return null;
  const counts = emptyCounts();
  const payments: ImportedPayment[] = [];
  const key = createKeyer();
  let from: IsoDate | null = null, to: IsoDate | null = null, account: string | null = null;

  elements(xml, 'Stmt').forEach((stmt, n) => {
    if (n === 0) {
      const iban = childText(stmt, ['Acct', 'Id', 'IBAN']);
      account = iban ? normalizeIban(iban) : null;
    }
    for (const ntry of elements(stmt, 'Ntry')) {
      const bookedOn = camtDate(ntry);
      if (bookedOn) {
        if (from === null || bookedOn < from) from = bookedOn;
        if (to === null || bookedOn > to) to = bookedOn;
      }
      const txs = elements(ntry, 'TxDtls');
      const n = Math.max(txs.length, 1); // Anzahl der Zahlungen dieser Buchung (für Zähler)
      const credit = childText(ntry, ['CdtDbtInd']) === 'CRDT';
      if (childText(ntry, ['Sts'])?.toUpperCase() !== 'BOOK') { counts.pending += n; continue; }
      const isReturn = isCamtReturn(ntry);
      if (!credit && !isReturn) { counts.expense += n; continue; }
      if (!bookedOn) { counts.unreadable += n; continue; }
      if (txs.length === 0) { counts.unreadable++; continue; }
      for (const tx of txs) {
        const ccy = attrOf(tx, 'Amt', 'Ccy') ?? attrOf(ntry, 'Amt', 'Ccy');
        if (ccy !== undefined && ccy.toUpperCase() !== 'EUR') { counts.currency++; continue; }
        const rawAmount = childText(tx, ['Amt']) ?? (txs.length === 1 ? childText(ntry, ['Amt']) : undefined);
        const abs = rawAmount === undefined ? null : parseDotAmountCents(rawAmount);
        if (abs === null) { counts.unreadable++; continue; }
        if (abs === 0) { counts.zero++; continue; }
        if (bookedOn < IMPORT_SINCE) { counts.before_since++; continue; }
        const party = credit ? 'Dbtr' : 'Cdtr', acct = credit ? 'DbtrAcct' : 'CdtrAcct';
        const payerName = childText(tx, ['RltdPties', party, 'Nm']) ?? childText(tx, ['RltdPties', party, 'Pty', 'Nm']) ?? '';
        const iban = normalizeIban(childText(tx, ['RltdPties', acct, 'Id', 'IBAN']) ?? '');
        const reference = elements(tx, 'Ustrd').map((u) => childText(u, []) ?? '').filter((u) => u !== '').join(' ');
        const amountCents = credit ? abs : -abs;
        payments.push({
          company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming',
          externalId: key({ bookedOn, amountCents, iban, reference }), amountCents, bookedOn, payerName, iban, reference,
        });
      }
    }
  });

  return { format: 'camt', payments, from, to, account, skipped: skippedList(counts) };
}

/** Überlappende Dateien: gleiche Buchung (gleicher Schlüssel) nur einmal, die erste gewinnt. */
function dedupeByExternalId(payments: ImportedPayment[]): ImportedPayment[] {
  const seen = new Set<string>();
  return payments.filter((p) => (seen.has(p.externalId) ? false : (seen.add(p.externalId), true)));
}

/** Dateien (CSV oder CAMT-XML, ggf. aus einem ZIP entpackt) lesen und zusammenführen. */
export function parseSparkasse(files: { name: string; bytes: Uint8Array }[]): SparkasseParse {
  if (files.length === 0) return { ok: false, error: NOT_SPARKASSE };
  const results: SparkasseResult[] = [];
  for (const f of files) {
    const text = decodeListFile(f.bytes);
    const r = text.trimStart().startsWith('<') ? parseCamt053(text) : parseSparkasseCsv(text);
    if (!r) return { ok: false, error: NOT_SPARKASSE };
    results.push(r);
  }
  const counts = emptyCounts();
  for (const r of results) for (const s of r.skipped) counts[s.reason] += s.count;
  const dates = (pick: 'from' | 'to') => results.map((r) => r[pick]).filter((d): d is IsoDate => d !== null);
  const froms = dates('from'), tos = dates('to');
  return {
    ok: true, format: results[0].format, account: results[0].account,
    payments: dedupeByExternalId(results.flatMap((r) => r.payments)),
    skipped: skippedList(counts),
    from: froms.length ? froms.reduce((a, b) => (b < a ? b : a)) : null,
    to: tos.length ? tos.reduce((a, b) => (b > a ? b : a)) : null,
  };
}
