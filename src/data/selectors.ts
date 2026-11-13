import { jobBilling } from '@/domain/billing';
import { MONEY_SOURCES } from '@/domain/briefing';
import { contractSources, notConnected } from '@/domain/connections';
import { isMembership } from '@/domain/import/membership';
import { todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors';
import { areaStale } from '@/domain/freshness';
import { plateInText } from '@/domain/matching/messages';
import { invoiceOpenCents } from '@/domain/ledger/receivables';
import { formatEuro } from '@/domain/money';
import { portalViews, type PortalView } from '@/domain/portal';
import { monthForecast } from '@/domain/ledger/forecast';
import type { AppState, Invoice, IsoDate, MemberContract, Payment, StoredInsight } from '@/domain/types';
import type { MemberStatus } from '@/domain/ledger/status';

export const openInsights = (s: AppState): StoredInsight[] => s.insights.filter((i) => i.status === 'open');

export type MemberRow = {
  contractId: string;
  name: string;
  traffic: MemberStatus['traffic'];
  arrearsCents: number;
  openCents: number;
  billing: MemberContract['billing'];
  /** Die Quelle des Vertrags (Bank bzw. Stripe) ist nicht verbunden: der Stand ist unbekannt. */
  notConnected: boolean;
};

export function memberRows(s: AppState, today: IsoDate): MemberRow[] {
  return s.contracts.map((c) => {
    const v = memberView(s, c.id, today);
    return {
      contractId: c.id,
      name: v.contact?.name ?? 'Unbekannt',
      traffic: v.status.traffic,
      arrearsCents: v.status.arrearsCents,
      openCents: v.status.openCents,
      billing: c.billing,
      notConnected: notConnected(contractSources(c), s.connections),
    };
  });
}

/** Portal-Mitglieder mit Ampel und Rückstand des Vertrags (sonst `null` bzw. 0). */
export function portalRows(s: AppState, today: IsoDate): (PortalView & { traffic: MemberRow['traffic'] | null; arrearsCents: number })[] {
  const byContract = new Map(memberRows(s, today).map((r) => [r.contractId, r]));
  return portalViews(s).map((v) => {
    const r = v.contractId ? byContract.get(v.contractId) : undefined;
    return { ...v, traffic: r?.traffic ?? null, arrearsCents: r?.arrearsCents ?? 0 };
  });
}

export function overdueMembers(
  s: AppState,
  today: IsoDate,
): { contractId: string; contactId: string; name: string; arrearsCents: number; traffic: 'yellow' | 'red' }[] {
  return memberRows(s, today)
    .filter((r): r is MemberRow & { traffic: 'yellow' | 'red' } => !r.notConnected && (r.traffic === 'yellow' || r.traffic === 'red'))
    .map((r) => ({
      contractId: r.contractId,
      contactId: s.contracts.find((c) => c.id === r.contractId)!.contactId,
      name: r.name,
      arrearsCents: r.arrearsCents,
      traffic: r.traffic,
    }))
    .sort((a, b) => b.arrearsCents - a.arrearsCents);
}

export function nexusForecast(s: AppState, today: IsoDate): { expectedCents: number; atRiskCents: number } {
  const members = s.contracts.filter((c) => !notConnected(contractSources(c), s.connections)).map((c) => {
    const v = memberView(s, c.id, today);
    return { status: v.status, states: v.states };
  });
  return monthForecast(members, today.slice(0, 7), today);
}

/** Eingehende NEXUS-Bankzahlungen ohne Zuordnung (Stripe-Auszahlungen gehören keinem Mitglied). */
export const unallocatedBankPayments = (s: AppState): Payment[] =>
  s.payments.filter(
    (p) => p.source === 'bank' && p.kind === 'incoming' && p.company === 'nexus' && !p.ignoredAt && p.amountCents > 0 && !s.allocations.some((a) => a.paymentId === p.id),
  );

/** Ziele für die manuelle Zuordnung: alle Verträge und offene NEXUS-Rechnungen, nach Label sortiert. */
export function matchOptions(s: AppState): { value: string; label: string }[] {
  const name = (id: string | null) => s.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';
  return [
    ...s.contracts.map((c) => ({ value: `contract:${c.id}`, label: name(c.contactId) })),
    ...s.invoices
      .filter((i) => i.connectionId === 'lexware_nexus' && invoiceOpenCents(s, i) > 0)
      .map((i) => ({ value: `invoice:${i.id}`, label: `Rechnung ${i.number} · ${name(i.contactId)} · ${formatEuro(invoiceOpenCents(s, i))}` })),
  ].sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/** Stripe-Zahlungen von Mitgliedschafts-Abos, die auf einen bestätigten Vertrag warten (Abo hat noch keinen Vertrag). */
export const waitingStripePayments = (s: AppState): Payment[] =>
  s.payments.filter((p) => {
    if (p.source !== 'stripe' || p.kind !== 'incoming' || p.amountCents <= 0 || s.allocations.some((a) => a.paymentId === p.id)) return false;
    const sub = s.subscriptions.find((x) => x.externalId === p.subscriptionExternalId);
    return !!sub && sub.contractId === null && (isMembership(sub.productName) || isMembership(sub.invoiceLineText ?? ''));
  });

/** Offene Fälle „Stripe bezahlt, Lexware offen“: Rechnung und Stripe-Zahlung aus dem Hinweis. */
export function stripeLexCases(s: AppState): { key: string; invoice: Invoice; payment: Payment }[] {
  return openInsights(s)
    .filter((i) => i.type === 'stripe_paid_lexware_open')
    .flatMap((i) => {
      const invoice = s.invoices.find((x) => x.id === i.refs.find((r) => r.kind === 'invoice')?.id);
      const payment = s.payments.find((x) => x.id === i.refs.find((r) => r.kind === 'payment')?.id);
      return invoice && payment ? [{ key: i.dedupeKey, invoice, payment }] : [];
    });
}

// ---------- Zulassungsdienst ----------

/** Tageszahlen. `notInvoiced` ist `null`, wenn der Lexware-Datenstand des Zulassungsdienstes nicht frisch ist. */
export function zulassungKpis(s: AppState, at: Date): { doneToday: number; open: number; waiting: number; notInvoiced: number | null } {
  const today = todayBerlin(at);
  const stale = areaStale(MONEY_SOURCES.zulassung, s.connections, at).length > 0;
  return {
    doneToday: s.jobs.filter((j) => j.doneAt && todayBerlin(new Date(j.doneAt)) === today).length,
    open: s.jobs.filter((j) => j.status === 'open').length,
    waiting: s.jobs.filter((j) => j.status === 'waiting_customer').length,
    notInvoiced: stale ? null : openInsights(s).filter((i) => i.type === 'job_not_invoiced').length,
  };
}

/** Rechnungen, die zum Rest eines Auftrags passen: gleicher Kontakt, Zulassungsdienst, nicht storniert, keinem Auftrag zugeordnet,
 *  Betrag ≤ Rest. Rechnungen mit dem Kennzeichen im Text (mit Wortgrenzen) zuerst, sonst neueste zuerst. */
export function invoiceCandidates(s: AppState, jobId: string): Invoice[] {
  const job = s.jobs.find((j) => j.id === jobId);
  if (!job) return [];
  const rest = jobBilling(s, job).restCents;
  const plate = s.vehicles.find((v) => v.id === job.vehicleId)?.plate;
  const linked = new Set(s.jobs.flatMap((j) => j.invoiceIds));
  const hasPlate = (i: Invoice) => (plate && plateInText(plate, (i.text ?? '').toUpperCase()) ? 1 : 0);
  return s.invoices
    .filter((i) => i.contactId === job.contactId && i.company === 'zulassung' && i.status !== 'void' && !linked.has(i.id) && i.totalCents <= rest)
    .sort((a, b) => hasPlate(b) - hasPlate(a) || b.issuedOn.localeCompare(a.issuedOn));
}
