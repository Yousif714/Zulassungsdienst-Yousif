import type { ImportedPayment } from '@/domain/import/batch';
import { distributeInOrder } from '@/domain/ledger/distribute';
import type { Allocation, AppState, Company, Contact, IbanLink, IsoDate, Payment } from '@/domain/types';

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
function normalizeWords(s: string, stripCompany: boolean): string {
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
  const noCompany = stripCompany ? words.filter((w) => !COMPANY_WORDS.has(w)) : words;
  const base = noCompany.length >= 1 ? noCompany : words;
  const rest = base.filter((w) => !TITLES.has(w));
  return (rest.length >= 2 ? rest : base).join(' ');
}

/** Großzügige Vergleichsform (Firmenzusätze wie GmbH/UG entfernt) – für den Bankabgleich. */
export function normalizeName(s: string): string {
  return normalizeWords(s, true);
}

/** Strenge Vergleichsform (Firmenzusätze bleiben) – für Vertragsvorschläge: „Müller GmbH“, „Müller UG“, „Müller“ sind verschieden. */
export function normalizeNameStrict(s: string): string {
  return normalizeWords(s, false);
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
export interface MatchInvoice { id: string; number: string; contactId: string | null; openCents: number; contractId: string | null; dueDate: IsoDate; totalCents: number; paidInLexware?: true }
export interface MatchContext { company: Company; contacts: Contact[]; ibanLinks: IbanLink[]; expected: Expected; invoices: MatchInvoice[] }
export type MatchTarget =
  | { kind: 'contract'; id: string; contactId: string }
  | { kind: 'invoice'; id: string; contactId: string | null }
  /** Sammelzahlung (nur Zulassung): `id` = `invoiceIds.join(',')`. */
  | { kind: 'invoices'; id: string; contactId: string; invoiceIds: string[] };
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
    const i = ctx.invoices.find((x) => x.id === t.id);
    return !!i && (i.paidInLexware ? i.totalCents : i.openCents) === p.amountCents;
  };
  // Sammelziel über mehrere offene Rechnungen eines Kontakts; Summe = Betrag → high, sonst Verteilung prüfen.
  const invoicesTarget = (contactId: string, list: MatchInvoice[]): MatchTarget => ({ kind: 'invoices', id: list.map((i) => i.id).join(','), contactId, invoiceIds: list.map((i) => i.id) });
  const sumFits = (list: MatchInvoice[]) => list.reduce((n, i) => n + i.openCents, 0) === p.amountCents;
  const zulassung = ctx.company === 'zulassung';
  const targetsOf = (contactId: string): MatchTarget[] => [
    ...[...ctx.expected].filter(([, e]) => e.contactId === contactId).map(([id]) => contractTarget(id, contactId)),
    ...ctx.invoices.filter((i) => i.contactId === contactId && i.contractId === null && i.openCents > 0).map(invoiceTarget),
  ];

  if (p.reference) {
    const hits = ctx.invoices.filter((i) => referenceHasNumber(p.reference!, i.number));
    if (hits.length > 0) {
      const open = hits.filter((i) => i.openCents > 0);
      const contactId = open[0]?.contactId;
      if (zulassung && open.length >= 2 && contactId && open.every((i) => i.contactId === contactId && i.contractId === null)) {
        return sumFits(open)
          ? result([invoicesTarget(contactId, open)], 'high', 'Mehrere Rechnungsnummern im Verwendungszweck, Summe passt.')
          : result([invoicesTarget(contactId, open)], 'medium', 'Mehrere Rechnungsnummern, Summe weicht ab – Verteilung prüfen.');
      }
      const asTarget = (i: MatchInvoice) => (i.contractId ? contractTarget(i.contractId, i.contactId) : invoiceTarget(i));
      const all = distinct(hits.map(asTarget));
      if (all.length > 1) return result(all, 'medium', 'Mehrere Rechnungen passen zur Nummer, bitte auswählen.');
      if (zulassung && hits.length === 1 && hits[0].paidInLexware) {
        return fits(all[0])
          ? result(all, 'high', 'Rechnungsnummer im Verwendungszweck, in Lexware schon bezahlt.')
          : result(all, 'medium', 'Rechnungsnummer gefunden, Betrag weicht ab (Teilzahlung?).');
      }
      return all.some(fits)
        ? result(all, 'high', 'Rechnungsnummer im Verwendungszweck, Betrag passt.')
        : result(all, 'medium', 'Rechnungsnummer gefunden, Betrag weicht ab (Teilzahlung?).');
    }
  }

  const iban = p.iban ? normalizeIban(p.iban) : '';
  const linkedContactIds = iban ? [...new Set(ctx.ibanLinks.filter((l) => normalizeIban(l.iban) === iban).map((l) => l.contactId))] : [];
  if (linkedContactIds.length > 1) {
    // Eine IBAN, mehrere Mitglieder (z. B. Firma zahlt für zwei): nie automatisch, immer Auswahl.
    const all = linkedContactIds.flatMap(targetsOf);
    const fitting = all.filter(fits);
    return result(fitting.length > 0 ? fitting : all, 'medium', 'Diese IBAN gehört zu mehreren Mitgliedern, bitte auswählen.');
  }
  if (linkedContactIds.length === 1) {
    const all = targetsOf(linkedContactIds[0]);
    const fitting = all.filter(fits);
    if (fitting.length === 1) return result(fitting, 'high', 'Bestätigte IBAN und Betrag passen.');
    if (fitting.length > 1) return result(fitting, 'medium', 'Mehrere Verträge oder Rechnungen passen, bitte auswählen.');
    const open = ctx.invoices.filter((i) => i.contactId === linkedContactIds[0] && i.contractId === null && i.openCents > 0);
    if (zulassung && open.length >= 2) {
      return sumFits(open)
        ? result([invoicesTarget(linkedContactIds[0], open)], 'high', 'Bestätigte IBAN, Summe aller offenen Rechnungen passt.')
        : result([invoicesTarget(linkedContactIds[0], open)], 'medium', 'Bestätigte IBAN, Betrag auf offene Rechnungen verteilt – bitte prüfen.');
    }
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

/**
 * Rückbuchungen (Betrag < 0) mit ihrem Original verknüpfen (`refundOf`): gleiche Verbindung, Betrag spiegelbildlich,
 * gleiche IBAN, nicht später gebucht, jüngstes zuerst, jedes Original nur einmal. Ohne Original wird die Rückbuchung verworfen.
 * Bereits bekannte Rückbuchungen bleiben unberührt (Bestehendes gewinnt).
 */
export function linkBankReturns(payments: Payment[], incoming: ImportedPayment[]): ImportedPayment[] {
  const known = new Set(payments.map((p) => `${p.connectionId}:${p.externalId}`));
  const used = new Set(payments.filter((p) => p.refundOf).map((p) => `${p.connectionId}:${p.refundOf}`));
  const pool = [...payments, ...incoming.filter((p) => p.amountCents > 0)];
  const out: ImportedPayment[] = [];
  for (const p of incoming) {
    if (p.amountCents >= 0 || known.has(`${p.connectionId}:${p.externalId}`)) { out.push(p); continue; }
    const iban = p.iban ? normalizeIban(p.iban) : undefined;
    const original = pool
      .filter((o) => o.connectionId === p.connectionId && o.amountCents === -p.amountCents && o.bookedOn <= p.bookedOn
        && o.kind === 'incoming' && !o.ignoredAt && !!iban && !!o.iban && normalizeIban(o.iban) === iban && !used.has(`${o.connectionId}:${o.externalId}`))
      // jüngstes zuerst; bei gleichem Tag deterministisch nach externalId (größere zuerst)
      .sort((a, b) => (a.bookedOn !== b.bookedOn ? (a.bookedOn < b.bookedOn ? 1 : -1) : a.externalId < b.externalId ? 1 : a.externalId > b.externalId ? -1 : 0))[0];
    if (!original) continue;
    used.add(`${original.connectionId}:${original.externalId}`);
    out.push({ ...p, refundOf: original.externalId });
  }
  return out;
}

/**
 * Rückbuchungen der Bank (Betrag < 0, `refundOf`) folgen den Zielen der Originalzahlung; ohne Zuordnung des Originals entsteht nichts.
 * Das Original kann mehrere Zuordnungen haben (Sammelzahlung): gegengebucht wird jüngste Rechnung zuerst, je Ziel höchstens
 * die Zuordnung des Originals minus schon vorhandene Rückbuchungen darauf (nie mehr storniert als zugeordnet).
 */
export function bankReturnAllocations(s: AppState): Allocation[] {
  const allocated = new Set(s.allocations.map((a) => a.paymentId));
  const out: Allocation[] = [];
  const keyOf = (a: Allocation) => (a.invoiceId ? `invoice:${a.invoiceId}` : `contract:${a.contractId}`);
  const due = (a: Allocation) => (a.invoiceId ? s.invoices.find((i) => i.id === a.invoiceId)?.dueDate ?? '' : '');
  for (const p of s.payments) {
    if (p.source !== 'bank' || p.amountCents >= 0 || !p.refundOf || allocated.has(p.id)) continue;
    const original = s.payments.find((x) => x.id !== p.id && x.connectionId === p.connectionId && x.externalId === p.refundOf);
    if (!original) continue;
    // Je Ziel zusammengefasst: Zuordnung des Originals plus (negative) Rückbuchungen aller Rückbuchungen desselben Originals.
    const returnIds = new Set(s.payments.filter((x) => x.connectionId === p.connectionId && x.refundOf === p.refundOf).map((x) => x.id));
    const targets = new Map<string, { a: Allocation; capCents: number }>();
    for (const a of s.allocations) {
      if (a.paymentId !== original.id || a.amountCents <= 0) continue;
      const t = targets.get(keyOf(a));
      targets.set(keyOf(a), { a, capCents: (t?.capCents ?? 0) + a.amountCents });
    }
    if (targets.size === 0) continue;
    for (const a of [...s.allocations, ...out]) {
      const t = returnIds.has(a.paymentId) && a.amountCents < 0 ? targets.get(keyOf(a)) : undefined;
      if (t) t.capCents += a.amountCents;
    }
    const ordered = [...targets.values()].sort((x, y) => due(y.a).localeCompare(due(x.a)));
    const { shares } = distributeInOrder(-p.amountCents, ordered.map((t, i) => ({ id: String(i), capCents: t.capCents })));
    for (const sh of shares) {
      const a = ordered[Number(sh.id)].a;
      out.push(a.invoiceId
        ? { paymentId: p.id, invoiceId: a.invoiceId, amountCents: -sh.amountCents, method: 'auto' }
        : { paymentId: p.id, contractId: a.contractId!, amountCents: -sh.amountCents, method: 'auto' });
    }
  }
  return out;
}
