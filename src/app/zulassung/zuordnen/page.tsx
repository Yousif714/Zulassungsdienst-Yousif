'use client';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { PaymentCard } from '@/components/PaymentCard';
import { StatementUpload } from '@/components/StatementUpload';
import { partlyAllocatedPayments, unallocatedBankPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { formatIsoDe, now } from '@/domain/clock';
import { buildMatchContext } from '@/domain/detectors/payments';
import { matchBankPayment } from '@/domain/matching/payments';
import { formatEuro } from '@/domain/money';

/** Zulassungsdienst: Sparkassen-Auszug hochladen und Bankzahlungen den Kundenrechnungen zuordnen. */
export default function ZulassungMatchPage() {
  const { state } = useAppStore();
  const at = now();
  const mctx = buildMatchContext(state, at, 'zulassung');
  const payments = unallocatedBankPayments(state, 'zulassung').sort((a, b) => b.bookedOn.localeCompare(a.bookedOn));
  const rests = partlyAllocatedPayments(state, 'zulassung');

  return (
    <>
      <PageHeader title="Zahlungen zuordnen" subtitle="Bankzahlungen den Kundenrechnungen zuordnen" trailing={<BackLink href="/zulassung" label="Zulassung" />} />

      <StatementUpload />

      <section className="list-group" aria-labelledby="zulassung-open-payments-title">
        <h2 id="zulassung-open-payments-title" className="list-group-title">Offene Zahlungen</h2>
        {payments.length === 0
          ? <p className="empty-card">Keine offenen Zahlungen.</p>
          : (
            <div className="cards">
              {payments.map((p) => <PaymentCard key={p.id} payment={p} match={matchBankPayment(p, mctx)} company="zulassung" />)}
            </div>
          )}
      </section>

      {rests.length > 0 && (
        <ListGroup title="Nicht zugeordnete Reste" testId="payment-rests">
          {rests.map(({ payment, restCents }) => (
            <ListRow key={payment.id} testId={`rest-${payment.id}`} title={payment.payerName ?? 'Unbekannt'}
              subtitle={`${formatIsoDe(payment.bookedOn)}${payment.reference ? ` · ${payment.reference}` : ''}`}
              value={<span className="amount">Rest {formatEuro(restCents)}</span>} />
          ))}
        </ListGroup>
      )}
    </>
  );
}
