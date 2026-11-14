import { cancelDraft } from '../actions/machine';
import { linkNudgeAction, linkNudgeId, upcomingReminderAction, upcomingReminderId } from '../action-factory';
import { todayBerlin } from '../clock';
import { unusedLinks, upcomingRates } from '../detectors/takeover';
import { takeoverLinkFor } from '../payment-link';
import type { Action, AppState, IsoDate } from '../types';
import { cancelTakeoverDraft, syncTakeoverDraft } from './prepare';
import { runsViaStripe } from './status';
import { linkNudgeText, upcomingReminderText } from './texts';

export { linkNudgeAction, linkNudgeId, upcomingReminderAction, upcomingReminderId };
export { paymentLinkFor } from '../payment-link';

const UPCOMING_PREFIX = 'upcoming-';

/** Fälligkeitstag aus dem Schlüssel `upcoming:<contractId>:<dueDate>`. */
const dueDateOf = (a: Action): IsoDate | null => {
  const m = /^upcoming:.+:(\d{4}-\d{2}-\d{2})$/.exec(a.insightKey ?? '');
  return m ? (m[1] as IsoDate) : null;
};
const contractOfReminder = (a: Action): string | null => /^upcoming:(.+):\d{4}-\d{2}-\d{2}$/.exec(a.insightKey ?? '')?.[1] ?? null;

/**
 * Hält die Entwürfe rund um die Umstellung aktuell (idempotent, feste IDs):
 * offene `stripe_takeover`-Entwürfe folgen dem Stand (über `syncTakeoverDraft`/`cancelTakeoverDraft`),
 * Erinnerungen vor anstehenden Raten und Link-Nachfragen entstehen je Fall genau einmal,
 * überholte Erinnerungen (Fälligkeit vorbei oder Raten laufen über Stripe) werden abgebrochen.
 */
export function ensureTakeoverDrafts(s: AppState, at: Date, isDemo: boolean): AppState {
  const today = todayBerlin(at);
  let st = s;

  for (const a of s.actions) {
    if (a.type !== 'stripe_takeover' || a.status !== 'draft') continue;
    const contractId = String(a.payload.contractId ?? '');
    const r = syncTakeoverDraft(st, contractId, a.payload.mode as never, at, isDemo);
    if (r.outcome === 'blocked') st = cancelTakeoverDraft(st, contractId)?.state ?? st;
    else st = r.state;
  }

  st = {
    ...st,
    actions: st.actions.map((a) => {
      if (!a.id.startsWith(UPCOMING_PREFIX) || a.status !== 'draft') return a;
      const due = dueDateOf(a);
      const cid = contractOfReminder(a);
      if (!due || !cid) return a;
      return due < today || runsViaStripe(st, cid) ? cancelDraft(a) : a;
    }),
  };

  const fresh: Action[] = [];
  const exists = (id: string) => st.actions.some((a) => a.id === id) || fresh.some((a) => a.id === id);
  for (const r of upcomingRates(st, today)) {
    const id = upcomingReminderId(r.contractId, r.dueDate);
    const contract = st.contracts.find((c) => c.id === r.contractId);
    const contact = st.contacts.find((c) => c.id === contract?.contactId);
    if (!contract || !contact || exists(id)) continue;
    const text = upcomingReminderText({ name: contact.name, amountCents: r.amountCents, dueDate: r.dueDate, link: takeoverLinkFor(st, contract.id) });
    fresh.push(upcomingReminderAction({ contract, contact, dueDate: r.dueDate, text, at, isDemo }));
  }
  for (const t of unusedLinks(st, today)) {
    const contact = st.contacts.find((c) => c.id === t.contactId);
    if (!contact || exists(linkNudgeId(t.id))) continue;
    fresh.push(linkNudgeAction({ takeover: t, contact, text: linkNudgeText({ name: contact.name, link: t.link }), at, isDemo }));
  }
  return fresh.length ? { ...st, actions: [...st.actions, ...fresh] } : st;
}
