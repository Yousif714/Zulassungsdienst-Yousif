import { todayBerlin } from '../clock';
import { formatEuro } from '../money';
import type { AppState, Insight, IsoDate, MemberContract, Subscription } from '../types';
import { subscriptionOf } from '../matching/stripe';
import { planPrices } from '../takeover/plan';
import { currentTakeover, runsViaStripe } from '../takeover/status';
import { memberRef } from './refs';

/** Hinweise auf Änderungen an Stripe-Abos mit bestätigtem Vertrag. Der Vertrag selbst bleibt unverändert. */
export function detectSubscriptionChanges(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const out: Insight[] = [];
  for (const sub of s.subscriptions) {
    if (!sub.contractId) continue;
    const contract = s.contracts.find((c) => c.id === sub.contractId);
    if (!contract) continue;
    const name = s.contacts.find((c) => c.id === contract.contactId)?.name ?? sub.customerName;
    const add = (suffix: string, title: string, body: string, amountCents?: number) =>
      out.push({
        dedupeKey: `sub:${sub.externalId}:${suffix}`,
        type: 'subscription_changed',
        company: 'nexus',
        priority: 'today',
        title,
        body,
        ...(amountCents !== undefined ? { amountCents } : {}),
        refs: [memberRef(contract.id, name)],
        nextStep: 'Vertrag prüfen',
        needsSources: ['stripe_nexus'],
      });
    const note = 'Der Vertrag bleibt unverändert, bitte prüfen.';

    // Reguläres Ende: Stripe beendet das Abo zum bestätigten Enddatum (cancel_at erreicht). Das ist keine Kündigung.
    const endedAsAgreed = sub.endDate !== null && sub.endDate === sub.confirmedEndDate && sub.endDate <= today;
    if (sub.status === 'canceled' && !endedAsAgreed) add('canceled', `${name}: Abo in Stripe gekündigt`, `Das Stripe-Abo wurde gekündigt. ${note}`);
    if (sub.endDate !== sub.confirmedEndDate) add('end', `${name}: Enddatum des Abos geändert`, `Enddatum in Stripe: ${sub.endDate ?? 'keines'} (bestätigt: ${sub.confirmedEndDate ?? 'keines'}). ${note}`);
    if (!priceAsAgreed(s, sub, contract, today)) add('price', `${name}: Preis des Abos geändert`, `Preis in Stripe: ${money(sub.priceCents)} (bestätigt: ${money(sub.confirmedPriceCents)}). ${note}`);
    if (sub.status === 'past_due' || sub.status === 'unpaid') add('past_due', `${name}: Stripe-Zahlung fehlgeschlagen`, `Das Abo steht auf „${sub.status}“. ${note}`);
    if (sub.disputes.length > 0) add('dispute', `${name}: Chargeback in Stripe`, `${sub.disputes.length} Streitfall/Streitfälle zum Abo. ${note}`);

    for (const p of s.payments) {
      if (p.source !== 'stripe' || !p.refundOf || subscriptionOf(s, p)?.externalId !== sub.externalId) continue;
      add(`refund:${p.externalId}`, `${name}: Erstattung ${formatEuro(-p.amountCents)}`, `Stripe hat ${formatEuro(-p.amountCents)} erstattet (${p.bookedOn}). ${note}`, -p.amountCents);
    }
  }
  return out;
}

/** Preis wie bestätigt; bei einem Vertrag mit Umstellungs-Plan (über Stripe oder abgebrochen) zählt jeder Preis des Plans. */
function priceAsAgreed(s: AppState, sub: Subscription, contract: MemberContract, today: IsoDate): boolean {
  if (sub.priceCents === sub.confirmedPriceCents) return true;
  if (!contract.plan || sub.priceCents === null) return false;
  const t = currentTakeover(s, contract.id);
  if (!runsViaStripe(s, contract.id) && t?.status !== 'aborted') return false;
  // Phasen so, wie sie beim Einrichten angelegt wurden (Überfälliges ist dort zur Sofort-Phase zusammengefasst).
  const setUpAt = s.takeovers.find((x) => x.id === contract.plan?.takeoverId)?.setUpAt;
  const setUpDay = setUpAt ? todayBerlin(new Date(setUpAt)) : today;
  return planPrices(contract.plan.rates, setUpDay).includes(sub.priceCents);
}

const money = (c: Subscription['priceCents']) => (c === null ? 'unbekannt' : formatEuro(c));
