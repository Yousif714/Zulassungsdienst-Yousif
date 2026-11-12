import type { AppState, Job } from './types';

/** Abrechnungsstand eines Auftrags: Summe der verknüpften, nicht stornierten Rechnungen und Rest (Preis minus Summe; negativ = überzahlt). */
export function jobBilling(s: Pick<AppState, 'invoices'>, job: Pick<Job, 'priceCents' | 'invoiceIds'>): { invoicedCents: number; restCents: number } {
  const invoicedCents = job.invoiceIds.reduce((n, id) => {
    const i = s.invoices.find((x) => x.id === id);
    return n + (i && i.status !== 'void' ? i.totalCents : 0);
  }, 0);
  return { invoicedCents, restCents: job.priceCents - invoicedCents };
}
