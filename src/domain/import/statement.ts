import { buildMatchContext } from '@/domain/detectors/payments';
import { matchBankPayment } from '@/domain/matching/payments';
import type { AppState, IsoDate, Payment } from '@/domain/types';
import { IMPORT_SINCE } from './batch';
import type { SkipReason, SparkasseResult } from './sparkasse';

/** 'DE00360501050000009999' → 'DE00 … 9999' */
export const maskIban = (iban: string): string => (iban.length > 8 ? `${iban.slice(0, 4)} … ${iban.slice(-4)}` : iban);

/** '2026-11-03' → '03.11.' */
export const shortDateDe = (d: IsoDate): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;

export interface StatementPreview {
  bookings: number; fresh: number; existing: number; skipped: { reason: SkipReason; count: number }[]; from: IsoDate | null; to: IsoDate | null; account: string | null;
  batchBookings: number;
  /** Übernehmen möglich: lesbarer Zeitraum (Dateiende ab Importbeginn); auch ohne neue Zahlungen setzt das den Stand. */
  takeable: boolean;
}

const keyOf = (externalId: string) => `bank_sparkasse:${externalId}`;

export function previewStatement(r: SparkasseResult, existing: Payment[]): StatementPreview {
  const known = new Set(existing.map((p) => `${p.connectionId}:${p.externalId}`));
  const ids = new Set(r.payments.map((p) => p.externalId));
  const present = [...ids].filter((id) => known.has(keyOf(id))).length;
  return { bookings: ids.size, fresh: ids.size - present, existing: present, skipped: r.skipped, from: r.from, to: r.to, account: r.account, batchBookings: r.batchBookings, takeable: r.to !== null && r.to >= IMPORT_SINCE };
}

const SKIP_TEXT: Record<SkipReason, [string, string]> = {
  expense: ['Ausgabe', 'Ausgaben'],
  pending: ['vorgemerkte Buchung', 'vorgemerkte Buchungen'],
  currency: ['Fremdwährung', 'Fremdwährungen'],
  before_since: ['Buchung vor Importbeginn', 'Buchungen vor Importbeginn'],
  unreadable: ['unlesbare Zeile', 'unlesbare Zeilen'],
  zero: ['Buchung ohne Betrag', 'Buchungen ohne Betrag'],
};

export const BATCH_HINT = 'Enthält Sammelbuchungen – für denselben Zeitraum immer dasselbe Format (CSV oder CAMT) hochladen.';

export function previewText(p: StatementPreview): string[] {
  const lines = [`${p.bookings} ${p.bookings === 1 ? 'Buchung' : 'Buchungen'} · ${p.fresh} neu · ${p.existing} schon vorhanden`];
  const meta: string[] = [];
  if (p.from && p.to) meta.push(`Zeitraum ${shortDateDe(p.from)}–${shortDateDe(p.to)}`);
  if (p.account) meta.push(`Konto ${maskIban(p.account)}`);
  if (meta.length) lines.push(meta.join(' · '));
  const skipped = p.skipped.filter((x) => x.count > 0).map((x) => `${x.count} ${SKIP_TEXT[x.reason][x.count === 1 ? 0 : 1]}`);
  if (skipped.length) lines.push(`übersprungen: ${skipped.join(', ')}`);
  if (p.batchBookings > 0) lines.push(BATCH_HINT);
  return lines;
}

export interface StatementSummary { fresh: number; auto: number; toConfirm: number; noMatch: number }

/** Einteilung der neuen Zahlungen nach der Übernahme: automatisch zugeordnet, Vorschlag oder ohne Treffer. */
export function statementSummary(s: AppState, newPaymentIds: string[], at: Date): StatementSummary {
  const out: StatementSummary = { fresh: newPaymentIds.length, auto: 0, toConfirm: 0, noMatch: 0 };
  const ids = new Set(newPaymentIds);
  const ctx = buildMatchContext(s, at, 'zulassung');
  for (const p of s.payments) {
    if (!ids.has(p.id) || p.amountCents <= 0) continue;
    if (s.allocations.some((a) => a.paymentId === p.id)) out.auto++;
    else if (matchBankPayment(p, ctx).confidence === 'medium') out.toConfirm++;
    else out.noMatch++;
  }
  return out;
}

export const summaryText = (x: StatementSummary): string =>
  `${x.fresh} neu · ${x.auto} automatisch zugeordnet · ${x.toConfirm} zum Bestätigen · ${x.noMatch} ohne Treffer`;
