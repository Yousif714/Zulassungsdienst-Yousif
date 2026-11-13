import { daysBetween, formatIsoDe, type IsoDate } from '../clock';
import { monthDate } from '../ledger/schedule';
import { nameMatches, normalizeNameStrict } from '../matching/payments';
import { formatEuro } from '../money';
import type { AppState, Contact, ExternalRef, Invoice, OrderConfirmation, Subscription } from '../types';
import { isMembership, parseMembership } from './membership';

export interface ProposalValues { totalCents: number | null; installments: number | null; installmentCents: number | null; dueDay: number | null; startDate: IsoDate | null }
export interface ContractProposal extends ProposalValues {
  id: string; name: string; email: string | null; billing: 'stripe' | 'legacy';
  sources: ExternalRef[]; // Abo bzw. Lexware-Kontakt → Vorschlags-ID und später MemberContract.origin
  contactRefs: ExternalRef[]; // stripe_nexus:cus_…, lexware_nexus:c-…
  sourceLabel: 'Stripe' | 'Lexware' | 'Lexware (AB)' | 'Stripe + Lexware' | 'Portal';
  references: string[]; // 'Abo sub_A', 'Rechnung RE-1043', 'Auftragsbestätigung AB-2001'
  complete: boolean; // vollständig / bitte ergänzen
  steps: string[]; // Rechenweg
  possibleMatch: { id: string; name: string } | null; // „gehört evtl. zu …“
}

const refKey = (r: ExternalRef) => `${r.connectionId}:${r.externalId}`;
export const proposalId = (sources: ExternalRef[]): string => sources.map(refKey).sort().join('+');

/** Fälligkeitstag 31 = letzter Tag des Monats (`monthDate` kürzt auf die Monatslänge). */
export const MONTH_END = 31;

const NO_VALUES: ProposalValues = { totalCents: null, installments: null, installmentCents: null, dueDay: null, startDate: null };
const isComplete = (v: ProposalValues) => Object.values(v).every((x) => x !== null);

type Draft = ContractProposal

function fromSubscription(s: Subscription): Draft {
  const rate = s.amountCents;
  const total = rate !== null && s.installments !== null ? rate * s.installments : null;
  const values: ProposalValues = { totalCents: total, installments: s.installments, installmentCents: rate, dueDay: s.anchorDay, startDate: s.startDate };
  const steps = [`Quelle: Stripe-Abo ${s.externalId} (${s.productName || 'ohne Produktname'}).`];
  if (rate !== null) steps.push(`Rate ${formatEuro(rate)} (zuletzt bezahlte Abo-Rechnung), Fälligkeitstag ${s.anchorDay}., Start ${formatIsoDe(s.startDate)}.`);
  else steps.push('Noch keine bezahlte Abo-Rechnung: Rate unbekannt.');
  if (s.installments !== null && total !== null) steps.push(`${s.installments} Raten${s.endDate ? ` bis ${formatIsoDe(s.endDate)}` : ''} × ${formatEuro(rate!)} = ${formatEuro(total)}.`);
  else steps.push('Kein Enddatum bekannt: Anzahl bitte ergänzen.');
  if (s.currency !== 'eur') steps.push(`Währung ${s.currency.toUpperCase()} statt EUR: bitte prüfen.`);
  if (s.interval !== 'month') steps.push('Kein monatlicher Rhythmus: bitte prüfen.');
  if (s.status === 'canceled') steps.push('Abo ist gekündigt: bitte prüfen.');
  const sources = [{ connectionId: s.connectionId, externalId: s.externalId }];
  return {
    ...values, id: proposalId(sources), name: s.customerName, email: s.customerEmail, billing: 'stripe', sources,
    contactRefs: s.stripeCustomerId ? [{ connectionId: 'stripe_nexus', externalId: s.stripeCustomerId }] : [],
    sourceLabel: 'Stripe', references: [`Abo ${s.externalId}`],
    complete: isComplete(values) && s.currency === 'eur' && s.interval === 'month' && s.status !== 'canceled',
    steps, possibleMatch: null,
  };
}

function fromInvoices(contactExternalId: string, invs: Invoice[], contact: Contact | undefined): Draft {
  const sorted = [...invs].sort((a, b) => a.issuedOn.localeCompare(b.issuedOn));
  const parsed = (i: Invoice) => parseMembership(i.text ?? '')!;
  const sources = [{ connectionId: 'lexware_nexus' as const, externalId: contactExternalId }];
  let values: ProposalValues = NO_VALUES;
  let used = sorted;
  const steps: string[] = [`Quelle: Lexware-Kontakt ${contact?.name ?? contactExternalId}.`];

  // Ratenmuster: gleicher Betrag, 25–35 Tage zwischen aufeinanderfolgenden Rechnungen
  let pattern: Invoice[] | null = null;
  for (const total of new Set(sorted.map((i) => i.totalCents))) {
    const same = sorted.filter((i) => i.totalCents === total);
    const ok = same.length >= 2 && same.every((i, k) => k === 0 || (daysBetween(same[k - 1].issuedOn, i.issuedOn) >= 25 && daysBetween(same[k - 1].issuedOn, i.issuedOn) <= 35));
    if (ok && (!pattern || same.length > pattern.length)) pattern = same;
  }
  if (pattern) {
    used = pattern;
    const rate = pattern[0].totalCents;
    const months = pattern.map((i) => parsed(i).months).reduce<number | null>((m, x) => (x !== null && (m === null || x > m) ? x : m), null);
    const start = pattern[0].dueDate;
    values = { installmentCents: rate, installments: months, totalCents: months !== null ? rate * months : null, startDate: start, dueDay: Number(start.slice(8, 10)) };
    steps.push(`${pattern.length} Rechnungen à ${formatEuro(rate)} im Monatsabstand, erste fällig am ${formatIsoDe(start)}.`);
    steps.push(months !== null ? `Laufzeit ${months} Monate × ${formatEuro(rate)} = ${formatEuro(rate * months)}.` : 'Laufzeit steht in keiner Rechnung: Anzahl bitte ergänzen.');
  } else if (sorted.length === 1) {
    const one = fromSingleDocument(sorted[0], 'Gesamtrechnung', 'Rechnungstext', 'Rechnungsdatum');
    values = one.values;
    steps.push(...one.steps);
  } else {
    steps.push('Rechnungen passen zu keinem Ratenmuster.');
  }
  return {
    ...values, id: proposalId(sources), name: contact?.name ?? contactExternalId, email: contact?.emails[0] ?? null, billing: 'legacy', sources,
    contactRefs: [...sources], sourceLabel: 'Lexware', references: used.map((i) => `Rechnung ${i.number}`),
    complete: isComplete(values), steps, possibleMatch: null,
  };
}

/** Ein Beleg über die ganze Laufzeit (Gesamtrechnung oder AB): Gesamt ÷ Monate; ohne Tag im Text zum Monatsende. */
function fromSingleDocument(doc: { number: string; totalCents: number; issuedOn: IsoDate; text?: string }, kind: string, textLabel: string, dateLabel: string): { values: ProposalValues; steps: string[] } {
  const parsedDoc = parseMembership(doc.text ?? '')!;
  const { months } = parsedDoc;
  // Ohne Tag im Text: fällig zum Monatsende (31 = letzter Tag des Monats). Inhaber: „Hauptsache im Monat gezahlt“.
  const dueDay = parsedDoc.dueDay ?? MONTH_END;
  let startDate: IsoDate = doc.issuedOn;
  if (parsedDoc.dueDay !== null) {
    const [y, m, d] = doc.issuedOn.split('-').map(Number);
    startDate = monthDate(y, m - 1 + (dueDay >= d ? 0 : 1), dueDay);
  }
  const values = {
    totalCents: doc.totalCents, installments: months, installmentCents: months ? Math.floor(doc.totalCents / months) : null,
    dueDay, startDate,
  };
  const steps = [`${kind} ${doc.number} über ${formatEuro(doc.totalCents)}${months !== null ? `, ${months} Monate` : ''}.`];
  if (months !== null) steps.push(`${formatEuro(doc.totalCents)} ÷ ${months} = ${formatEuro(Math.floor(doc.totalCents / months))} pro Monat (abgerundet).`);
  steps.push(parsedDoc.dueDay !== null ? `Fälligkeitstag ${dueDay}. laut ${textLabel}, Start ${formatIsoDe(startDate)}.` : `Kein Fälligkeitstag im Text: fällig zum Monatsende, Start ${formatIsoDe(startDate)} (${dateLabel}).`);
  return { values, steps };
}

/** Vorschlag aus der neuesten Mitgliedschafts-AB eines Lexware-Kontakts (nur, wenn er keine Mitgliedschafts-Rechnung hat). */
function fromOrderConfirmation(contactExternalId: string, ab: OrderConfirmation, contact: Contact | undefined): Draft {
  const sources = [{ connectionId: 'lexware_nexus' as const, externalId: contactExternalId }];
  const one = fromSingleDocument(ab, 'Auftragsbestätigung', 'AB-Text', 'AB-Datum');
  return {
    ...one.values, id: proposalId(sources), name: contact?.name ?? contactExternalId, email: contact?.emails[0] ?? null, billing: 'legacy', sources,
    contactRefs: [...sources], sourceLabel: 'Lexware (AB)', references: [`Auftragsbestätigung ${ab.number}`],
    complete: isComplete(one.values), steps: [`Quelle: Lexware-Kontakt ${contact?.name ?? contactExternalId}, keine Mitgliedschafts-Rechnung.`, ...one.steps], possibleMatch: null,
  };
}

/** Mitgliedschafts-ABs (NEXUS, nicht storniert, mit Laufzeit) mit Lexware-Kontakt. */
export const membershipOrderConfirmations = (s: AppState): OrderConfirmation[] =>
  (s.orderConfirmations ?? []).filter((x) => x.connectionId === 'lexware_nexus' && x.status !== 'void' && !!x.contactExternalId && (parseMembership(x.text ?? '')?.months ?? null) !== null);

export function deriveProposals(s: AppState): ContractProposal[] {
  const consumed = new Set(s.contracts.flatMap((c) => (c.origin ?? []).map(refKey)));

  const stripe = s.subscriptions
    .filter((x) => (isMembership(x.productName) || isMembership(x.invoiceLineText ?? '')) && x.status !== 'incomplete')
    .filter((x) => x.contractId === null && !consumed.has(refKey({ connectionId: x.connectionId, externalId: x.externalId })))
    .map(fromSubscription);

  const byContact = new Map<string, Invoice[]>();
  for (const i of s.invoices) {
    if (i.connectionId !== 'lexware_nexus' || i.status === 'void' || !i.contactExternalId) continue;
    if (!parseMembership(i.text ?? '')) continue;
    if (consumed.has(refKey({ connectionId: 'lexware_nexus', externalId: i.contactExternalId }))) continue;
    byContact.set(i.contactExternalId, [...(byContact.get(i.contactExternalId) ?? []), i]);
  }
  const lexContact = (id: string) => s.contacts.find((c) => (c.externalRefs ?? []).some((r) => r.connectionId === 'lexware_nexus' && r.externalId === id));
  const lex = [...byContact].map(([id, invs]) => fromInvoices(id, invs, lexContact(id)));
  // AB nur, wenn derselbe Kontakt keine Mitgliedschafts-Rechnung hat (die Rechnung gewinnt); je Kontakt die neueste AB.
  const newestAb = new Map<string, OrderConfirmation>();
  for (const ab of membershipOrderConfirmations(s)) {
    const id = ab.contactExternalId!;
    if (byContact.has(id) || consumed.has(refKey({ connectionId: 'lexware_nexus', externalId: id }))) continue;
    const prev = newestAb.get(id);
    if (!prev || ab.issuedOn > prev.issuedOn || (ab.issuedOn === prev.issuedOn && ab.number > prev.number)) newestAb.set(id, ab);
  }
  lex.push(...[...newestAb].map(([id, ab]) => fromOrderConfirmation(id, ab, lexContact(id))));

  // Zusammenführen: gleiche E-Mail oder gleicher normalisierter Name; unsichere Treffer nur als Hinweis
  const mergedStripe = new Map<string, Draft>();
  const rest: Draft[] = [];
  const free = [...stripe];
  const same = (a: Draft, b: Draft) =>
    (a.email !== null && b.email !== null && a.email.toLowerCase() === b.email.toLowerCase()) || (normalizeNameStrict(a.name) !== '' && normalizeNameStrict(a.name) === normalizeNameStrict(b.name));
  for (const l of lex) {
    const hit = free.find((x) => same(x, l));
    if (!hit) { rest.push(l); continue; }
    free.splice(free.indexOf(hit), 1);
    const sources = [...hit.sources, ...l.sources];
    mergedStripe.set(hit.id, {
      ...hit, id: proposalId(sources), sources, contactRefs: [...hit.contactRefs, ...l.contactRefs], sourceLabel: 'Stripe + Lexware',
      email: hit.email ?? l.email, references: [...hit.references, ...l.references],
      steps: [...hit.steps, `Zusätzlich gefunden: Lexware-Kontakt ${l.name} (${l.references.join(', ') || 'ohne Rechnung'}), Werte stammen aus Stripe.`],
    });
  }
  const dismissed = new Set(s.dismissedProposals);
  const unmatchedStripe = free.filter((p) => !dismissed.has(p.id));
  const unmatchedLex = rest.filter((p) => !dismissed.has(p.id));
  for (const a of unmatchedStripe) {
    const b = unmatchedLex.find((l) => nameMatches(a.name, l.name) || nameMatches(l.name, a.name));
    if (b) a.possibleMatch = { id: b.id, name: b.name };
  }
  for (const b of unmatchedLex) {
    const a = unmatchedStripe.find((x) => nameMatches(x.name, b.name) || nameMatches(b.name, x.name));
    if (a) b.possibleMatch = { id: a.id, name: a.name };
  }

  return [...mergedStripe.values(), ...unmatchedStripe, ...unmatchedLex]
    .filter((p) => !dismissed.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

export function findContactFor(p: ContractProposal, contacts: Contact[]): { match: 'ref' | 'email' | 'name' | 'none'; contactId: string | null; name: string | null } {
  const hit = (m: 'ref' | 'email' | 'name', c: Contact) => ({ match: m, contactId: c.id, name: c.name });
  // Mitgliedsverträge gehören zu NEXUS: Kontakte anderer Firmen werden nie wiederverwendet.
  contacts = contacts.filter((c) => c.company === 'nexus');
  const keys = new Set(p.contactRefs.map(refKey));
  const byRef = contacts.find((c) => (c.externalRefs ?? []).some((r) => keys.has(refKey(r))));
  if (byRef) return hit('ref', byRef);
  if (p.email) {
    const e = p.email.toLowerCase();
    const byEmail = contacts.find((c) => c.emails.some((x) => x.toLowerCase() === e));
    if (byEmail) return hit('email', byEmail);
  }
  const n = normalizeNameStrict(p.name);
  const byName = n === '' ? undefined : contacts.find((c) => normalizeNameStrict(c.name) === n);
  if (byName) return hit('name', byName);
  return { match: 'none', contactId: null, name: null };
}
