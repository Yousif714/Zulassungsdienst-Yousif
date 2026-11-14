import { todayBerlin } from '../clock';
import type { AppState, IsoDate, MemberContract, StripeTakeover } from '../types';
import { planEndDate, schedulePhases } from './plan';

/**
 * Gleicht Umstellungen mit den importierten Stripe-Abos ab (nach jedem Import):
 * (a) eingerichtete Umstellung + Abo mit `metadata.contractId` des Vertrags → Abo mit dem Vertrag verknüpft, Umstellung `active`
 *     (kein Vorschlag, kein neuer Vertrag; bestätigtes Enddatum = Planende, bestätigter Preis fehlt, weil der Plan mehrere Preise hat);
 * (b) aktive Umstellung + Abo vor der letzten Rate beendet → `aborted`, Vertrag zurück auf `legacy` (Plan bleibt).
 * Ein Abo, das zum bestätigten Enddatum endet, ist reguläres Ende und kein Rückfall.
 */
export function syncTakeovers(s: AppState, today: IsoDate, at: Date): { state: AppState; audit: string[] } {
  let state = s;
  const audit: string[] = [];
  const nameOf = (t: StripeTakeover) => state.contacts.find((c) => c.id === t.contactId)?.name ?? 'Unbekannt';

  for (const t0 of s.takeovers) {
    const t = state.takeovers.find((x) => x.id === t0.id)!;

    if (t.status === 'set_up') {
      // Nur das Abo dieses Kunden, das noch läuft und zu keiner anderen Umstellung gehört (altes, abgebrochenes Abo bleibt unberührt).
      if (t.isDemo || !t.stripeCustomerId) continue;
      const sub = state.subscriptions.find(
        (x) =>
          x.metadataContractId === t.contractId &&
          x.stripeCustomerId === t.stripeCustomerId &&
          x.status !== 'canceled' &&
          (x.contractId === null || x.contractId === t.contractId) &&
          !state.takeovers.some((o) => o.id !== t.id && o.subscriptionExternalId === x.externalId),
      );
      if (!sub) continue;
      const setUpDay = todayBerlin(new Date(t.setUpAt ?? at.toISOString()));
      const endDate = planEndDate(schedulePhases(t.rates, setUpDay), setUpDay);
      const next: StripeTakeover = { ...t, status: 'active', subscriptionExternalId: sub.externalId, activeAt: at.toISOString() };
      state = {
        ...state,
        subscriptions: state.subscriptions.map((x) => (x.id === sub.id ? { ...x, contractId: t.contractId, confirmedPriceCents: null, confirmedEndDate: endDate } : x)),
        takeovers: state.takeovers.map((x) => (x.id === t.id ? next : x)),
      };
      audit.push(`Stripe-Abo verknüpft: ${nameOf(t)}`);
      continue;
    }

    if (t.status === 'active') {
      const sub = state.subscriptions.find((x) => x.externalId === t.subscriptionExternalId);
      if (!sub || sub.status !== 'canceled') continue;
      const endedAsAgreed = sub.endDate !== null && sub.endDate === sub.confirmedEndDate && sub.endDate <= today;
      if (endedAsAgreed) continue;
      state = {
        ...state,
        contracts: state.contracts.map((c): MemberContract => (c.id === t.contractId ? { ...c, billing: 'legacy' } : c)),
        takeovers: state.takeovers.map((x) => (x.id === t.id ? { ...t, status: 'aborted', endedAt: at.toISOString() } : x)),
      };
      audit.push(`Stripe-Abo vorzeitig beendet: ${nameOf(t)}, zurück auf Überweisung`);
    }
  }
  return { state, audit };
}
