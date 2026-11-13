'use client';

import { useId, useState } from 'react';

import { matchOptions } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { formatIsoDe } from '@/domain/clock';
import { customerOpenInvoices, splitPaymentOverInvoices } from '@/domain/ledger/receivables';
import type { MatchResult } from '@/domain/matching/payments';
import { formatEuro } from '@/domain/money';
import type { AppState, Company, Payment } from '@/domain/types';

const CONFIDENCE_LABEL: Record<MatchResult['confidence'], string> = { high: 'hoch', medium: 'mittel', low: 'niedrig' };
const DISMISS_LABEL: Record<Company, string> = { nexus: 'Keine Mitgliedszahlung', zulassung: 'Keine Kundenzahlung' };
const PICK_LABEL: Record<Company, string> = { nexus: 'Mitglied oder Rechnung wählen …', zulassung: 'Rechnung oder Kunde wählen …' };

const nameOf = (s: AppState, contactId: string | null | undefined) => s.contacts.find((c) => c.id === contactId)?.name ?? 'Unbekannt';

/** Wert einer Auswahl-Option: 'invoice:<id>', 'contract:<id>' oder 'invoices:<id>,<id>'. */
const splitValue = (value: string): [string, string] => [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];

/** Zulassung: je Kunde mit mindestens zwei offenen Rechnungen eine Sammel-Option „alle offenen Rechnungen“. */
function allOpenInvoiceOptions(s: AppState): { value: string; label: string }[] {
  return s.contacts
    .filter((c) => c.company === 'zulassung')
    .map((c) => ({ c, open: customerOpenInvoices(s, c.id) }))
    .filter(({ open }) => open.invoiceIds.length >= 2)
    .map(({ c, open }) => ({
      value: `invoices:${open.invoiceIds.join(',')}`,
      label: `Kunde ${c.name} · alle offenen Rechnungen (${open.invoiceIds.length}) · ${formatEuro(open.openCents)}`,
    }));
}

/** Aufteilung einer Sammelzahlung als Text: 'Aufteilen: RE-… 390,00 € · RE-… 250,00 €' und ggf. Rest-Hinweis. */
function SplitPreview({ payment, invoiceIds }: { payment: Payment; invoiceIds: string[] }) {
  const { state } = useAppStore();
  const split = splitPaymentOverInvoices(state, payment.amountCents, invoiceIds);
  const number = (id: string) => state.invoices.find((i) => i.id === id)?.number ?? id;
  return (
    <>
      <p className="card-text" data-testid={`split-${payment.id}`}>
        Aufteilen: {split.shares.map((x) => `${number(x.invoiceId)} ${formatEuro(x.amountCents)}`).join(' · ')}
      </p>
      {split.restCents > 0 && <p className="card-note">Rest {formatEuro(split.restCents)} bleibt nicht zugeordnet</p>}
    </>
  );
}

/** Karte einer offenen Bankzahlung: Vorschlag bestätigen, anderes Ziel wählen oder ausblenden. */
export function PaymentCard({ payment, match, company }: { payment: Payment; match: MatchResult; company: Company }) {
  const { state, dispatch } = useAppStore();
  const selectId = useId();
  const [chosen, setChosen] = useState('');
  const [showAll, setShowAll] = useState(false);
  const payer = payment.payerName ?? 'Unbekannt';
  const options = company === 'zulassung'
    ? [...matchOptions(state, company), ...allOpenInvoiceOptions(state)].sort((a, b) => a.label.localeCompare(b.label, 'de'))
    : matchOptions(state, company);
  const candidateValues = match.candidates.map((t) => `${t.kind}:${t.id}`);
  const list = showAll || match.target || match.candidates.length === 0 ? options : options.filter((o) => candidateValues.includes(o.value));
  const confirm = (value: string) => {
    const [kind, id] = splitValue(value);
    dispatch(kind === 'invoices'
      ? { type: 'confirmPaymentMatch', paymentId: payment.id, invoiceIds: id.split(',') }
      : kind === 'invoice'
        ? { type: 'confirmPaymentMatch', paymentId: payment.id, invoiceId: id }
        : { type: 'confirmPaymentMatch', paymentId: payment.id, contractId: id });
  };
  const target = match.target;
  const invoice = target?.kind === 'invoice' ? state.invoices.find((i) => i.id === target.id) : undefined;
  const contract = target?.kind === 'contract' ? state.contracts.find((c) => c.id === target.id) : undefined;
  const invoiceIds = target?.kind === 'invoices' && target.invoiceIds.every((id) => state.invoices.some((i) => i.id === id)) ? target.invoiceIds : undefined;
  const hasProposal = !!target && !!(invoice || contract || invoiceIds);
  const targetName = target ? nameOf(state, target.contactId) : '';
  const targetLabel = invoice ? `Rechnung ${invoice.number}` : targetName;
  const chosenInvoiceIds = chosen.startsWith('invoices:') ? splitValue(chosen)[1].split(',') : undefined;

  return (
    <article className="card" data-testid={`match-${payment.id}`}>
      <div className="card-head">
        <div>
          <div className="card-title">{payer}</div>
          <div className="card-sub">{formatIsoDe(payment.bookedOn)}{payment.reference ? ` · ${payment.reference}` : ''}</div>
        </div>
        <span className="amount card-amount">{formatEuro(payment.amountCents)}</span>
      </div>
      {target && hasProposal ? (
        <>
          <p className="card-text">
            Vorschlag: <strong>{invoice ? `Rechnung ${invoice.number} · ${targetName}` : invoiceIds ? `${targetName} · ${invoiceIds.length} Rechnungen` : targetName}</strong>{' '}
            <span className="chip" data-confidence={match.confidence}>Konfidenz {CONFIDENCE_LABEL[match.confidence]}</span>
          </p>
          {invoiceIds && <SplitPreview payment={payment} invoiceIds={invoiceIds} />}
          <p className="card-note">{match.reason}</p>
          <div className="card-buttons">
            {invoiceIds ? (
              <button type="button" className="btn btn-primary" aria-label={`Ja, so aufteilen (Zahlung von ${payer})`}
                onClick={() => dispatch({ type: 'confirmPaymentMatch', paymentId: payment.id, invoiceIds })}>Ja, so aufteilen</button>
            ) : (
              <button type="button" className="btn btn-primary" aria-label={`Ja, gehört zu ${targetLabel} (Zahlung von ${payer})`}
                onClick={() => confirm(`${target.kind}:${target.id}`)}>Ja, gehört zu {targetLabel}</button>
            )}
          </div>
        </>
      ) : (
        <p className="card-note">{match.reason}</p>
      )}
      {(!hasProposal || showAll) && (
        <>
          <div className="card-buttons">
            <label htmlFor={selectId} className="visually-hidden">Ziel für Zahlung von {payer} wählen</label>
            <select id={selectId} className="select" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">{match.candidates.length > 0 && !showAll ? 'Zuordnung wählen …' : PICK_LABEL[company]}</option>
              {list.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button type="button" className="btn btn-primary" disabled={!chosen} aria-label={`Zuordnen (Zahlung von ${payer})`}
              onClick={() => confirm(chosen)}>Zuordnen</button>
          </div>
          {chosenInvoiceIds && <SplitPreview payment={payment} invoiceIds={chosenInvoiceIds} />}
        </>
      )}
      {!showAll && (target || match.candidates.length > 0) && (
        <div className="card-buttons">
          <button type="button" className="btn btn-secondary" aria-expanded={false} aria-label={`Andere Zuordnung … (Zahlung von ${payer})`}
            onClick={() => setShowAll(true)}>Andere Zuordnung …</button>
        </div>
      )}
      <div className="card-buttons">
        <button type="button" className="btn btn-secondary" aria-label={`${DISMISS_LABEL[company]} (Zahlung von ${payer})`}
          onClick={() => dispatch({ type: 'dismissPayment', paymentId: payment.id })}>{DISMISS_LABEL[company]}</button>
      </div>
    </article>
  );
}
