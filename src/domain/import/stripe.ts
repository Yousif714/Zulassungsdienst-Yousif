import { todayBerlin } from '../clock';
import { monthDate } from '../ledger/schedule';
import type { IsoDate, Payment } from '../types';
import type { ImportBatch, ImportedDispute, ImportedPayment, ImportedSubscription } from './batch';
import { parseMembership } from './membership';

/**
 * Stripe-API-Version (Header `Stripe-Version`). Feldform des Mappers bezieht sich darauf:
 * Abo-Bezug einer Rechnung steht unter `parent.subscription_details.subscription`
 * (vor 2025-03-31 unter `subscription`; beides wird gelesen).
 */
export const STRIPE_API_VERSION = '2025-09-30.clover';

export interface StripeRaw {
  subscriptions: unknown[]; // /v1/subscriptions?status=all, customer und schedule expandiert
  products: unknown[]; // /v1/products
  invoices: unknown[]; // /v1/invoices?status=paid
  refunds: (unknown & { invoiceId: string | null })[]; // Connector löst die Rechnung auf
  disputes: (unknown & { invoiceId: string | null })[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

const CONNECTION_ID = 'stripe_nexus' as const;
const date = (sec: number): IsoDate => todayBerlin(new Date(sec * 1000));
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : v && typeof (v as Obj).id === 'string' ? (v as Obj).id : null);

/** Anzahl Abrechnungsperioden k ≥ 0 mit Datum(Start + k Monate, Starttag) < Ende. */
export function billingPeriods(start: IsoDate, end: IsoDate): number {
  const [y, m, d] = start.split('-').map(Number);
  let k = 0;
  while (monthDate(y, m - 1 + k, d) < end) k++;
  return k;
}

function subscriptionOfInvoice(inv: Obj): string | null {
  return asStr(inv.parent?.subscription_details?.subscription) ?? asStr(inv.subscription);
}

function paidDate(inv: Obj): IsoDate {
  return date(inv.status_transitions?.paid_at ?? inv.created);
}

function mapStatus(s: string): ImportedSubscription['status'] {
  return (['active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'trialing'] as const).find((x) => x === s) ?? 'other';
}

export function mapStripe(raw: StripeRaw): ImportBatch {
  const productNames = new Map<string, string>();
  for (const p of raw.products as Obj[]) productNames.set(p.id, p.name);

  // F9: nur bezahlte Rechnungen mit Abo-Bezug; nur EUR (Cent-Beträge ohne Umrechnung)
  const invoices = (raw.invoices as Obj[]).filter((i) => i.status === 'paid' && i.currency === 'eur' && subscriptionOfInvoice(i));

  const payments: ImportedPayment[] = invoices.map((inv) => ({
    company: 'nexus',
    source: 'stripe',
    connectionId: CONNECTION_ID,
    externalId: inv.id,
    amountCents: inv.amount_paid,
    bookedOn: paidDate(inv),
    payerName: inv.customer_name ?? undefined,
    reference: inv.number ?? inv.lines?.data?.[0]?.description ?? inv.id,
    kind: 'incoming' as Payment['kind'],
    subscriptionExternalId: subscriptionOfInvoice(inv) ?? undefined,
  }));

  const invById = new Map(invoices.map((i) => [i.id as string, i]));
  for (const r of raw.refunds as Obj[]) {
    const inv = r.invoiceId ? invById.get(r.invoiceId) : undefined;
    // nur erfolgreiche EUR-Erstattungen zu importierten Abo-Rechnungen
    if (!inv || r.status !== 'succeeded' || r.currency !== 'eur') continue;
    payments.push({
      company: 'nexus',
      source: 'stripe',
      connectionId: CONNECTION_ID,
      externalId: r.id,
      amountCents: -r.amount,
      bookedOn: date(r.created),
      payerName: inv.customer_name ?? undefined,
      reference: `Erstattung${inv.number ? ` ${inv.number}` : ''}`,
      kind: 'incoming',
      subscriptionExternalId: subscriptionOfInvoice(inv) ?? undefined,
      refundOf: inv.id,
    });
  }

  const subscriptions: ImportedSubscription[] = (raw.subscriptions as Obj[]).map((s) => {
    const item = s.items?.data?.[0];
    const price = item?.price ?? {};
    const productId = asStr(price.product);
    const productName: string = (productId && productNames.get(productId)) || price.product?.name || item?.plan?.nickname || '';
    const startDate = date(s.start_date);
    const cancelAt: IsoDate | null = s.cancel_at ? date(s.cancel_at) : null;
    const phases: Obj[] = s.schedule?.phases ?? [];
    const scheduleEnd = phases.length ? phases[phases.length - 1].end_date : null;
    const endDate: IsoDate | null = cancelAt ?? (scheduleEnd ? date(scheduleEnd) : null);

    const mine = invoices.filter((i) => subscriptionOfInvoice(i) === s.id).sort((a, b) => paidDate(b).localeCompare(paidDate(a)));
    const latest = mine[0];

    return {
      connectionId: CONNECTION_ID,
      externalId: s.id,
      stripeCustomerId: asStr(s.customer) ?? '',
      customerName: s.customer?.name ?? '',
      customerEmail: s.customer?.email ?? null,
      productName,
      amountCents: latest ? latest.amount_paid : null,
      priceCents: price.unit_amount ?? null,
      currency: s.currency ?? price.currency ?? 'eur',
      interval: price.recurring?.interval === 'month' && price.recurring?.interval_count === 1 ? 'month' : 'other',
      startDate,
      anchorDay: Number((s.billing_cycle_anchor ? date(s.billing_cycle_anchor) : startDate).slice(8, 10)),
      cancelAt,
      endDate,
      installments: endDate ? billingPeriods(startDate, endDate) : (parseMembership(productName)?.months ?? null),
      status: mapStatus(s.status),
    };
  });

  const disputes: ImportedDispute[] = (raw.disputes as Obj[]).map((d) => ({ externalId: d.id, invoiceExternalId: d.invoiceId ?? null }));

  return { contacts: [], invoices: [], payments, subscriptions, disputes };
}
