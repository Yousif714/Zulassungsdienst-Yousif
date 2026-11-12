import type { Allocation, AppState, Payment, Subscription } from '../types';

/**
 * Neue automatische Zuordnungen für Stripe-Zahlungen (auch Erstattungen, Betrag < 0):
 * Das Abo kommt aus `subscriptionExternalId`, bei Erstattungen notfalls über die erstattete Zahlung.
 * Zugeordnet wird nur, wenn das Abo einen bestätigten Vertrag hat (auch rückwirkend).
 */
export function stripeAllocations(s: AppState): Allocation[] {
  const allocated = new Set(s.allocations.map((a) => a.paymentId));
  const subOf = (p: Payment): Subscription | undefined => {
    const ext = p.subscriptionExternalId ?? s.payments.find((x) => x.source === 'stripe' && x.externalId === p.refundOf)?.subscriptionExternalId;
    return ext ? s.subscriptions.find((x) => x.externalId === ext) : undefined;
  };
  const out: Allocation[] = [];
  for (const p of s.payments) {
    if (p.source !== 'stripe' || p.kind !== 'incoming' || allocated.has(p.id) || p.amountCents === 0) continue;
    const sub = subOf(p);
    if (!sub?.contractId || !s.contracts.some((c) => c.id === sub.contractId)) continue;
    out.push({ paymentId: p.id, contractId: sub.contractId, amountCents: p.amountCents, method: 'auto' });
  }
  return out;
}
