import type { Contact, IbanLink, Payment } from '@/domain/types';

export function classifyBankTx(t: { payerName?: string; reference?: string }): 'incoming' | 'stripe_payout' {
  if (/stripe/i.test(t.payerName ?? '') || /stripe/i.test(t.reference ?? '')) return 'stripe_payout';
  return 'incoming';
}

const TITLES = new Set(['dr', 'prof', 'dipl', 'ing', 'med', 'mag']);

/** Vergleichsform eines Namens: klein, Umlaute/ß/türkische Buchstaben aufgelöst, Akzente und Titel (Dr., Prof.) entfernt. */
export function normalizeName(s: string): string {
  const words = s
    .normalize('NFC')
    .toLowerCase()
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
  const rest = words.filter((w) => !TITLES.has(w));
  return (rest.length >= 2 ? rest : words).join(' ');
}

export function nameMatches(contactName: string, payerName: string): boolean {
  const parts = normalizeName(contactName).split(' ').filter(Boolean);
  if (parts.length < 2) return false;
  const last = parts[parts.length - 1];
  const first = parts[0];
  const words = new Set(normalizeName(payerName).split(' ').filter(Boolean));
  return words.has(last) && (words.has(first) || words.has(first[0]));
}

export type Expected = Map<string, { nextRateCents: number; arrearsCents: number }>;
export type MatchResult = { contactId: string | null; confidence: 'high' | 'medium' | 'low'; reason: string };

export function matchBankPayment(
  p: Payment,
  ctx: { contacts: Contact[]; ibanLinks: IbanLink[]; expected: Expected },
): MatchResult {
  if (p.kind === 'stripe_payout') {
    return { contactId: null, confidence: 'low', reason: 'Stripe-Auszahlung wird keinem Mitglied zugeordnet.' };
  }
  const amountFits = (contactId: string) => {
    const e = ctx.expected.get(contactId);
    return !!e && p.amountCents > 0 && (p.amountCents === e.nextRateCents || (e.arrearsCents > 0 && p.amountCents === e.arrearsCents));
  };

  const link = p.iban ? ctx.ibanLinks.find((l) => l.iban === p.iban) : undefined;
  if (link) {
    return amountFits(link.contactId)
      ? { contactId: link.contactId, confidence: 'high', reason: 'Bestätigte IBAN und Betrag passen zur Rate oder zum Rückstand.' }
      : { contactId: link.contactId, confidence: 'medium', reason: 'Bestätigte IBAN, aber der Betrag weicht ab.' };
  }
  if (p.payerName) {
    const hit = ctx.contacts.find((c) => nameMatches(c.name, p.payerName!) && amountFits(c.id));
    if (hit) return { contactId: hit.id, confidence: 'medium', reason: 'Name und Betrag passen, IBAN ist noch nicht verknüpft.' };
  }
  return { contactId: null, confidence: 'low', reason: 'Kein sicherer Treffer, bitte manuell zuordnen.' };
}

/** IBAN-Schreibweise vereinheitlichen: Leerraum raus, Großbuchstaben. */
export function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}
