import { berlinParts, daysBetween, formatIsoDe, type IsoDate } from '../clock';
import { invoiceRef, membershipContractOf, sourceInvoiceOf } from '../ledger/contracts';
import { coveringContract } from '../ledger/receivables';
import { formatEuro } from '../money';
import type { AppState, ContractKind, Invoice, InvoiceReadResult, InvoiceReading, MemberContract } from '../types';
import { validDate, validateContractDraft } from './contract-draft';
import { MONTH_END, proposalId, type ContractProposal, type ProposalValues } from './proposals';

export const READ_LIMITS = { maxPerRun: 5, budgetMs: 15_000, minInstallments: 2, maxInstallments: 36, daysBefore: 60, daysAfter: 365, maxAttempts: 3 } as const;
/** Quelle: claude-api-Skill, Modelltabelle Stand 2026-11-03 (Claude Opus 5.5: 4 $ / 20 $ je 1 Mio. Token). 1 $ wird als 1 € gezählt (vorsichtig). */
export const READ_PRICE = { model: 'claude-opus-5-5', inputMicroCentsPerToken: 400, outputMicroCentsPerToken: 2000, currency: 'USD' } as const;
/** 100 € je Kalendermonat Europe/Berlin (1 Cent = 1 000 000 Mikrocent). */
export const MONTHLY_LIMIT_MICRO_CENTS = 10_000_000_000;
export const MONTHLY_LIMIT_CENTS = MONTHLY_LIMIT_MICRO_CENTS / 1_000_000;

export const READ_HINT = {
  notCertain: 'Claude ist unsicher',
  sumMismatch: 'Raten ergeben nicht die Rechnungssumme',
  schema: 'Plan passt nicht ins Monatsraten-Schema',
  noContact: 'Rechnung hat keinen NEXUS-Kontakt',
  hasMembership: 'Kontakt hat schon einen Mitgliedsvertrag',
  lexwarePartial: 'Teilzahlung nur in Lexware ausgeglichen – bitte prüfen',
  incomplete: 'Angaben unvollständig – bitte ergänzen',
} as const;

export const costMicroCents = (u: { inputTokens: number; outputTokens: number }): number =>
  u.inputTokens * READ_PRICE.inputMicroCentsPerToken + u.outputTokens * READ_PRICE.outputMicroCentsPerToken;

const berlinMonth = (d: Date): string => berlinParts(d).date.slice(0, 7);

export function monthCostMicroCents(s: AppState, at: Date): number {
  const m = berlinMonth(at);
  return (s.invoiceReadings ?? []).filter((r) => berlinMonth(new Date(r.readAt)) === m).reduce((n, r) => n + r.costMicroCents, 0);
}

export const limitReached = (s: AppState, at: Date, extraMicroCents = 0): boolean =>
  monthCostMicroCents(s, at) + extraMicroCents >= MONTHLY_LIMIT_MICRO_CENTS;

export const readingProposalId = (inv: Pick<Invoice, 'externalId'>): string => proposalId([invoiceRef(inv)]);

export const readingsOf = (s: AppState, invoiceId: string): InvoiceReading[] =>
  (s.invoiceReadings ?? []).filter((r) => r.invoiceId === invoiceId).sort((a, b) => a.readAt.localeCompare(b.readAt));

/** Offene NEXUS-Rechnungen, die (für diese Fassung) noch nicht gelesen sind; älteste zuerst. */
export function invoicesToRead(s: AppState, max: number = READ_LIMITS.maxPerRun): Invoice[] {
  const dismissed = new Set(s.dismissedProposals);
  return s.invoices
    .filter((i) => i.connectionId === 'lexware_nexus' && i.status !== 'paid' && i.status !== 'void' && i.openCents > 0 && !!i.text)
    .filter((i) => coveringContract(s, i) === null)
    .filter((i) => !dismissed.has(readingProposalId(i)))
    .filter((i) => !readingsOf(s, i.id).some((r) => r.sourceUpdatedAt === (i.sourceUpdatedAt ?? '') && r.outcome !== 'error'))
    .sort((a, b) => a.issuedOn.localeCompare(b.issuedOn) || a.number.localeCompare(b.number))
    .slice(0, max);
}

export interface ReadingPlan { decision: 'apply' | 'proposal' | 'none'; kind: ContractKind; values: ProposalValues; steps: string[]; hints: string[] }

const posInt = (n: unknown): number | null => (typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null);
const dayOk = (n: unknown): number | null => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 31 ? n : null);

/** Bewertet eine Lesung auf dem aktuellen Stand: sofort anlegen, Vorschlag oder nichts. Beträge rechnet nur diese Funktion. */
export function planFromReading(s: AppState, inv: Invoice, r: InvoiceReadResult): ReadingPlan {
  const kind: ContractKind = r.kind === 'membership' || r.kind === 'ticket' || r.kind === 'other' ? r.kind : 'other';
  const n = posInt(r.installments);
  const rate = posInt(r.installmentCents);
  const first: IsoDate | null = validDate(r.firstDueDate) ? r.firstDueDate : null;
  // 9a: Tag laut Text, sonst Tag der ersten Fälligkeit, sonst Monatsende (nur wenn Raten bekannt sind).
  const dueDay = dayOk(r.dueDay) ?? (first ? Number(first.slice(8, 10)) : n !== null && rate !== null ? MONTH_END : null);
  const startDate = first ?? inv.issuedOn;
  const values: ProposalValues = { totalCents: inv.totalCents, installments: n, installmentCents: rate, dueDay, startDate };

  const steps: string[] = [`Rechnung ${inv.number} über ${formatEuro(inv.totalCents)}.`];
  if (r.quote) steps.push(`Laut Rechnung: „${r.quote}“`);
  const hints: string[] = [];
  if (!r.hasPlan) return { decision: 'none', kind, values, steps, hints };

  if (n === null || rate === null || values.dueDay === null) hints.push(READ_HINT.incomplete);
  if (!r.certain) hints.push(r.note ? `${READ_HINT.notCertain}: ${r.note}` : READ_HINT.notCertain);
  if (n !== null && rate !== null) {
    const last = inv.totalCents - rate * (n - 1);
    steps.push(`${n} Raten × ${formatEuro(rate)}${last !== rate ? `, letzte Rate ${formatEuro(last)}` : ''} = ${formatEuro(inv.totalCents)}.`);
    if (n < READ_LIMITS.minInstallments || n > READ_LIMITS.maxInstallments) hints.push(READ_HINT.schema);
    if (last <= 0 || Math.abs(last - rate) >= n) hints.push(READ_HINT.sumMismatch);
  }
  if (values.dueDay !== null) steps.push(`Fällig zum ${values.dueDay === MONTH_END ? 'Monatsende' : `${values.dueDay}.`}, erste Rate ${formatIsoDe(startDate)}.`);
  const offset = daysBetween(inv.issuedOn, startDate);
  if (offset < -READ_LIMITS.daysBefore || offset > READ_LIMITS.daysAfter) hints.push(READ_HINT.schema);
  if (inv.contactId === null) hints.push(READ_HINT.noContact);
  else if (kind === 'membership' && membershipContractOf(s, inv.contactId)) hints.push(READ_HINT.hasMembership);
  const allocated = s.allocations.filter((a) => a.invoiceId === inv.id).reduce((x, a) => x + a.amountCents, 0);
  if (inv.totalCents - inv.openCents > allocated) hints.push(READ_HINT.lexwarePartial);
  if (n !== null && rate !== null && values.dueDay !== null
    && validateContractDraft({ totalCents: inv.totalCents, installments: n, installmentCents: rate, dueDay: values.dueDay, startDate, catchUpMode: 'first_rate' }).length > 0
    && !hints.includes(READ_HINT.sumMismatch)) hints.push(READ_HINT.sumMismatch);

  return { decision: hints.length === 0 ? 'apply' : 'proposal', kind, values, steps, hints: [...new Set(hints)] };
}

export function readerSummary(s: AppState, at: Date): { lastReadAt: string | null; monthCostMicroCents: number; monthCostCents: number; limitMicroCents: number; limitReached: boolean; lastError: string | null } {
  const all = [...(s.invoiceReadings ?? [])].sort((a, b) => a.readAt.localeCompare(b.readAt));
  const ok = all.filter((r) => r.outcome !== 'error').at(-1);
  const err = all.filter((r) => r.outcome === 'error').at(-1);
  const cost = monthCostMicroCents(s, at);
  return {
    lastReadAt: ok?.readAt ?? null, monthCostMicroCents: cost, monthCostCents: Math.ceil(cost / 1_000_000),
    limitMicroCents: MONTHLY_LIMIT_MICRO_CENTS, limitReached: cost >= MONTHLY_LIMIT_MICRO_CENTS,
    lastError: err && (!ok || err.readAt > ok.readAt) ? err.error ?? null : null,
  };
}

/** Vorschläge aus Lesungen mit outcome 'proposal' für die aktuelle Fassung offener, nicht abgedeckter Rechnungen. */
export function readingProposals(s: AppState): ContractProposal[] {
  const out: ContractProposal[] = [];
  for (const inv of s.invoices) {
    if (inv.connectionId !== 'lexware_nexus' || inv.status === 'void' || inv.status === 'paid' || coveringContract(s, inv) !== null) continue;
    const r = readingsOf(s, inv.id).filter((x) => x.outcome === 'proposal' && x.sourceUpdatedAt === (inv.sourceUpdatedAt ?? '') && x.result).at(-1);
    if (!r?.result) continue;
    const plan = planFromReading(s, inv, r.result);
    const v = plan.values;
    const complete = v.totalCents !== null && v.installments !== null && v.installmentCents !== null && v.dueDay !== null && v.startDate !== null
      && validateContractDraft({ totalCents: v.totalCents, installments: v.installments, installmentCents: v.installmentCents, dueDay: v.dueDay, startDate: v.startDate, catchUpMode: 'first_rate' }).length === 0;
    const contact = inv.contactId ? s.contacts.find((c) => c.id === inv.contactId) : undefined;
    const sources = [invoiceRef(inv)];
    out.push({
      ...v, id: readingProposalId(inv), name: contact?.name ?? `Rechnung ${inv.number}`, email: contact?.emails[0] ?? null, billing: 'legacy', sources,
      contactRefs: inv.contactExternalId ? [{ connectionId: 'lexware_nexus', externalId: inv.contactExternalId }] : [],
      sourceLabel: 'Lexware (Claude)', references: [`Rechnung ${inv.number}`], complete, steps: [...plan.steps, ...plan.hints], possibleMatch: null,
      reading: { invoiceId: inv.id, invoiceNumber: inv.number, kind: plan.kind, quote: r.result.quote, note: r.result.note },
    });
  }
  return out;
}

/** Rechenweg eines Claude-Vertrags aus der Lesung, die ihn angelegt hat; leer ohne Lesung. */
export function readContractSteps(s: AppState, c: MemberContract): string[] {
  const inv = sourceInvoiceOf(s, c);
  const r = (s.invoiceReadings ?? []).filter((x) => x.contractId === c.id && x.result).at(-1);
  if (!inv || !r?.result) return [];
  return planFromReading(s, inv, r.result).steps;
}

/** Vorschlag mit den aktuellen Vertragswerten für „Korrigieren“ (gleiches Formular wie „Übernehmen“). */
export function correctionProposal(s: AppState, c: MemberContract): ContractProposal {
  const contact = s.contacts.find((x) => x.id === c.contactId);
  const number = c.readBy?.invoiceNumber ?? '';
  return {
    id: `correct:${c.id}`, totalCents: c.totalCents, installments: c.installments, installmentCents: c.installmentCents, dueDay: c.dueDay, startDate: c.startDate,
    name: contact?.name ?? `Rechnung ${number}`, email: contact?.emails[0] ?? null, billing: c.billing, sources: c.origin ?? [],
    contactRefs: (contact?.externalRefs ?? []).filter((r) => r.connectionId === 'lexware_nexus'),
    sourceLabel: 'Lexware (Claude)', references: [`Rechnung ${number}`],
    complete: validateContractDraft({ totalCents: c.totalCents, installments: c.installments, installmentCents: c.installmentCents, dueDay: c.dueDay, startDate: c.startDate, catchUpMode: c.catchUpMode }).length === 0,
    steps: readContractSteps(s, c), possibleMatch: null,
    reading: c.readBy ? { invoiceId: c.readBy.invoiceId, invoiceNumber: number, kind: c.kind ?? 'membership', quote: c.readBy.quote, note: null } : undefined,
  };
}
