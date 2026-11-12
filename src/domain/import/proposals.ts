import { daysBetween, formatIsoDe, type IsoDate } from '../clock';
import { monthDate } from '../ledger/schedule';
import { nameMatches, normalizeName } from '../matching/payments';
import { formatEuro } from '../money';
import type { AppState, Contact, ExternalRef, Invoice, Subscription } from '../types';
import { isMembership, parseMembership } from './membership';

export interface ProposalValues { totalCents: number | null; installments: number | null; installmentCents: number | null; dueDay: number | null; startDate: IsoDate | null }
export interface ContractProposal extends ProposalValues {
  id: string; name: string; email: string | null; billing: 'stripe' | 'legacy';
  sources: ExternalRef[]; // Abo bzw. Lexware-Kontakt → Vorschlags-ID und später MemberContract.origin
  contactRefs: ExternalRef[]; // stripe_nexus:cus_…, lexware_nexus:c-…
  sourceLabel: 'Stripe' | 'Lexware' | 'Stripe + Lexware';
  references: string[]; // 'Abo sub_A', 'Rechnung RE-1043'
  complete: boolean; // vollständig / bitte ergänzen
  steps: string[]; // Rechenweg
  possibleMatch: { id: string; name: string } | null; // „gehört evtl. zu …“
}

const refKey = (r: ExternalRef) => `${r.connectionId}:${r.externalId}`;
export const proposalId = (sources: ExternalRef[]): string => sources.map(refKey).sort().join('+');

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
    const inv = sorted[0];
    const { months, dueDay } = parsed(inv);
    let startDate: IsoDate = inv.issuedOn;
    if (dueDay !== null) {
      const [y, m, d] = inv.issuedOn.split('-').map(Number);
      startDate = monthDate(y, m - 1 + (dueDay >= d ? 0 : 1), dueDay);
    }
    values = {
      totalCents: inv.totalCents, installments: months, installmentCents: months ? Math.floor(inv.totalCents / months) : null,
      dueDay, startDate,
    };
    steps.push(`Gesamtrechnung ${inv.number} über ${formatEuro(inv.totalCents)}${months !== null ? `, ${months} Monate` : ''}.`);
    if (months !== null) steps.push(`${formatEuro(inv.totalCents)} ÷ ${months} = ${formatEuro(Math.floor(inv.totalCents / months))} pro Monat (abgerundet).`);
    steps.push(dueDay !== null ? `Fälligkeitstag ${dueDay}. laut Rechnungstext, Start ${formatIsoDe(startDate)}.` : `Kein Fälligkeitstag im Text: Start vorläufig ${formatIsoDe(startDate)} (Rechnungsdatum), Tag bitte ergänzen.`);
  } else {
    steps.push('Rechnungen passen zu keinem Ratenmuster.');
  }
  return {
    ...values, id: proposalId(sources), name: contact?.name ?? contactExternalId, email: contact?.emails[0] ?? null, billing: 'legacy', sources,
    contactRefs: [...sources], sourceLabel: 'Lexware', references: used.map((i) => `Rechnung ${i.number}`),
    complete: isComplete(values), steps, possibleMatch: null,
  };
}

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
  const lex = [...byContact].map(([id, invs]) => {
    const contact = s.contacts.find((c) => (c.externalRefs ?? []).some((r) => r.connectionId === 'lexware_nexus' && r.externalId === id));
    return fromInvoices(id, invs, contact);
  });

  // Zusammenführen: gleiche E-Mail oder gleicher normalisierter Name; unsichere Treffer nur als Hinweis
  const mergedStripe = new Map<string, Draft>();
  const rest: Draft[] = [];
  const free = [...stripe];
  const same = (a: Draft, b: Draft) =>
    (a.email !== null && b.email !== null && a.email.toLowerCase() === b.email.toLowerCase()) || (normalizeName(a.name) !== '' && normalizeName(a.name) === normalizeName(b.name));
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
  const keys = new Set(p.contactRefs.map(refKey));
  const byRef = contacts.find((c) => (c.externalRefs ?? []).some((r) => keys.has(refKey(r))));
  if (byRef) return hit('ref', byRef);
  if (p.email) {
    const e = p.email.toLowerCase();
    const byEmail = contacts.find((c) => c.emails.some((x) => x.toLowerCase() === e));
    if (byEmail) return hit('email', byEmail);
  }
  const n = normalizeName(p.name);
  const byName = n === '' ? undefined : contacts.find((c) => c.company === 'nexus' && normalizeName(c.name) === n);
  if (byName) return hit('name', byName);
  return { match: 'none', contactId: null, name: null };
}
