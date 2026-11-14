import { daysBetween, formatIsoDe, todayBerlin } from '../clock';
import { contractSources } from '../connections';
import { contractOnHold } from '../ledger/contracts';
import { formatEuro } from '../money';
import { takeoverSubscriptionFor } from '../takeover/link';
import { currentTakeover, openTakeoverAction, runsViaStripe } from '../takeover/status';
import type { AppState, Insight, IsoDate, StripeTakeover } from '../types';
import { memberView } from './members';
import { memberRef, paymentRef, takeoverRef } from './refs';

export { takeoverRef };

const nameOf = (s: AppState, contactId: string) => s.contacts.find((c) => c.id === contactId)?.name ?? 'Unbekannt';
const berlinDay = (iso: string): IsoDate => todayBerlin(new Date(iso));

/** Jüngste Umstellung je Vertrag (ältere Versuche sind erledigt). */
function currentTakeovers(s: AppState): StripeTakeover[] {
  return s.takeovers.filter((t) => currentTakeover(s, t.contractId) === t);
}

/** Künftige Raten von Überweisungs-Verträgen, die in höchstens `takeoverReminderDays` Tagen fällig werden (Rest > 0). */
export function upcomingRates(s: AppState, today: IsoDate): { contractId: string; dueDate: IsoDate; amountCents: number }[] {
  const out: { contractId: string; dueDate: IsoDate; amountCents: number }[] = [];
  for (const c of s.contracts) {
    if (c.billing !== 'legacy' || runsViaStripe(s, c.id) || contractOnHold(s, c)) continue;
    for (const r of memberView(s, c.id, today).states) {
      const rest = r.amountCents - r.paidCents;
      const days = daysBetween(today, r.dueDate);
      if (rest > 0 && days >= 0 && days <= s.settings.takeoverReminderDays) out.push({ contractId: c.id, dueDate: r.dueDate, amountCents: rest });
    }
  }
  return out;
}

/** Verschickte Links, die seit mindestens `takeoverLinkNudgeDays` Tagen nicht genutzt wurden. */
export function unusedLinks(s: AppState, today: IsoDate): StripeTakeover[] {
  return currentTakeovers(s).filter((t) => t.status === 'link_sent' && daysBetween(berlinDay(t.linkSentAt), today) >= s.settings.takeoverLinkNudgeDays);
}

/** Hinweise rund um die Umstellung auf Stripe: Doppelzahlung, ungenutzter Link, Plan geändert, Rate steht an, verwaistes Abo. */
export function detectTakeover(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const out: Insight[] = [];

  // Überweisung trotz Stripe (z. B. alter Dauerauftrag): ab dem Tag der Einrichtung
  const seen = new Set<string>();
  for (const a of s.allocations) {
    if (!a.contractId || seen.has(a.paymentId) || !runsViaStripe(s, a.contractId)) continue;
    const p = s.payments.find((x) => x.id === a.paymentId);
    const t = currentTakeover(s, a.contractId);
    // Rückbuchungen (negativer Betrag) und Erstattungen sind keine Überweisung des Mitglieds.
    if (!p || !t?.setUpAt || p.source !== 'bank' || p.kind !== 'incoming' || p.amountCents <= 0 || p.refundOf) continue;
    const since = berlinDay(t.setUpAt);
    if (p.bookedOn < since) continue;
    seen.add(p.id);
    const name = nameOf(s, t.contactId);
    out.push({
      dedupeKey: `double-pay:${p.id}`,
      type: 'double_payment',
      company: 'nexus',
      priority: 'today',
      title: `Doppelzahlung: ${name} hat ${formatEuro(p.amountCents)} überwiesen`,
      body: `Die Raten laufen seit ${formatIsoDe(since)} über Stripe. Bitte von Hand erstatten.`,
      amountCents: p.amountCents,
      refs: [memberRef(a.contractId, name), paymentRef(p.id, p.payerName ?? p.externalId)],
      nextStep: 'Von Hand erstatten',
      needsSources: ['bank_qonto'],
    });
  }

  for (const t of unusedLinks(s, today)) {
    const name = nameOf(s, t.contactId);
    const sent = berlinDay(t.linkSentAt);
    out.push({
      dedupeKey: `takeover-link:${t.id}`,
      type: 'takeover_link_unused',
      company: 'nexus',
      priority: 'info',
      title: `${name}: Stripe-Link seit ${daysBetween(sent, today)} Tagen nicht genutzt`,
      body: `Link verschickt am ${formatIsoDe(sent)}. Es ist noch kein Zahlungsmittel hinterlegt.`,
      refs: [memberRef(t.contractId, name), takeoverRef('Umstellung')],
      nextStep: 'Erinnerung an den Link freigeben',
      needsSources: ['stripe_nexus'],
    });
  }

  for (const t of currentTakeovers(s)) {
    if (t.status !== 'plan_changed' || openTakeoverAction(s, t.contractId)) continue;
    const name = nameOf(s, t.contactId);
    out.push({
      dedupeKey: `takeover-changed:${t.id}`,
      type: 'takeover_plan_changed',
      company: 'nexus',
      priority: 'today',
      title: `${name}: Plan hat sich geändert, Umstellung neu freigeben`,
      body: 'Beim Abschluss passte der offene Betrag nicht mehr zum freigegebenen Plan. Es wurde kein Zeitplan angelegt. Das Zahlungsmittel ist hinterlegt, eine neue Freigabe braucht keinen neuen Link.',
      refs: [memberRef(t.contractId, name), takeoverRef('Umstellung')],
      nextStep: 'Umstellung neu freigeben',
      needsSources: ['stripe_nexus'],
    });
  }

  for (const r of upcomingRates(s, today)) {
    const contract = s.contracts.find((c) => c.id === r.contractId)!;
    const name = nameOf(s, contract.contactId);
    const linkSent = currentTakeover(s, r.contractId)?.status === 'link_sent';
    out.push({
      dedupeKey: `upcoming:${r.contractId}:${r.dueDate}`,
      type: 'rate_upcoming',
      company: 'nexus',
      priority: 'today',
      title: `${name}: Rate über ${formatEuro(r.amountCents)} am ${formatIsoDe(r.dueDate)} fällig`,
      body: `Noch offen: ${formatEuro(r.amountCents)}.${linkSent ? ' Der Stripe-Link ist schon verschickt.' : ''}`,
      amountCents: r.amountCents,
      refs: [memberRef(r.contractId, name), takeoverRef('Erinnerungen')],
      nextStep: 'Erinnerung freigeben',
      needsSources: contractSources(contract),
    });
  }

  // Stripe-Abo mit Vertrags-ID, das keiner Umstellung gehört: Geld darf nie unbemerkt fließen.
  for (const sub of s.subscriptions) {
    if (!sub.metadataContractId || sub.contractId || sub.status === 'canceled') continue;
    if (s.takeovers.some((t) => t.subscriptionExternalId === sub.externalId)) continue;
    // Eigenes Abo einer eingerichteten Umstellung: der Abgleich nach dem Import verknüpft es (wie `syncTakeovers`).
    const waiting = s.takeovers.some((t) => t.status === 'set_up' && takeoverSubscriptionFor(s, t)?.externalId === sub.externalId);
    if (waiting) continue;
    out.push({
      dedupeKey: `takeover-orphan:${sub.externalId}`,
      type: 'takeover_subscription_orphan',
      company: 'nexus',
      priority: 'today',
      title: `${sub.customerName}: Stripe-Abo ohne passende Umstellung`,
      body: `Das Abo ${sub.externalId} trägt die Vertrags-ID ${sub.metadataContractId}, gehört aber zu keiner eingerichteten Umstellung. Bitte in Stripe prüfen.`,
      ...(sub.priceCents !== null ? { amountCents: sub.priceCents } : {}),
      refs: [takeoverRef('Umstellung')],
      nextStep: 'Abo in Stripe prüfen',
      needsSources: ['stripe_nexus'],
    });
  }
  return out;
}
