import { berlinParts, daysBetween, todayBerlin } from './clock';
import { memberView } from './detectors/members';
import { jobRef, memberRef, threadRef } from './detectors/refs';
import { formatEuro } from './money';
import type { AppState, Insight } from './types';

/** Üblicher Aufpreis für einen Vor-Ort-Termin. */
export const ONSITE_SURCHARGE_CENTS = 3500;

const QUICK_REPLY_MIN = 3;
const QUICK_REPLY_DAYS = 7;
const LATE_DAYS = 4;
const LATE_RUN = 3;
const DELAY_MIN_SAMPLES = 3;
const SURCHARGE_RE = /aufpreis|zuschlag|anfahrt/i;

const normalize = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

function quickReplies(s: AppState, now: Date): Insight[] {
  const from = now.getTime() - QUICK_REPLY_DAYS * 86_400_000;
  const groups = new Map<string, typeof s.messages>();
  for (const m of s.messages) {
    const t = Date.parse(m.sentAt);
    if (m.direction !== 'out' || t < from || t > now.getTime()) continue;
    const key = normalize(m.body).slice(0, 60);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const out: Insight[] = [];
  for (const [key, list] of groups) {
    if (list.length < QUICK_REPLY_MIN) continue;
    const companies = new Set(list.map((m) => s.contacts.find((c) => c.id === m.contactId)?.company ?? null));
    out.push({
      dedupeKey: `coach:quick_reply:${key}`,
      type: 'coach_quick_reply',
      company: companies.size === 1 ? [...companies][0] : null,
      priority: 'info',
      title: 'Schnellantwort anlegen',
      body: `Diese Nachricht ging in den letzten ${QUICK_REPLY_DAYS} Tagen ${list.length}-mal raus: „${list[0].body}“`,
      refs: list.map((m) => threadRef(m.threadId, s.contacts.find((c) => c.id === m.contactId)?.name ?? m.to)),
      nextStep: 'Als Schnellantwort speichern',
      needsSources: [...new Set(list.map((m) => m.connectionId))],
    });
  }
  return out;
}

function dueDays(s: AppState, now: Date): Insight[] {
  const today = todayBerlin(now);
  const out: Insight[] = [];
  for (const c of s.contracts) {
    const v = memberView(s, c.id, today);
    let run: number[] = [];
    let best: number[] = [];
    for (const st of v.states) {
      if (!st.paidOn) break;
      const late = daysBetween(st.dueDate, st.paidOn);
      run = late >= LATE_DAYS ? [...run, late] : [];
      if (run.length > best.length) best = run;
    }
    if (best.length < LATE_RUN) continue;
    const delay = Math.min(...best);
    const newDay = Math.min(28, c.dueDay + delay);
    const name = v.contact?.name ?? 'Mitglied';
    out.push({
      dedupeKey: `coach:due_day:${c.id}`,
      type: 'coach_due_day',
      company: 'nexus',
      priority: 'info',
      title: `Fälligkeitstag für ${name} verschieben`,
      body: `${best.length} Raten in Folge kamen mindestens ${delay} Tage nach Fälligkeit (Tag ${c.dueDay}). Vorschlag: Fälligkeit auf den ${newDay}. des Monats.`,
      refs: [memberRef(c.id, name)],
      nextStep: `Fälligkeitstag auf den ${newDay}. ändern`,
      needsSources: ['bank', 'stripe_nexus'],
    });
  }
  return out;
}

function onsiteSurcharge(s: AppState): Insight[] {
  const jobs = s.jobs.filter((j) => {
    if (j.location !== 'onsite' || j.invoiceIds.length === 0) return false;
    const invs = j.invoiceIds.map((id) => s.invoices.find((i) => i.id === id)).filter((i) => !!i);
    return invs.length > 0 && !invs.some((i) => SURCHARGE_RE.test(i.text ?? ''));
  });
  if (jobs.length === 0) return [];
  const sum = jobs.length * ONSITE_SURCHARGE_CENTS;
  const label = (id: string) => s.contacts.find((c) => c.id === id)?.name ?? 'Kunde';
  return [
    {
      dedupeKey: `coach:onsite:${jobs.map((j) => j.id).sort().join(',')}`,
      type: 'coach_onsite_surcharge',
      company: 'zulassung',
      priority: 'info',
      title: `${jobs.length} Vor-Ort-${jobs.length === 1 ? 'Auftrag' : 'Aufträge'} ohne Aufpreis, zusammen ${formatEuro(sum)}`,
      body: `Auf den Rechnungen fehlt die Aufpreis-Position (je ${formatEuro(ONSITE_SURCHARGE_CENTS)}).`,
      amountCents: sum,
      refs: jobs.map((j) => jobRef(j.id, `${label(j.contactId)} · ${j.service}`)),
      nextStep: 'Aufpreis-Position in die Rechnungsvorlage aufnehmen',
      needsSources: ['lexware_zulassung'],
    },
  ];
}

function invoiceDelay(s: AppState): Insight[] {
  const delays: number[] = [];
  for (const j of s.jobs) {
    if (!j.doneAt) continue;
    const issued = j.invoiceIds
      .map((id) => s.invoices.find((i) => i.id === id)?.issuedOn)
      .filter((d): d is string => !!d)
      .sort()[0];
    if (issued) delays.push(Math.max(0, daysBetween(berlinParts(new Date(j.doneAt)).date, issued)));
  }
  if (delays.length < DELAY_MIN_SAMPLES) return [];
  const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
  if (avg <= 1) return [];
  return [
    {
      dedupeKey: 'coach:invoice_delay:all',
      type: 'coach_invoice_delay',
      company: 'zulassung',
      priority: 'info',
      title: 'Rechnungen direkt nach „erledigt“ schreiben',
      body: `Zwischen „erledigt“ und Rechnung liegen im Schnitt ${avg.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage (${delays.length} Aufträge).`,
      refs: [],
      nextStep: 'Erinnerung direkt nach „erledigt“ einschalten',
      needsSources: ['lexware_zulassung'],
    },
  ];
}

export function runCoach(s: AppState, now: Date): Insight[] {
  const suppressed = new Set(s.settings.suppressedCoachKeys);
  return [...quickReplies(s, now), ...dueDays(s, now), ...onsiteSurcharge(s), ...invoiceDelay(s)].filter(
    (i) => !suppressed.has(i.dedupeKey),
  );
}
