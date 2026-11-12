import { formatEuro } from '../money';
import type { AppState, Insight } from '../types';
import { jobRef } from './refs';

export function detectJobsNotInvoiced(s: AppState): Insight[] {
  const out: Insight[] = [];
  for (const j of s.jobs) {
    if (j.status !== 'done') continue;
    const invoiced = j.invoiceIds.reduce((n, id) => {
      const i = s.invoices.find((x) => x.id === id);
      return n + (i && i.status !== 'void' ? i.totalCents : 0);
    }, 0);
    const rest = j.priceCents - invoiced;
    if (rest <= 0) continue;
    const name = s.contacts.find((c) => c.id === j.contactId)?.name ?? 'Unbekannt';
    out.push({
      dedupeKey: `job-inv:${j.id}`,
      type: 'job_not_invoiced',
      company: 'zulassung',
      priority: 'today',
      title: `${name}: ${j.service} noch nicht abgerechnet`,
      body: `Auftrag erledigt, Preis ${formatEuro(j.priceCents)}, davon abgerechnet ${formatEuro(invoiced)}. Es fehlen ${formatEuro(rest)}.`,
      amountCents: rest,
      refs: [jobRef(j.id, `${name} · ${j.service}`)],
      nextStep: 'Rechnung erstellen',
      needsSources: ['lexware_zulassung'],
    });
  }
  return out;
}
