'use client';

import { useId, useState, type FormEvent } from 'react';

import { BackLink } from '@/components/BackLink';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { PaymentCard } from '@/components/PaymentCard';
import { stripeLexCases, unallocatedBankPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { formatIsoDe, now } from '@/domain/clock';
import { buildMatchContext } from '@/domain/detectors/payments';
import { matchBankPayment } from '@/domain/matching/payments';
import { formatEuro, parseEuroInput } from '@/domain/money';
import type { AppState } from '@/domain/types';

const nameOf = (s: AppState, contactId: string | null | undefined) => s.contacts.find((c) => c.id === contactId)?.name ?? 'Unbekannt';

function SimulateTransfer() {
  const { state, dispatch } = useAppStore();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [iban, setIban] = useState('');
  const [payerName, setPayerName] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [simId, setSimId] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuroInput(amount);
    if (!iban.trim() || !payerName.trim() || amountCents === null) {
      setError('Bitte IBAN, Name und einen gültigen Betrag eingeben.');
      return;
    }
    setError('');
    const { created } = await dispatch({ type: 'simulateTransfer', iban: iban.replace(/\s/g, '').toUpperCase(), payerName: payerName.trim(), amountCents });
    setSimId(created[0] ?? null);
  };

  const alloc = simId ? state.allocations.find((a) => a.paymentId === simId) : undefined;
  const contract = alloc && state.contracts.find((c) => c.id === alloc.contractId);
  const result = !simId || !state.payments.some((p) => p.id === simId)
    ? ''
    : alloc?.method === 'auto' && contract ? `Automatisch zugeordnet: ${nameOf(state, contract.contactId)}` : 'Zur Prüfung in Zuordnen';

  return (
    <section className="list-group" aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className="list-group-title">Demo-Werkzeug</h2>
      <div className="card">
        <button type="button" className="btn btn-secondary btn-block" aria-expanded={open} aria-controls={formId} onClick={() => setOpen((v) => !v)}>
          Überweisung simulieren
        </button>
        <form id={formId} className="sim-form" hidden={!open} onSubmit={submit}>
          <label className="field"><span>IBAN</span>
            <input value={iban} onChange={(e) => setIban(e.target.value)} autoComplete="off" inputMode="text" placeholder="DE…" />
          </label>
          <label className="field"><span>Name</span>
            <input value={payerName} onChange={(e) => setPayerName(e.target.value)} autoComplete="off" />
          </label>
          <label className="field"><span>Betrag</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="300,00" />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block"><span>Buchen</span><DemoBadge /></button>
        </form>
        <p role="status" className="confirm-line">{result}</p>
      </div>
    </section>
  );
}

export default function MatchPage() {
  const { state, dispatch, mode } = useAppStore();
  const at = now();
  const mctx = buildMatchContext(state, at);
  const payments = unallocatedBankPayments(state).sort((a, b) => b.bookedOn.localeCompare(a.bookedOn));
  const cases = stripeLexCases(state);

  return (
    <>
      <PageHeader title="Zuordnen" subtitle="Zahlungen den Mitgliedern zuordnen" trailing={<BackLink href="/nexus" label="NEXUS" />} />

      <section className="list-group" aria-labelledby="open-payments-title">
        <h2 id="open-payments-title" className="list-group-title">Offene Zahlungen</h2>
        {payments.length === 0
          ? <p className="empty-card">Alle Zahlungen sind zugeordnet.</p>
          : (
            <div className="cards">
              {payments.map((p) => (
                <PaymentCard key={p.id} payment={p} match={matchBankPayment(p, mctx)} company="nexus" />
              ))}
            </div>
          )}
      </section>

      <section className="list-group" aria-labelledby="stripe-lex-title">
        <h2 id="stripe-lex-title" className="list-group-title">Stripe bezahlt, Lexware offen</h2>
        {cases.length === 0
          ? <p className="empty-card">Keine offenen Fälle.</p>
          : (
            <div className="cards">
              {cases.map(({ key, invoice, payment }) => (
                <article key={key} className="card" data-testid={`stripe-case-${invoice.id}`}>
                  <div className="card-head">
                    <div>
                      <div className="card-title">Rechnung {invoice.number}</div>
                      <div className="card-sub">{nameOf(state, invoice.contactId)} · in Lexware offen</div>
                    </div>
                    <span className="amount card-amount">{formatEuro(invoice.openCents)}</span>
                  </div>
                  <p className="card-note">
                    Stripe-Zahlung über <span className="amount">{formatEuro(payment.amountCents)}</span> am {formatIsoDe(payment.bookedOn)}.
                  </p>
                  <div className="card-buttons">
                    <button type="button" className="btn btn-primary" aria-label={`Rechnung ${invoice.number} als durch Stripe bezahlt markieren`}
                      onClick={() => dispatch({ type: 'settleInvoice', invoiceId: invoice.id, paymentId: payment.id })}>
                      Als durch Stripe bezahlt markieren
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
      </section>

      {mode === 'demo' && <SimulateTransfer />}
    </>
  );
}
