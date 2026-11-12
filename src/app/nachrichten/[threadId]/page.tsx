'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';

import { demoAI } from '@/ai/demo-ai';
import { ActionSheet } from '@/components/ActionSheet';
import { IconChevron } from '@/components/Icons';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { Bubble, RichText, TimeStamp, placeMessages } from '@/components/Messages';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { replyAction, replyActionId } from '@/domain/action-factory';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import type { Action, AppState, Contact, Message } from '@/domain/types';

const CHANNEL_LABEL: Record<Message['channel'], string> = { whatsapp: 'WhatsApp', email: 'E-Mail' };

function contactHref(s: AppState, c: Contact): string | null {
  if (c.company === 'zulassung') return `/zulassung/kunden/${c.id}`;
  const contract = s.contracts.find((x) => x.contactId === c.id);
  return contract ? `/nexus/mitglieder/${contract.id}` : null;
}

function BackLink() {
  return (
    <Link href="/" className="nav-button back-button">
      <IconChevron className="back-chevron" size={20} />
      <span>Heute</span>
    </Link>
  );
}

export default function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const { state, dispatch } = useAppStore();
  const at = now();
  const today = todayBerlin(at);

  const messages = state.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = messages.at(-1);
  const lastIn = messages.filter((m) => m.direction === 'in').at(-1);
  const contactId = messages.find((m) => m.contactId)?.contactId ?? null;
  const contact = state.contacts.find((c) => c.id === contactId) ?? null;
  const jobId = [...messages].reverse().find((m) => m.jobId)?.jobId ?? null;
  const job = state.jobs.find((j) => j.id === jobId);
  const vehicle = job && state.vehicles.find((v) => v.id === job.vehicleId);

  const actionId = lastIn ? replyActionId(lastIn.id) : null;
  const stored = state.actions.find((a) => a.id === actionId);
  const needsDraft = !!lastIn && last?.direction === 'in' && !stored;

  const [draft, setDraft] = useState<{ forId: string; text: string } | null>(null);
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (!needsDraft || !lastIn || draft?.forId === lastIn.id) return;
    let cancelled = false;
    void demoAI.draftReply(messages, contact).then((text) => {
      if (!cancelled) setDraft({ forId: lastIn.id, text });
    });
    return () => {
      cancelled = true;
    };
    // Nur neu entwerfen, wenn sich die eingehende Nachricht ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDraft, lastIn?.id]);

  if (!last) {
    return (
      <>
        <PageHeader title="Nachricht" trailing={<BackLink />} />
        <div className="empty-state">Diese Unterhaltung gibt es nicht.</div>
      </>
    );
  }

  const name = contact?.name ?? lastIn?.from ?? last.to;
  const channel = (lastIn ?? last).channel;

  let action: Action | null = stored ?? null;
  if (!action && lastIn && actionId && draft?.forId === lastIn.id) {
    action = replyAction({ lastIn, contact, threadId, text: draft.text, at, isDemo: true });
  }

  // Die Aktion wird erst beim ersten Ändern oder Senden gespeichert.
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

  const time = (m: Message) => {
    const d = new Date(m.sentAt);
    return todayBerlin(d) === today ? `Heute ${formatBerlin(d, 'HH:mm')}` : formatBerlin(d, 'dd.MM. HH:mm');
  };
  const contactLink = contact && contactHref(state, contact);

  return (
    <>
      <PageHeader title={name} subtitle={CHANNEL_LABEL[channel]} trailing={<BackLink />} />

      <ol className="imsg-list" data-testid="thread-messages">
        {placeMessages(messages, (m) => m.direction, (m) => m.sentAt).map((p) => (
          <Fragment key={p.item.id}>
            {p.stamp && <TimeStamp dateTime={p.item.sentAt}>{time(p.item)}</TimeStamp>}
            <li className="imsg-row" data-side={p.side} data-first={p.first}>
              <Bubble side={p.side} tail={p.tail}><RichText text={p.item.body} /></Bubble>
            </li>
          </Fragment>
        ))}
      </ol>

      {(job || contactLink) && (
        <ListGroup>
          {job && (
            <ListRow key="job" href={`/zulassung/auftraege/${job.id}`} title={`Auftrag: ${job.service}`} subtitle={vehicle ? `${vehicle.model} · ${vehicle.plate}` : undefined} />
          )}
          {contact && contactLink && <ListRow key="contact" href={contactLink} title={contact.name} subtitle="Kontakt ansehen" />}
        </ListGroup>
      )}

      {lastIn && (stored || last.direction === 'in') && (
        later ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setLater(false)}>Antwortentwurf anzeigen</button>
        ) : action ? (
          <ActionSheet action={action} onSend={() => send(action)} onEdit={(text) => edit(action, text)} onLater={() => setLater(true)} />
        ) : (
          <div className="action-sheet action-sheet-loading" role="status">Entwurf wird vorbereitet …</div>
        )
      )}
    </>
  );
}
