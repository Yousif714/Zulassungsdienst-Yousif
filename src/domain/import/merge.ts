import type { ImportBatch } from '@/domain/import/batch';
import { classifyBankTx, linkBankReturns, normalizeIban } from '@/domain/matching/payments';
import { upsertImported } from '@/domain/matching/imports';
import type { AppState, Contact, ExternalRef, Invoice, OrderConfirmation, Payment, Subscription } from '@/domain/types';

export interface MergeAdded { contacts: number; invoices: number; payments: number; subscriptions: number }

const refKey = (r: ExternalRef) => `${r.connectionId}:${r.externalId}`;

/**
 * Führt einen Import-Stapel in den Zustand zusammen. Idempotent; Bestätigtes (Verträge, `contractId`,
 * Bestätigungswerte, erledigte Rechnungen) wird nie überschrieben. Verträge fasst der Import gar nicht an.
 */
export function mergeBatch(s: AppState, b: ImportBatch, newId: () => string): { state: AppState; added: MergeAdded } {
  // Kontakte: bekannter externalRef → unverändert (nur Kontaktpersonen werden nachgezogen), sonst neu
  const contacts: Contact[] = [...s.contacts];
  const known = new Set(contacts.flatMap((c) => (c.externalRefs ?? []).map(refKey)));
  let addedContacts = 0;
  for (const c of b.contacts) {
    const knownRef = c.externalRefs.find((r) => known.has(refKey(r)));
    if (knownRef) {
      const at = contacts.findIndex((x) => (x.externalRefs ?? []).some((r) => refKey(r) === refKey(knownRef)));
      // fehlt das Feld im Batch, bleiben vorhandene Kontaktpersonen unverändert
      if (at >= 0 && c.contactPersons && JSON.stringify(contacts[at].contactPersons) !== JSON.stringify(c.contactPersons)) {
        contacts[at] = { ...contacts[at], contactPersons: c.contactPersons };
      }
      continue;
    }
    c.externalRefs.forEach((r) => known.add(refKey(r)));
    contacts.push({ ...c, id: newId() });
    addedContacts++;
  }
  const contactByRef = new Map<string, string>();
  for (const c of contacts) for (const r of c.externalRefs ?? []) if (!contactByRef.has(refKey(r))) contactByRef.set(refKey(r), c.id);
  const resolveContact = (i: { connectionId: Invoice['connectionId']; contactExternalId?: string }): string | null =>
    i.contactExternalId ? (contactByRef.get(refKey({ connectionId: i.connectionId, externalId: i.contactExternalId })) ?? null) : null;

  // Rechnungen
  const inv = upsertImported<Invoice, (typeof b.invoices)[number]>(
    s.invoices,
    b.invoices,
    (next, old) => {
      // lokal erledigt (settleInvoice): nur Lexware selbst (bezahlt/storniert) darf das ändern
      const keepLocal = old !== null && old.settledByPaymentId !== undefined && next.status !== 'paid' && next.status !== 'void';
      const merged = {
        ...next,
        contactId: resolveContact(next) ?? old?.contactId ?? null,
        ...(keepLocal ? { status: old.status, openCents: old.openCents } : {}),
        ...(old?.settledByPaymentId !== undefined ? { settledByPaymentId: old.settledByPaymentId } : {}),
      };
      return merged;
    },
    newId,
  );
  // ältere Rechnungen ohne Kontakt: nachziehen, sobald der Kontakt da ist
  const invoices = inv.items.map((i) => (i.contactId === null && i.contactExternalId ? { ...i, contactId: resolveContact(i) } : i));

  // Auftragsbestätigungen: eigene Liste (nie Forderung), Kontakt wie bei Rechnungen
  const oc = upsertImported<OrderConfirmation, (typeof b.orderConfirmations)[number]>(
    s.orderConfirmations ?? [],
    b.orderConfirmations ?? [],
    (next, old) => ({ ...next, contactId: resolveContact(next) ?? old?.contactId ?? null }),
    newId,
  );
  const orderConfirmations = oc.items.map((x) => (x.contactId === null && x.contactExternalId ? { ...x, contactId: resolveContact(x) } : x));

  // Zahlungen: Bestehende gewinnen (wie mergeImported, aber mit neuer ID und Zählung)
  // Qonto: Rückbuchungen mit Original verknüpfen (sonst verworfen), neue Zahlungen mit Mitglieds-IBANs klassifizieren
  const memberIbans = new Set(s.ibanLinks.map((l) => normalizeIban(l.iban)));
  const isBank = (p: { connectionId: Payment['connectionId'] }) => p.connectionId === 'bank_qonto' || p.connectionId === 'bank_sparkasse';
  const bank = linkBankReturns(s.payments, b.payments.filter(isBank)).map((p) => (p.refundOf ? p : { ...p, kind: classifyBankTx(p, memberIbans) }));
  const incomingPayments = [...b.payments.filter((p) => !isBank(p)), ...bank];
  const pay = upsertImported<Payment, (typeof b.payments)[number]>(s.payments, incomingPayments, (next, old) => (old ?? next), newId);

  // Abos
  const sub = upsertImported<Subscription, (typeof b.subscriptions)[number]>(
    s.subscriptions,
    b.subscriptions,
    (next, old) => ({
      ...next,
      amountCents: next.amountCents ?? old?.amountCents ?? null,
      contractId: old?.contractId ?? null,
      confirmedPriceCents: old?.confirmedPriceCents ?? null,
      confirmedEndDate: old?.confirmedEndDate ?? null,
      disputes: old?.disputes ?? [],
    }),
    newId,
  );

  // Streitfälle: Zahlung (externalId = Rechnung) → Abo
  let subscriptions = sub.items;
  for (const d of b.disputes) {
    if (!d.invoiceExternalId) continue;
    const payment = pay.items.find((p) => p.externalId === d.invoiceExternalId && p.subscriptionExternalId);
    if (!payment) continue;
    subscriptions = subscriptions.map((x) =>
      x.externalId === payment.subscriptionExternalId && !x.disputes.includes(d.externalId) ? { ...x, disputes: [...x.disputes, d.externalId] } : x,
    );
  }

  return {
    state: { ...s, contacts, invoices, orderConfirmations, payments: pay.items, subscriptions },
    added: { contacts: addedContacts, invoices: inv.added, payments: pay.added, subscriptions: sub.added },
  };
}
