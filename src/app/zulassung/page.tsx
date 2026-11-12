'use client';

import { CountFigure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { CONTACT_KIND_LABEL, JOB_STATUS_LABEL, JOB_STATUS_ORDER } from '@/components/zulassung-labels';
import { zulassungKpis } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlinDe, now } from '@/domain/clock';
import { areaStale } from '@/domain/freshness';
import { formatEuro } from '@/domain/money';

export default function ZulassungPage() {
  const { state } = useAppStore();
  const at = now();
  const kpis = zulassungKpis(state, at);
  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'zulassung')!;
  const contactName = (id: string) => state.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';
  const customers = state.contacts.filter((c) => c.company === 'zulassung').sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <>
      <PageHeader title="Zulassungsdienst" subtitle={formatBerlinDe(at, 'EEEE, d. MMMM')} />

      <Figures title="Heute" columns={4}>
        <CountFigure label="Heute erledigt" value={kpis.doneToday} testId="kpi-done-today" />
        <CountFigure label="Offen" value={kpis.open} testId="kpi-open" />
        <CountFigure label="Wartet auf Kunde" value={kpis.waiting} testId="kpi-waiting" />
        <CountFigure label="Nicht abgerechnet" value={kpis.notInvoiced ?? '–'} testId="kpi-not-invoiced" />
      </Figures>

      <section className="money-cards" aria-label="Geld">
        <MoneyCard company="zulassung" openCents={money.openCents} overdueCents={money.overdueCents}
          stale={areaStale(MONEY_SOURCES.zulassung, state.connections, at)} />
      </section>

      {JOB_STATUS_ORDER.map((status) => {
        const jobs = state.jobs.filter((j) => j.status === status);
        if (jobs.length === 0) return null;
        return (
          <ListGroup key={status} title={`Aufträge: ${JOB_STATUS_LABEL[status]}`} testId={`jobs-${status}`}>
            {jobs.map((j) => {
              const v = state.vehicles.find((x) => x.id === j.vehicleId);
              return (
                <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`}
                  title={v ? `${v.model} · ${v.plate}` : j.service} subtitle={`${contactName(j.contactId)} · ${j.service}`}
                  value={<span className="amount">{formatEuro(j.priceCents)}</span>} />
              );
            })}
          </ListGroup>
        );
      })}

      <ListGroup title="Kunden" testId="customers">
        {customers.map((c) => {
          const n = state.jobs.filter((j) => j.contactId === c.id).length;
          return (
            <ListRow key={c.id} href={`/zulassung/kunden/${c.id}`} testId={`customer-row-${c.id}`} title={c.name}
              subtitle={`${CONTACT_KIND_LABEL[c.kind]} · ${n === 1 ? '1 Auftrag' : `${n} Aufträge`}`} />
          );
        })}
      </ListGroup>
    </>
  );
}
