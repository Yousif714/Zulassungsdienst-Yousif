'use client';

import { useParams } from 'next/navigation';
import { Fragment, useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { DemoBadge } from '@/components/DemoBadge';
import { Figure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { CATCH_UP_OPTIONS } from '@/components/ProposalCard';
import { Segmented } from '@/components/Segmented';
import { TakeoverCard } from '@/components/TakeoverCard';
import { useAppStore } from '@/data/store';
import { formatIsoDe, now, todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors';
import { planTakeover } from '@/domain/ledger/takeover';
import { currentTakeover, openTakeoverAction, standUnknown, takeoverBlockReason } from '@/domain/takeover/status';
import { formatEuro } from '@/domain/money';
import type { MemberContract } from '@/domain/types';

type Mode = MemberContract['catchUpMode'];

const MODE_OPTIONS = CATCH_UP_OPTIONS;

export default function TakeoverPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch, mode: appMode } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const contract = state.contracts.find((c) => c.id === id);
  const openDraft = openTakeoverAction(state, id);
  const [mode, setMode] = useState<Mode>((openDraft?.payload.mode as Mode | undefined) ?? contract?.catchUpMode ?? 'first_rate');
  const back = <BackLink href={`/nexus/mitglieder/${id}`} label="Mitglied" />;

  if (!contract) {
    return (
      <>
        <PageHeader title="Übernahme" trailing={back} />
        <div className="empty-state">Dieses Mitglied gibt es nicht.</div>
      </>
    );
  }

  const { contact, states } = memberView(state, id, today);
  const name = contact?.name ?? 'Unbekannt';
  const plan = planTakeover(states, today, mode);
  const draft = openTakeoverAction(state, id);
  const history = state.allocations
    .filter((a) => a.contractId === id)
    .flatMap((a) => {
      const p = state.payments.find((x) => x.id === a.paymentId);
      return p ? [{ a, p }] : [];
    })
    .sort((x, y) => x.p.bookedOn.localeCompare(y.p.bookedOn));

  const missing = standUnknown(state, contract);

  // Ein offener Entwurf folgt dem gewählten Modus (neue Version, Raten rechnet der Reducer).
  const changeMode = (m: Mode) => {
    setMode(m);
    if (draft?.status === 'draft') dispatch({ type: 'prepareTakeover', contractId: id, mode: m });
  };

  return (
    <>
      <PageHeader title="Übernahme" subtitle={`${name} · von Überweisung zu Stripe`} badge={appMode === 'demo' ? <DemoBadge /> : undefined} trailing={back} />

      {contract.billing === 'stripe' && <p className="note-card">{name} zahlt bereits über Stripe.</p>}

      <ListGroup title="Bisherige Zahlungen" testId="previous-payments">
        {history.length === 0
          ? <ListRow key="empty" title="Noch keine Zahlungen." />
          : history.map(({ a, p }) => (
            <ListRow key={p.id} title={formatIsoDe(p.bookedOn)} subtitle={p.reference}
              value={<span className="amount">{formatEuro(a.amountCents)}</span>}
              accessory={a.method === 'auto'
                ? <button type="button" className="btn btn-secondary btn-small" aria-label={`Zahlung vom ${formatIsoDe(p.bookedOn)} über ${formatEuro(a.amountCents)} bestätigen`}
                  onClick={() => dispatch({ type: 'confirmPaymentMatch', paymentId: p.id, contractId: id })}>Bestätigen</button>
                : <span className="chip">bestätigt</span>} />
          ))}
      </ListGroup>

      {missing ? (
        <>
          <p className="note-card" data-testid="bank-missing">Bank nicht verbunden: Der Rückstand wird nach der Bankanbindung berechnet.</p>
          <ListGroup title="Vertrag" testId="contract-terms">
            <ListRow key="total" title="Gesamt" value={<span className="amount">{formatEuro(contract.totalCents)}</span>} />
            <ListRow key="rates" title="Raten" value={<>{contract.installments} × <span className="amount">{formatEuro(contract.installmentCents)}</span></>} />
            <ListRow key="start" title="Start" subtitle={`Fällig am ${contract.dueDay}.`} value={formatIsoDe(contract.startDate)} />
          </ListGroup>
        </>
      ) : (
        <>
      <Figures title="Stand">
        <Figure label="Rückstand" cents={plan.arrearsCents} testId="arrears" strong arrears />
        <Figure label="Künftige Raten" cents={plan.futureCents} testId="future" />
        <Figure label="Offen gesamt" cents={plan.openCents} testId="open-total" strong />
      </Figures>

      <section className="list-group" aria-labelledby="mode-title">
        <h2 id="mode-title" className="list-group-title">Rückstand</h2>
        <Segmented name="catch-up" legend="Wie wird der Rückstand nachgezahlt?" value={mode} onChange={changeMode} options={MODE_OPTIONS} />
      </section>

      <ListGroup title="Neue Raten" testId="rate-preview">
        {plan.rates.length === 0
          ? <ListRow key="empty" title="Nichts mehr offen." />
          : plan.rates.map((r) => (
            <ListRow key={r.no} title={`Rate ${r.no}`} subtitle={formatIsoDe(r.dueDate)} value={<span className="amount">{formatEuro(r.amountCents)}</span>} />
          ))}
      </ListGroup>
      <p className="rate-amounts">
        <span className="rate-amounts-label">Ratenbeträge: </span>
        <span data-testid="rate-amounts">
          {plan.rates.map((r, i) => (
            <Fragment key={r.no}>{i > 0 && ' · '}<span className="amount">{formatEuro(r.amountCents)}</span></Fragment>
          ))}
        </span>
      </p>

      {(contract.billing === 'legacy' || currentTakeover(state, id)) && (
        <TakeoverCard contractId={id} name={name} mode={mode} blockReason={takeoverBlockReason(state, id, today)} />
      )}
        </>
      )}
    </>
  );
}
