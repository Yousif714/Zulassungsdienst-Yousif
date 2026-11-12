'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { demoAI, demoPaymentLink } from '@/ai/demo-ai';
import { ActionSheet } from '@/components/ActionSheet';
import { BackLink } from '@/components/BackLink';
import { Figure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { TRAFFIC_LABEL, TrafficDot } from '@/components/TrafficDot';
import { useAppStore } from '@/data/store';
import { formatIsoDe, now, todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors';
import { formatEuro } from '@/domain/money';
import type { Action, InstallmentState, IsoDate } from '@/domain/types';

type Tone = 'freundlich' | 'bestimmt';

const SOURCE_LABEL = { bank: 'Überweisung', stripe: 'Stripe', manual: 'Manuell' } as const;
const METHOD_LABEL = { auto: 'automatisch zugeordnet', confirmed: 'bestätigt', manual: 'manuell zugeordnet' } as const;

function rateState(r: InstallmentState, today: IsoDate): { label: string; tone: 'paid' | 'partial' | 'overdue' | 'open' } {
  if (r.paidCents >= r.amountCents) return { label: r.paidOn ? `bezahlt am ${formatIsoDe(r.paidOn)}` : 'bezahlt', tone: 'paid' };
  if (r.paidCents > 0) return { label: `teilweise bezahlt (${formatEuro(r.paidCents)})`, tone: r.dueDate <= today ? 'overdue' : 'partial' };
  return r.dueDate <= today ? { label: 'überfällig', tone: 'overdue' } : { label: 'offen', tone: 'open' };
}

export default function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const exists = state.contracts.some((c) => c.id === id);

  const [open, setOpen] = useState(false);
  const [tone, setTone] = useState<Tone>('freundlich');
  const [draft, setDraft] = useState<{ forId: string; tone: Tone; text: string } | null>(null);

  const view = exists ? memberView(state, id, today) : null;
  // Eine Erinnerung je Rückstandsstand: kommt eine neue überfällige Rate dazu, gibt es eine neue Aktion.
  const actionId = `reminder-${id}-${view?.status.oldestUnpaidDue ?? 'none'}`;
  const stored = state.actions.find((a) => a.id === actionId);

  useEffect(() => {
    if (!open || !view?.contact || stored || (draft?.forId === actionId && draft.tone === tone)) return;
    let cancelled = false;
    void demoAI.draftReminder(view.contact, view.status, tone, demoPaymentLink(id)).then((text) => {
      if (!cancelled) setDraft({ forId: actionId, tone, text });
    });
    return () => {
      cancelled = true;
    };
    // Nur neu entwerfen, wenn das Blatt geöffnet oder der Ton gewechselt wird.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tone, stored, actionId]);

  if (!view) {
    return (
      <>
        <PageHeader title="Mitglied" trailing={<BackLink href="/nexus" label="NEXUS" />} />
        <div className="empty-state">Dieses Mitglied gibt es nicht.</div>
      </>
    );
  }

  const { contract, contact, states, status } = view;
  const name = contact?.name ?? 'Unbekannt';
  const history = state.allocations
    .filter((a) => a.contractId === id)
    .flatMap((a) => {
      const p = state.payments.find((x) => x.id === a.paymentId);
      return p ? [{ a, p }] : [];
    })
    .sort((x, y) => y.p.bookedOn.localeCompare(x.p.bookedOn));

  let action: Action | null = stored ?? null;
  if (!action && contact && draft?.forId === actionId && draft.tone === tone) {
    action = {
      id: actionId,
      type: 'send_reminder',
      company: 'nexus',
      title: `Erinnerung an ${name}`,
      payload: { threadId: `t-${contact.id}`, channel: 'whatsapp', contactId: contact.id, text: draft.text },
      version: 1,
      status: 'draft',
      createdAt: at.toISOString(),
      isDemo: true,
      insightKey: `overdue:${id}`,
    };
  }

  // Wie beim Antwortentwurf: erst beim ersten Ändern oder Senden speichern.
  const ensureStored = (a: Action) => {
    if (!stored) dispatch({ type: 'createAction', action: a });
  };
  const send = (a: Action) => {
    ensureStored(a);
    dispatch({ type: 'approveAction', id: a.id, version: a.version, via: 'app' });
    dispatch({ type: 'actionExecuted', id: a.id, result: 'ok' });
  };
  const edit = (a: Action, text: string) => {
    ensureStored(a);
    dispatch({ type: 'editAction', id: a.id, payload: { ...a.payload, text } });
  };

  const showSheet = open || !!stored;

  return (
    <>
      <PageHeader title={name} subtitle={<span className="member-subtitle"><TrafficDot traffic={status.traffic} />{TRAFFIC_LABEL(status.traffic)} · {contract.billing === 'legacy' ? 'Überweisung' : 'Stripe'}</span>}
        trailing={<BackLink href="/nexus" label="NEXUS" />} />

      <Figures title="Kennzahlen">
        <Figure label="Fällig bis heute" cents={status.dueCents} testId="due" />
        <Figure label="Gezahlt" cents={status.paidCents} testId="paid" />
        <Figure label="Rückstand" cents={status.arrearsCents} testId="arrears" strong />
        <Figure label="Künftige Raten" cents={status.futureCents} testId="future" />
        <Figure label="Offen gesamt" cents={status.openCents} testId="open-total" strong />
      </Figures>

      <section className="list-group" aria-labelledby="steps-title">
        <h2 id="steps-title" className="list-group-title">Rechenweg</h2>
        <ol className="steps" data-testid="steps">
          {status.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </section>

      {(status.arrearsCents > 0 || stored || contract.billing === 'legacy') && (
        <div className="member-actions">
          {status.arrearsCents > 0 && !showSheet && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Erinnerung vorbereiten</button>
          )}
          {contract.billing === 'legacy' && (
            <Link href={`/nexus/mitglieder/${id}/uebernahme`} className="btn btn-secondary">Übernehmen</Link>
          )}
        </div>
      )}

      {showSheet && (
        <div className="reminder">
          {!stored && (
            <Segmented name="reminder-tone" legend="Ton der Erinnerung" value={tone} onChange={setTone}
              options={[{ value: 'freundlich', label: 'Freundlich' }, { value: 'bestimmt', label: 'Bestimmt' }]} />
          )}
          {action ? (
            <ActionSheet action={action} onSend={() => send(action)} onEdit={(text) => edit(action, text)} onLater={() => setOpen(false)} />
          ) : (
            <div className="action-sheet action-sheet-loading" role="status">Entwurf wird vorbereitet …</div>
          )}
        </div>
      )}

      <ListGroup title="Raten" testId="installments">
        {states.map((r) => {
          const st = rateState(r, today);
          return (
            <ListRow key={r.no} testId="installment" title={`Rate ${r.no} · ${formatIsoDe(r.dueDate)}`}
              subtitle={<span className="rate-state" data-state={st.tone}>{st.label}</span>}
              value={<span className="amount">{formatEuro(r.amountCents)}</span>} />
          );
        })}
      </ListGroup>

      <ListGroup title="Zahlungsverlauf" testId="payments">
        {history.length === 0
          ? <ListRow key="empty" title="Noch keine Zahlungen." />
          : history.map(({ a, p }) => (
            <ListRow key={p.id} title={`${formatIsoDe(p.bookedOn)} · ${SOURCE_LABEL[p.source]}`}
              subtitle={`${METHOD_LABEL[a.method]}${p.reference ? ` · ${p.reference}` : ''}`}
              value={<span className="amount">{formatEuro(a.amountCents)}</span>} />
          ))}
      </ListGroup>

      {contract.specialTerms && (
        <section className="list-group" aria-labelledby="terms-title">
          <h2 id="terms-title" className="list-group-title">Sondervereinbarung</h2>
          <p className="note-card">{contract.specialTerms}</p>
        </section>
      )}
    </>
  );
}
