import { memberView } from '@/domain/detectors';
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
    };
  });
}

export function overdueMembers(
  s: AppState,
  today: IsoDate,
): { contractId: string; contactId: string; name: string; arrearsCents: number; traffic: 'yellow' | 'red' }[] {
  return memberRows(s, today)
    .filter((r): r is MemberRow & { traffic: 'yellow' | 'red' } => r.traffic === 'yellow' || r.traffic === 'red')
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
  const members = s.contracts.map((c) => {
    const v = memberView(s, c.id, today);
    return { status: v.status, states: v.states };
  });
  return monthForecast(members, today.slice(0, 7), today);
}

/** Eingehende NEXUS-Bankzahlungen ohne Zuordnung (Stripe-Auszahlungen gehören keinem Mitglied). */
export const unallocatedBankPayments = (s: AppState): Payment[] =>
  s.payments.filter(
    (p) => p.source === 'bank' && p.kind === 'incoming' && p.company === 'nexus' && !s.allocations.some((a) => a.paymentId === p.id),
  );

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
