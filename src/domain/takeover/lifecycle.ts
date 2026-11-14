import type { ActionOutput } from '../actions/machine';
import type { Action, AppState, Installment, MemberContract, StripeTakeover } from '../types';
import { paymentLinkUrl, takeoverToken } from './plan';
import { currentTakeover } from './status';

type Changed = { state: AppState; takeover: StripeTakeover };

function replaceTakeover(s: AppState, t: StripeTakeover): AppState {
  return { ...s, takeovers: s.takeovers.map((x) => (x.id === t.id ? t : x)) };
}

/** Vertrag läuft ab jetzt über den Zeitplan: bisher Gezahltes bleibt, die Plan-Raten ersetzen den Rest. */
function setUp(s: AppState, t: StripeTakeover, at: Date): Changed {
  const done: StripeTakeover = { ...t, status: 'set_up', setUpAt: at.toISOString() };
  const planCents = t.rates.reduce((sum, r) => sum + r.amountCents, 0);
  const contracts = s.contracts.map((c): MemberContract =>
    c.id !== t.contractId ? c : { ...c, billing: 'stripe', plan: { takeoverId: t.id, paidCents: c.totalCents - planCents, rates: t.rates } });
  const exists = s.takeovers.some((x) => x.id === t.id);
  return { state: { ...s, contracts, takeovers: exists ? s.takeovers.map((x) => (x.id === t.id ? done : x)) : [...s.takeovers, done] }, takeover: done };
}

/**
 * Ergebnis der ausgeführten Aktion `stripe_takeover`: Umstellung mit eigenem Link anlegen (`id` = Aktions-ID).
 * Ohne Stripe-Kunde im `output` ist es eine Demo-Umstellung. Mit `scheduleId` (Neu-Freigabe mit hinterlegtem Zahlungsmittel) direkt eingerichtet.
 * Schon vorhanden → undefined (eine Aktion ergibt höchstens eine Umstellung).
 */
export function recordTakeover(s: AppState, a: Action, output: ActionOutput | undefined, at: Date, newId: () => string): Changed | undefined {
  if (s.takeovers.some((t) => t.id === a.id)) return undefined;
  const p = a.payload as { contractId: string; contactId: string; mode: MemberContract['catchUpMode']; rates: Installment[]; openCents: number; paymentMethodId?: string };
  const isDemo = !output?.stripeCustomerId;
  const token = (isDemo ? 'demo-' : '') + takeoverToken(newId);
  const t: StripeTakeover = {
    id: a.id, contractId: p.contractId, contactId: p.contactId, actionId: a.id, actionVersion: a.version, status: 'link_sent',
    token, link: paymentLinkUrl(output?.linkBase ?? '', token), mode: p.mode, rates: p.rates, openCents: p.openCents,
    stripeCustomerId: output?.stripeCustomerId ?? null, paymentMethodId: output?.paymentMethodId ?? p.paymentMethodId ?? null,
    scheduleId: output?.scheduleId ?? null, subscriptionExternalId: null, isDemo, linkSentAt: at.toISOString(),
  };
  if (t.scheduleId) return setUp(s, t, at);
  return { state: { ...s, takeovers: [...s.takeovers, t] }, takeover: t };
}

/** Zahlungsmittel hinterlegt und Zeitplan angelegt. Nur aus `link_sent` (zurückgezogen, doppelt usw. → undefined). */
export function setUpTakeover(s: AppState, takeoverId: string, ids: { scheduleId: string; paymentMethodId: string }, at: Date): Changed | undefined {
  const t = s.takeovers.find((x) => x.id === takeoverId);
  if (!t || t.status !== 'link_sent') return undefined;
  return setUp(s, { ...t, scheduleId: ids.scheduleId, paymentMethodId: ids.paymentMethodId }, at);
}

/** Plan weicht beim Abschluss ab: kein Zeitplan, Zahlungsmittel bleibt für die Neu-Freigabe. Nur aus `link_sent`. */
export function markTakeoverPlanChanged(s: AppState, takeoverId: string, paymentMethodId: string): Changed | undefined {
  const t = s.takeovers.find((x) => x.id === takeoverId);
  if (!t || t.status !== 'link_sent') return undefined;
  const changed: StripeTakeover = { ...t, status: 'plan_changed', paymentMethodId };
  return { state: replaceTakeover(s, changed), takeover: changed };
}

/** „Zurückziehen“ einer verschickten Umstellung: Token wird ungültig. Ab `set_up` nicht möglich (Zeitplan besteht). */
export function withdrawSentTakeover(s: AppState, contractId: string, at: Date): Changed | { blocked: 'schedule' } | undefined {
  const t = currentTakeover(s, contractId);
  if (!t) return undefined;
  if (t.status === 'set_up' || t.status === 'active') return { blocked: 'schedule' };
  if (t.status !== 'link_sent' && t.status !== 'plan_changed') return undefined;
  const withdrawn: StripeTakeover = { ...t, status: 'withdrawn', endedAt: at.toISOString() };
  return { state: replaceTakeover(s, withdrawn), takeover: withdrawn };
}
