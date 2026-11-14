import { berlinLocalToUtc, formatIsoDe } from '../clock';
import { monthDate } from '../ledger/schedule';
import type { Installment, IsoDate, StripeTakeover } from '../types';

/** Eine Phase des Stripe-Zeitplans. Ende per Monatsdauer oder festem Datum; `trial` = Lücke ohne Abbuchung. */
export type TakeoverPhase = { start: IsoDate | 'now'; end: { months: number } | { date: IsoDate }; amountCents: number; trial?: true };

function plusMonths(start: IsoDate, months: number): IsoDate {
  const [y, m, d] = start.split('-').map(Number);
  return monthDate(y, m - 1 + months, d);
}

/**
 * Phasen für den Zeitplan: Überfälliges sofort, dann gleich hohe Raten im exakten Monatsabstand je Phase.
 * Kommt der nächste Lauf früher als das natürliche Ende, endet die letzte Rate per Datum; kommt er später, füllt eine Lücken-Phase.
 */
export function schedulePhases(rates: Installment[], today: IsoDate): TakeoverPhase[] {
  const sorted = [...rates].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.no - b.no));
  const past = sorted.filter((r) => r.dueDate <= today);
  const future = sorted.filter((r) => r.dueDate > today);
  const out: TakeoverPhase[] = [];

  if (past.length > 0) {
    const amountCents = past.reduce((x, r) => x + r.amountCents, 0);
    out.push({ start: 'now', end: future.length > 0 ? { date: future[0].dueDate } : { months: 1 }, amountCents });
  }

  const runs: { start: IsoDate; len: number; amountCents: number }[] = [];
  for (let i = 0; i < future.length; ) {
    const first = future[i];
    let len = 1;
    while (
      i + len < future.length &&
      future[i + len].amountCents === first.amountCents &&
      future[i + len].dueDate === plusMonths(first.dueDate, len)
    ) len++;
    runs.push({ start: first.dueDate, len, amountCents: first.amountCents });
    i += len;
  }

  runs.forEach((run, k) => {
    const next = runs[k + 1];
    const naturalEnd = plusMonths(run.start, run.len);
    if (!next || next.start === naturalEnd) {
      out.push({ start: run.start, end: { months: run.len }, amountCents: run.amountCents });
    } else if (next.start < naturalEnd) {
      if (run.len > 1) out.push({ start: run.start, end: { months: run.len - 1 }, amountCents: run.amountCents });
      out.push({ start: plusMonths(run.start, run.len - 1), end: { date: next.start }, amountCents: run.amountCents });
    } else {
      out.push({ start: run.start, end: { months: run.len }, amountCents: run.amountCents });
      out.push({ start: naturalEnd, end: { date: next.start }, amountCents: next.amountCents, trial: true });
    }
  });
  return out;
}

/** Abschluss nur, wenn der offene Betrag noch genau dem freigegebenen Plan entspricht. */
export function checkCompletion(rates: Installment[], currentOpenCents: number, today: IsoDate): { ok: true; phases: TakeoverPhase[] } | { ok: false } {
  const sum = rates.reduce((x, r) => x + r.amountCents, 0);
  if (rates.length === 0 || currentOpenCents !== sum) return { ok: false };
  return { ok: true, phases: schedulePhases(rates, today) };
}

/** Phasenstart 07:00 Europe/Berlin am Fälligkeitstag, als Unix-Sekunden. */
export function phaseStartUnix(start: IsoDate | 'now'): number | 'now' {
  if (start === 'now') return 'now';
  return Math.floor(berlinLocalToUtc(start, '07:00').getTime() / 1000);
}

/** Ende der letzten Phase als Berlin-Kalendertag (`now` = heute). */
export function planEndDate(phases: TakeoverPhase[], today: IsoDate): IsoDate {
  const last = phases[phases.length - 1];
  if (!last) return today;
  if ('date' in last.end) return last.end.date;
  return plusMonths(last.start === 'now' ? today : last.start, last.end.months);
}

/** Preise (unit_amount) aller Phasen des Plans. */
export function planPrices(rates: Installment[], today: IsoDate): number[] {
  return schedulePhases(rates, today).map((p) => p.amountCents);
}

/** Was die öffentliche Seite zeigt: nur der Plan, kein Name, keine E-Mail. */
export function publicPlanView(t: Pick<StripeTakeover, 'rates'>, today: IsoDate): { count: number; rates: { label: string; amountCents: number }[]; first: string; last: string } {
  const rates = t.rates.map((r) => ({ label: r.dueDate <= today ? 'sofort' : formatIsoDe(r.dueDate), amountCents: r.amountCents }));
  return { count: rates.length, rates, first: rates[0]?.label ?? '', last: rates[rates.length - 1]?.label ?? '' };
}

/** Langer Zufallstoken aus zwei UUIDs (ohne Bindestriche, 64 Hex-Zeichen). */
export function takeoverToken(newId: () => string): string {
  return `${newId()}${newId()}`.replace(/-/g, '').toLowerCase();
}

export function paymentLinkUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/zahlung/${token}`;
}
