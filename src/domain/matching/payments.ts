import type { Allocation, AppState, Contact, IbanLink, Payment } from '@/domain/types';

const STRIPE_WORDS = new Set(['stripe', 'payments', 'technologies', 'technology', 'europe', 'ltd', 'limited', 'uk', 'ie', 'inc']);

/** Stripe-Auszahlung nur am Absendernamen (eng) und nur, wenn die IBAN keinem Mitglied gehört. */
export function classifyBankTx(
  t: { payerName?: string; reference?: string; iban?: string },
  memberIbans?: ReadonlySet<string>,
): 'incoming' | 'stripe_payout' {
  const words = normalizeName(t.payerName ?? '').split(' ').filter(Boolean);
  const looksLikeStripe = words[0] === 'stripe' && words.every((w) => STRIPE_WORDS.has(w));
  if (!looksLikeStripe) return 'incoming';
  if (t.iban && memberIbans?.has(normalizeIban(t.iban))) return 'incoming';
  return 'stripe_payout';
}

const TITLES = new Set(['dr', 'prof', 'dipl', 'ing', 'med', 'mag']);
const COMPANY_WORDS = new Set(['gmbh', 'mbh', 'ug', 'haftungsbeschraenkt', 'gbr', 'kg', 'ohg', 'ag', 'co', 'und', 'ek']);

/** Vergleichsform eines Namens: klein, Umlaute/ß/türkische Buchstaben aufgelöst, Akzente und Titel (Dr., Prof.) entfernt. */
export function normalizeName(s: string): string {
  const words = s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\be\.\s?k\./g, ' ek ')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const noCompany = words.filter((w) => !COMPANY_WORDS.has(w));
  const base = noCompany.length >= 1 ? noCompany : words;
  const rest = base.filter((w) => !TITLES.has(w));
  return (rest.length >= 2 ? rest : base).join(' ');
}

export function nameMatches(contactName: string, payerName: string): boolean {
  const parts = normalizeName(contactName).split(' ').filter(Boolean);
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1];
  const first = parts[0];
  const words = new Set(normalizeName(payerName).split(' ').filter(Boolean));
  return words.has(last) && (words.has(first) || words.has(first[0]));
}

export function contactNameMatches(c: Contact, payerName: string): boolean {
  return nameMatches(c.name, payerName) || (c.contactPersons ?? []).some((n) => nameMatches(n, payerName));
}

/** Rechnungsnummer im Verwendungszweck: Groß-/Kleinschreibung egal, Bindestrich/Leerzeichen optional, keine Ziffer rechts, kein Zeichen links. */
export function referenceHasNumber(reference: string, number: string): boolean {
  const parts = number.split(/[-\s]+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (parts.length === 0) return false;
  return new RegExp(`(?<![a-z0-9])${parts.join('[-\\s]?')}(?![0-9])`, 'i').test(reference);
}

export interface ExpectedContract { contactId: string; rateCents: number; nextRateCents: number; arrearsCents: number; openCents: number }
/** Schlüssel: Vertrags-ID. */
export type Expected = Map<string, ExpectedContract>;

export function amountFitsContract(a: number, e: ExpectedContract): boolean {
  return a > 0 && (
    a === e.nextRateCents || a === e.rateCents ||
    (e.rateCents > 0 && a % e.rateCents === 0 && a <= e.openCents) ||
    (e.arrearsCents > 0 && a === e.arrearsCents) ||
    (e.openCents > 0 && a === e.openCents)
  );
}

/** contractId = abdeckender Vertrag (coveringContract), sonst null. */
export interface MatchInvoice { id: string; number: string; contactId: string | null; openCents: number; contractId: string | null }
export interface MatchContext { contacts: Contact[]; ibanLinks: IbanLink[]; expected: Expected; invoices: MatchInvoice[] }
export type MatchTarget = { kind: 'contract'; id: string; contactId: string } | { kind: 'invoice'; id: string; contactId: string | null };
export type MatchResult = { target: MatchTarget | null; candidates: MatchTarget[]; confidence: 'high' | 'medium' | 'low'; reason: string };

const same = (a: MatchTarget, b: MatchTarget) => a.kind === b.kind && a.id === b.id;
const distinct = (l: MatchTarget[]) => l.filter((t, i) => l.findIndex((x) => same(x, t)) === i);

export function matchBankPayment(p: Payment, ctx: MatchContext): MatchResult {
  const result = (candidates: MatchTarget[], confidence: MatchResult['confidence'], reason: string): MatchResult => {
    const c = distinct(candidates);
    return { target: c.length === 1 ? c[0] : null, candidates: c, confidence: confidence === 'high' && c.length !== 1 ? 'medium' : confidence, reason };
  };
  if (p.kind === 'stripe_payout') return result([], 'low', 'Stripe-Auszahlung wird keinem Mitglied zugeordnet.');
  if (p.amountCents <= 0) return result([], 'low', 'Betrag ≤ 0 wird nie gutgeschrieben.');

  const contractTarget = (id: string, fallback: string | null): MatchTarget => ({ kind: 'contract', id, contactId: ctx.expected.get(id)?.contactId ?? fallback ?? '' });
  const invoiceTarget = (i: MatchInvoice): MatchTarget => ({ kind: 'invoice', id: i.id, contactId: i.contactId });
  const fits = (t: MatchTarget) => {
    if (t.kind === 'contract') {
      const e = ctx.expected.get(t.id);
      return !!e && amountFitsContract(p.amountCents, e);
    }
    return ctx.invoices.find((i) => i.id === t.id)?.openCents === p.amountCents;
  };
  const targetsOf = (contactId: string): MatchTarget[] => [
    ...[...ctx.expected].filter(([, e]) => e.contactId === contactId).map(([id]) => contractTarget(id, contactId)),
    ...ctx.invoices.filter((i) => i.contactId === contactId && i.contractId === null && i.openCents > 0).map(invoiceTarget),
  ];

  if (p.reference) {
    const hits = ctx.invoices.filter((i) => referenceHasNumber(p.reference!, i.number));
    if (hits.length > 0) {
      const asTarget = (i: MatchInvoice) => (i.contractId ? contractTarget(i.contractId, i.contactId) : invoiceTarget(i));
      const all = distinct(hits.map(asTarget));
      if (all.length > 1) return result(all, 'medium', 'Mehrere Rechnungen passen zur Nummer, bitte auswählen.');
      return all.some(fits)
        ? result(all, 'high', 'Rechnungsnummer im Verwendungszweck, Betrag passt.')
        : result(all, 'medium', 'Rechnungsnummer gefunden, Betrag weicht ab (Teilzahlung?).');
    }
  }

  const iban = p.iban ? normalizeIban(p.iban) : '';
  const link = iban ? ctx.ibanLinks.find((l) => normalizeIban(l.iban) === iban) : undefined;
  if (link) {
    const all = targetsOf(link.contactId);
    const fitting = all.filter(fits);
    if (fitting.length === 1) return result(fitting, 'high', 'Bestätigte IBAN und Betrag passen.');
    if (fitting.length > 1) return result(fitting, 'medium', 'Mehrere Verträge oder Rechnungen passen, bitte auswählen.');
    return result(all, 'medium', 'Bestätigte IBAN, aber der Betrag weicht ab.');
  }

  if (p.payerName) {
    const fitting = ctx.contacts.filter((c) => contactNameMatches(c, p.payerName!)).flatMap((c) => targetsOf(c.id)).filter(fits);
    const c = distinct(fitting);
    if (c.length === 1) return result(c, 'medium', 'Name und Betrag passen, IBAN ist noch nicht verknüpft.');
    if (c.length > 1) return result(c, 'medium', 'Mehrere Verträge oder Rechnungen passen, bitte auswählen.');
  }
  return result([], 'low', 'Kein sicherer Treffer, bitte manuell zuordnen.');
}

/** IBAN-Schreibweise vereinheitlichen: Leerraum raus, Großbuchstaben. */
export function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

/** Rückbuchungen der Bank (Betrag < 0, `refundOf`) folgen dem Ziel der Originalzahlung; ohne Zuordnung des Originals entsteht nichts. */
export function bankReturnAllocations(s: AppState): Allocation[] {
  const allocated = new Set(s.allocations.map((a) => a.paymentId));
  const out: Allocation[] = [];
  for (const p of s.payments) {
    if (p.source !== 'bank' || p.amountCents >= 0 || !p.refundOf || allocated.has(p.id)) continue;
    const original = s.payments.find((x) => x.id !== p.id && x.connectionId === p.connectionId && x.externalId === p.refundOf);
    const a = original ? s.allocations.find((x) => x.paymentId === original.id) : undefined;
    if (!a) continue;
    out.push(a.invoiceId
      ? { paymentId: p.id, invoiceId: a.invoiceId, amountCents: p.amountCents, method: 'auto' }
      : { paymentId: p.id, contractId: a.contractId!, amountCents: p.amountCents, method: 'auto' });
  }
  return out;
}
