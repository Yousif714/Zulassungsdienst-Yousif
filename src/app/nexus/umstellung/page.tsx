'use client';

import { useState } from 'react';

import { ActionSheet } from '@/components/ActionSheet';
import { BackLink } from '@/components/BackLink';
import { DemoBadge } from '@/components/DemoBadge';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { absolutizeDemoLinks, useOrigin } from '@/components/TakeoverCard';
import { openTakeoverDrafts, openUpcomingReminders, switchableTakeovers, takeoverRows } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { now, todayBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import { TAKEOVER_STATUS_LABEL } from '@/domain/takeover/status';

type Row = ReturnType<typeof takeoverRows>[number];

/** Status als Chip und, solange noch nichts läuft, der Sperrgrund; so bleibt der Name in der Zeile voll lesbar. */
function rowSubtitle(r: Row) {
  const reason = r.status === null || r.status === 'prepared' ? r.blockReason : null;
  if (!r.status && !reason) return undefined;
  return <>{r.status && <span className="chip">{TAKEOVER_STATUS_LABEL[r.status]}</span>}{r.status && reason && ' '}{reason}</>;
}

export default function UmstellungPage() {
  const { state, dispatch, mode } = useAppStore();
  const today = todayBerlin(now());
  const rows = takeoverRows(state, today);
  const drafts = openTakeoverDrafts(state);
  const reminders = openUpcomingReminders(state);
  const [later, setLater] = useState<string[]>([]);
  const switchable = switchableTakeovers(state, now());
  const origin = useOrigin();
  const approveAll = (list: { id: string; version: number }[]) => dispatch({ type: 'approveActions', items: list.map(({ id, version }) => ({ id, version })) });

  return (
    <>
      <PageHeader title="Umstellung" subtitle="von Überweisung zu Stripe" badge={mode === 'demo' ? <DemoBadge /> : undefined}
        trailing={<BackLink href="/nexus" label="NEXUS" />} />

      <div className="member-actions">
        <button type="button" className="btn btn-primary" disabled={switchable === 0} onClick={() => dispatch({ type: 'prepareAllTakeovers' })}>
          {`Alle umstellen (${switchable})`}
        </button>
        <button type="button" className="btn btn-secondary" disabled={drafts.length === 0} onClick={() => approveAll(drafts)}>
          {`Alle freigeben (${drafts.length})`}
        </button>
      </div>

      <ListGroup title="Mitglieder" testId="takeover-rows">
        {rows.length === 0 && <ListRow key="empty" title="Niemand auf Überweisung." />}
        {rows.map((r) => (
          <ListRow key={r.contractId} testId={`takeover-row-${r.contractId}`} href={`/nexus/mitglieder/${r.contractId}/uebernahme`} title={r.name}
            subtitle={rowSubtitle(r)}
            value={<span className="amount">{formatEuro(r.openCents)}</span>} />
        ))}
      </ListGroup>

      <section id="erinnerungen" className="list-group" aria-labelledby="erinnerungen-title">
        <h2 id="erinnerungen-title" className="list-group-title">Erinnerungen vor Fälligkeit</h2>
        {reminders.length === 0 ? (
          <p className="note-card">Keine Erinnerungen offen.</p>
        ) : (
          <>
            <div className="member-actions">
              <button type="button" className="btn btn-secondary" onClick={() => approveAll(reminders)}>{`Alle freigeben (${reminders.length})`}</button>
            </div>
            {reminders.filter((a) => !later.includes(a.id)).map((a) => (
              <ActionSheet key={a.id} action={{ ...a, payload: { ...a.payload, text: absolutizeDemoLinks(String(a.payload.text ?? ''), origin) } }}
                onSend={() => dispatch({ type: 'approveAction', id: a.id, version: a.version, via: 'app' })}
                onEdit={(text) => dispatch({ type: 'editAction', id: a.id, payload: { ...a.payload, text } })}
                onLater={() => setLater((l) => [...l, a.id])}
                onRetry={() => dispatch({ type: 'retryAction', id: a.id })} onCheck={() => dispatch({ type: 'checkAction', id: a.id })} />
            ))}
          </>
        )}
      </section>
    </>
  );
}
