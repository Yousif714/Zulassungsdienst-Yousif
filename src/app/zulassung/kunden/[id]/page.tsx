'use client';

import { useParams } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { CONTACT_KIND_LABEL, INVOICE_STATUS_LABEL, JOB_STATUS_LABEL } from '@/components/zulassung-labels';
import { customerInvoiceRows, customerPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { formatBerlin, formatIsoDe } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import type { Message } from '@/domain/types';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useAppStore();
  const back = <BackLink href="/zulassung" label="Zulassungsdienst" />;
  const contact = state.contacts.find((c) => c.id === id && c.company === 'zulassung');

  if (!contact) {
    return (
      <>
        <PageHeader title="Kunde" trailing={back} />
        <div className="empty-state">Diesen Kunden gibt es nicht.</div>
      </>
    );
  }

  const vehicles = state.vehicles.filter((v) => v.contactId === id);
  const jobs = state.jobs.filter((j) => j.contactId === id);
  const invoices = customerInvoiceRows(state, id);
  const payments = customerPayments(state, id);
  // Je Unterhaltung die jüngste Nachricht, neueste Unterhaltung zuerst.
  const latestByThread = new Map<string, Message>();
  for (const m of state.messages.filter((x) => x.contactId === id)) {
    const prev = latestByThread.get(m.threadId);
    if (!prev || m.sentAt > prev.sentAt) latestByThread.set(m.threadId, m);
  }
  const threads = [...latestByThread.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return (
    <>
      <PageHeader title={contact.name} subtitle={[CONTACT_KIND_LABEL[contact.kind], ...contact.phones, ...contact.emails].join(' · ')} trailing={back} />

      <ListGroup title="Fahrzeuge" testId="vehicles">
        {vehicles.length === 0
          ? <ListRow key="none" title="Keine Fahrzeuge." />
          : vehicles.map((v) => <ListRow key={v.id} title={v.plate} subtitle={`${v.model} · FIN ${v.vin}`} />)}
      </ListGroup>

      <ListGroup title="Aufträge" testId="customer-jobs">
        {jobs.length === 0
          ? <ListRow key="none" title="Keine Aufträge." />
          : jobs.map((j) => {
            const v = state.vehicles.find((x) => x.id === j.vehicleId);
            return (
              <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`} title={j.service}
                subtitle={`${v ? `${v.plate} · ` : ''}${JOB_STATUS_LABEL[j.status]}`} value={<span className="amount">{formatEuro(j.priceCents)}</span>} />
            );
          })}
      </ListGroup>

      <ListGroup title="Offene Rechnungen" testId="customer-invoices">
        {invoices.length === 0
          ? <ListRow key="none" title="Keine offenen Rechnungen." />
          : invoices.map(({ invoice: i, openCents, paidCents }) => (
            <ListRow key={i.id} testId={`invoice-${i.id}`} title={i.number}
              subtitle={<><span className={i.status === 'overdue' ? 'arrears-value' : undefined}>{INVOICE_STATUS_LABEL[i.status]}</span> · fällig {formatIsoDe(i.dueDate)}{paidCents > 0 ? ` · ${formatEuro(paidCents)} von ${formatEuro(i.totalCents)} bezahlt` : ''}</>}
              value={<span className="amount">{formatEuro(openCents)}</span>} />
          ))}
      </ListGroup>

      <ListGroup title="Zahlungen" testId="customer-payments">
        {payments.length === 0
          ? <ListRow key="none" title="Keine Zahlungen." />
          : payments.map((p) => (
            <ListRow key={p.key} testId={`payment-row-${p.key}`} title={p.invoiceNumber}
              subtitle={`${formatIsoDe(p.bookedOn)}${p.paidInLexware ? ' · in Lexware schon bezahlt' : ''}${p.isReturn ? ' · Rückbuchung' : ''}`}
              value={<span className="amount">{formatEuro(p.amountCents)}</span>} />
          ))}
      </ListGroup>

      <ListGroup title="Letzte Nachrichten" testId="customer-messages">
        {threads.length === 0
          ? <ListRow key="none" title="Keine Nachrichten." />
          : threads.map((m) => (
            <ListRow key={m.threadId} href={`/nachrichten/${m.threadId}`} testId={`message-row-${m.threadId}`} title={m.body}
              subtitle={`${m.direction === 'in' ? contact.name : 'Du'} · ${formatBerlin(new Date(m.sentAt), 'dd.MM. HH:mm')}`} />
          ))}
      </ListGroup>
    </>
  );
}
