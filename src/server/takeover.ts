import 'server-only';
import type { ActionProvider } from '@/domain/actions/machine';
import { todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors/members';
import { checkCompletion } from '@/domain/takeover/plan';
import { scheduleIdempotencyKey, type StripeWriter } from './connectors/stripe-write';
import type { Repos } from './db/repository';
import { dispatchEvents, loadState } from './state-service';

export type CheckoutSession = { id: string; mode: string; setup_intent: string | null; metadata?: Record<string, string> };

/**
 * `checkout.session.completed` (Modus setup) einer Umstellung: Zahlungsmittel holen, offenen Betrag gegen den Plan prüfen.
 * Gleich → Standard-Zahlungsmittel, Produkt, Zeitplan (Key `takeover:<id>:schedule`), eingerichtet.
 * Abweichend → „Plan geändert“, kein Zeitplan, Zahlungsmittel bleibt für die Neu-Freigabe.
 * Nur aus `link_sent`: doppelt, gleichzeitig oder nach „Zurückziehen“ → `ignored`, ohne Stripe-Aufruf.
 * Stripe-Fehler (auch 409 bei gleichzeitigem Key) werden geworfen, damit Stripe das Ereignis wiederholt.
 */
export async function completeTakeoverCheckout(
  repos: Repos,
  writer: StripeWriter,
  session: CheckoutSession,
  deps: { at: Date; provider: ActionProvider },
): Promise<'ignored' | 'set_up' | 'plan_changed'> {
  const takeoverId = session.metadata?.takeoverId;
  if (session.mode !== 'setup' || typeof takeoverId !== 'string' || !takeoverId || typeof session.setup_intent !== 'string' || !session.setup_intent) return 'ignored';
  const s = await loadState(repos, deps.at);
  const t = s.takeovers.find((x) => x.id === takeoverId);
  if (!t || t.status !== 'link_sent' || t.isDemo || !t.stripeCustomerId) return 'ignored';

  const paymentMethodId = await writer.setupIntentPaymentMethod(session.setup_intent);
  const today = todayBerlin(deps.at);
  const check = checkCompletion(t.rates, memberView(s, t.contractId, today).status.openCents, today);
  const ev = { at: () => deps.at, provider: deps.provider };
  if (!check.ok) {
    await dispatchEvents(repos, [{ type: 'takeoverPlanChanged', takeoverId, paymentMethodId }], ev);
    return 'plan_changed';
  }
  await writer.setDefaultPaymentMethod(t.stripeCustomerId, paymentMethodId);
  const productId = await writer.ensurePlanProduct();
  const scheduleId = await writer.createSchedule({
    customerId: t.stripeCustomerId, paymentMethodId, productId, phases: check.phases, contractId: t.contractId, takeoverId,
  }, scheduleIdempotencyKey(takeoverId));
  await dispatchEvents(repos, [{ type: 'takeoverSetUp', takeoverId, scheduleId, paymentMethodId }], ev);
  return 'set_up';
}

/**
 * Klick auf „Weiter zu Stripe“: je Klick eine neue Checkout-Sitzung. Nur gültig bei `link_sent`.
 * Ohne Schreiber oder bei Demo-Umstellung → Demo, kein Stripe-Aufruf.
 */
export async function createCheckoutForToken(
  repos: Repos,
  writer: StripeWriter | null,
  token: string,
  base: string,
): Promise<{ kind: 'redirect'; url: string } | { kind: 'demo' } | { kind: 'invalid' }> {
  if (!token) return { kind: 'invalid' };
  const { state } = await repos.state.load();
  const t = state.takeovers.find((x) => x.token === token);
  if (!t || t.status !== 'link_sent') return { kind: 'invalid' };
  if (!writer || t.isDemo) return { kind: 'demo' };
  if (!t.stripeCustomerId) return { kind: 'invalid' };
  const s = await writer.createSetupCheckout({ customerId: t.stripeCustomerId, takeoverId: t.id, contractId: t.contractId, token, base });
  return { kind: 'redirect', url: s.url };
}
