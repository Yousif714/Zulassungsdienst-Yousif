import type { ImportBatch } from '@/domain/import/batch';
import { upsertImported } from '@/domain/matching/imports';
import type { AppState, Contact, ExternalRef, Invoice, Payment, Subscription } from '@/domain/types';

export interface MergeAdded { contacts: number; invoices: number; payments: number; subscriptions: number }

const refKey = (r: ExternalRef) => `${r.connectionId}:${r.externalId}`;

/**
 * Führt einen Import-Stapel in den Zustand zusammen. Idempotent; Bestätigtes (Verträge, `contractId`,
 * Bestätigungswerte, erledigte Rechnungen) wird nie überschrieben. Verträge fasst der Import gar nicht an.
 */
export function mergeBatch(s: AppState, b: ImportBatch, newId: () => string): { state: AppState; added: MergeAdded } {
  // Kontakte: bekannter externalRef → unverändert, sonst neu
  const contacts: Contact[] = [...s.contacts];
  const known = new Set(contacts.flatMap((c) => (c.externalRefs ?? []).map(refKey)));
  let addedContacts = 0;
  for (const c of b.contacts) {
    if (c.externalRefs.some((r) => known.has(refKey(r)))) continue;
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

  // Zahlungen: Bestehende gewinnen (wie mergeImported, aber mit neuer ID und Zählung)
  const pay = upsertImported<Payment, (typeof b.payments)[number]>(s.payments, b.payments, (next, old) => (old ?? next), newId);

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
    state: { ...s, contacts, invoices, payments: pay.items, subscriptions },
    added: { contacts: addedContacts, invoices: inv.added, payments: pay.added, subscriptions: sub.added },
  };
}
