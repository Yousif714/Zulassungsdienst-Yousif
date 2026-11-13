'use client';

import { useState } from 'react';

import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { TrafficDot } from '@/components/TrafficDot';
import { memberRows, portalRows, nexusForecast, stripeLexCases, unallocatedBankPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlin, formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { areaStale } from '@/domain/freshness';
import { deriveProposals } from '@/domain/import/proposals';
import { nexusReceivables } from '@/domain/ledger/receivables';
import { formatEuro } from '@/domain/money';
import { portalSummary } from '@/domain/portal';

type Filter = 'all' | 'overdue';

export default function NexusPage() {
  const { state } = useAppStore();
  const [filter, setFilter] = useState<Filter>('all');
  const at = now();
  const today = todayBerlin(at);

  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'nexus')!;
  const forecast = nexusForecast(state, today);
  const rows = memberRows(state, today).sort((a, b) => b.arrearsCents - a.arrearsCents || a.name.localeCompare(b.name, 'de'));
  const shown = filter === 'overdue' ? rows.filter((r) => r.traffic !== 'green') : rows;
  const receivables = nexusReceivables(state, today);
  const toMatch = unallocatedBankPayments(state).length + stripeLexCases(state).length;
  const openProposals = deriveProposals(state).length;
  const portal = portalSummary(portalRows(state, today));
  const calls = [...state.calls].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const contentOpen = state.content.filter((c) => c.stage !== 'published').length;

  return (
    <>
      <PageHeader title="NEXUS" />

      <section className="money-cards" aria-label="Geld">
        <MoneyCard company="nexus" openCents={money.openCents} overdueCents={money.overdueCents} stale={areaStale(MONEY_SOURCES.nexus, state.connections, at)} />
      </section>

      <ListGroup title="Monatsvorschau">
        <ListRow key="forecast" testId="forecast" title={formatBerlinDe(at, 'MMMM yyyy')}
          subtitle={<>erwartet <span className="amount">{formatEuro(forecast.expectedCents)}</span>, davon <span className="amount">{formatEuro(forecast.atRiskCents)}</span> wackelig</>} />
        <ListRow key="match" href="/nexus/zuordnen" title={`Zuordnen (${toMatch})`} testId="match-link" />
        <ListRow key="open" href="/nexus/offen" title={`Offen (${formatEuro(receivables.totalCents)})`} testId="open-link" />
        <ListRow key="portal" href="/nexus/mitglieder" testId="portal-link" title={`Portal-Mitglieder (${portal.total})`}
          value={portal.total === 0 ? 'Liste einfügen' : `${portal.noInvoice} ohne Rechnung`} />
      </ListGroup>

      {openProposals > 0 && (
        <ListGroup title="Verträge">
          <ListRow key="proposals" href="/nexus/mitglieder/vorschlaege" testId="proposals-card"
            title={openProposals === 1 ? '1 Vertrag zum Bestätigen' : `${openProposals} Verträge zum Bestätigen`} />
        </ListGroup>
      )}

      <section className="list-group" aria-labelledby="members-title">
        <div className="list-group-headline">
          <h2 id="members-title" className="list-group-title">Mitglieder</h2>
          <Segmented name="member-filter" legend="Mitglieder filtern" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'Alle' }, { value: 'overdue', label: 'Überfällig' }]} />
        </div>
        <ul className="list-group-body">
          {shown.length === 0 && <li><ListRow title="Niemand überfällig." /></li>}
          {shown.map((r) => (
            <li key={r.contractId}>
              <ListRow href={`/nexus/mitglieder/${r.contractId}`} testId={`member-row-${r.contractId}`}
                leading={r.notConnected ? undefined : <TrafficDot traffic={r.traffic} />} title={r.name}
                subtitle={r.billing === 'legacy' ? (r.notConnected ? 'Überweisung · Bank nicht verbunden' : 'Überweisung') : (r.notConnected ? 'Stripe · nicht verbunden' : 'Stripe')}
                value={!r.notConnected && r.arrearsCents > 0 ? <span className="amount arrears-value">{formatEuro(r.arrearsCents)}</span> : undefined} />
            </li>
          ))}
        </ul>
      </section>

      <ListGroup title="Calls">
        {calls.map((c) => (
          <ListRow key={c.id} href={`/nexus/calls/${c.id}`} title={c.topic}
            subtitle={`${formatBerlin(new Date(c.startsAt), 'dd.MM.yyyy, HH:mm')} Uhr`} value={`Folien ${c.slides.length}/${c.slideCount}`} />
        ))}
      </ListGroup>

      <ListGroup title="Content">
        <ListRow key="content" href="/nexus/content" title="Content-Board" value={`${contentOpen} in Arbeit`} />
      </ListGroup>
    </>
  );
}
