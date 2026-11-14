import 'server-only';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { ActionOutput, ActionProvider, ExecuteOutcome } from '@/domain/actions/machine';
import { todayBerlin } from '@/domain/clock';
import { schedulePhases } from '@/domain/takeover/plan';
import type { Action, Installment } from '@/domain/types';
import { scheduleIdempotencyKey, trimBase, type StripeWriter } from './connectors/stripe-write';

type TakeoverPayload = { contractId: string; name: string; email: string | null; rates: Installment[]; stripeCustomerId?: string; paymentMethodId?: string };

/**
 * Server-Ausführer. Nachrichten bleiben Demo (`simulated`), nur `stripe_takeover` läuft mit Schreib-Schlüssel echt.
 * Ohne Schreiber liefert die Umstellung nur `{ linkBase }` → Demo-Umstellung (Token `demo-…`), kein Stripe-Aufruf.
 * `takeoverId` = Aktions-ID; der Zeitplan-Key hängt nur daran, damit Neu-Freigabe und Webhook nie zwei Zeitpläne anlegen.
 */
export function createActionProvider(o: { writer: StripeWriter | null; linkBase: string; now: () => Date; demo?: DemoProvider }): ActionProvider {
  const demo = o.demo ?? new DemoProvider();
  const linkBase = trimBase(o.linkBase);
  const real = (a: Action) => a.type === 'stripe_takeover' && o.writer !== null;

  return {
    simulated: true,
    simulatedFor: (a) => !real(a),

    async execute(a, key): Promise<ExecuteOutcome> {
      if (a.type !== 'stripe_takeover') return demo.execute(a, key);
      const w = o.writer;
      if (!w) {
        await demo.execute(a, key);
        return { result: 'ok', output: { linkBase } };
      }
      const p = a.payload as TakeoverPayload;
      const stripeCustomerId = p.stripeCustomerId ?? (await w.findOrCreateCustomer({ contractId: p.contractId, name: p.name, email: p.email }, `${key}:customer`));
      const output: ActionOutput = { stripeCustomerId, linkBase };
      if (!p.paymentMethodId) return { result: 'ok', output };
      // Neu-Freigabe mit hinterlegtem Zahlungsmittel: Zeitplan sofort, ohne neuen Link.
      await w.setDefaultPaymentMethod(stripeCustomerId, p.paymentMethodId);
      const productId = await w.ensurePlanProduct();
      // Schon angelegt (z. B. Antwort verloren, „Erneut versuchen“ am Folgetag mit anderen Phasen) → übernehmen.
      const scheduleId = (await w.findSchedule(stripeCustomerId, a.id)) ?? (await w.createSchedule({
        customerId: stripeCustomerId, paymentMethodId: p.paymentMethodId, productId,
        phases: schedulePhases(p.rates, todayBerlin(o.now())), contractId: p.contractId, takeoverId: a.id,
      }, scheduleIdempotencyKey(a.id)));
      return { result: 'ok', output: { ...output, scheduleId, paymentMethodId: p.paymentMethodId } };
    },

    async lookup(key, a) {
      if (!a || a.type !== 'stripe_takeover') return demo.lookup(key);
      const w = o.writer;
      if (!w) return (await demo.lookup(key)) ? { output: { linkBase } } : false;
      const p = a.payload as TakeoverPayload;
      const stripeCustomerId = p.stripeCustomerId ?? (await w.findCustomer(p.contractId));
      if (!stripeCustomerId) return false;
      const output: ActionOutput = { stripeCustomerId, linkBase };
      if (!p.paymentMethodId) return { output };
      // Ohne Zeitplan ist die Neu-Freigabe nicht ausgeführt: „fehlgeschlagen“ statt eines neuen Links, den das Mitglied erneut nutzen müsste.
      const scheduleId = await w.findSchedule(stripeCustomerId, a.id);
      return scheduleId ? { output: { ...output, scheduleId, paymentMethodId: p.paymentMethodId } } : false;
    },
  };
}
