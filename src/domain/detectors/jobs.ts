import { jobBilling } from '../billing';
import { formatEuro } from '../money';
import type { AppState, Insight } from '../types';
import { jobRef } from './refs';

export function detectJobsNotInvoiced(s: AppState): Insight[] {
  const out: Insight[] = [];
  for (const j of s.jobs) {
    if (j.status !== 'done') continue;
    const { invoicedCents: invoiced, restCents: rest } = jobBilling(s, j);
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
