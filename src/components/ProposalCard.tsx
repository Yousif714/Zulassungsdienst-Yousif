'use client';

import { useState } from 'react';

import { formatIsoDe } from '@/domain/clock';
import { draftFromProposal, validateContractDraft, type ContractDraft } from '@/domain/import/contract-draft';
import { findContactFor, MONTH_END, type ContractProposal, type ProposalValues } from '@/domain/import/proposals';
import { formatEuro, parseEuroInput } from '@/domain/money';
import type { Contact } from '@/domain/types';

import { Segmented } from './Segmented';

type Mode = ContractDraft['catchUpMode'];

/** Gleiche Optionen wie die Übernahme-Seite. */
export const CATCH_UP_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'first_rate', label: 'Mit erster Rate nachzahlen' },
  { value: 'spread', label: 'Auf Restraten verteilen' },
];

/** '1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026'; fehlende Teile als '?'. */
export function proposalSummary(p: ProposalValues): string {
  const q = (v: number | null, f: (n: number) => string) => (v === null ? '?' : f(v));
  return [
    q(p.totalCents, formatEuro),
    `${q(p.installments, String)} × ${q(p.installmentCents, formatEuro)}`,
    p.dueDay === MONTH_END ? 'zum Monatsende' : `am ${q(p.dueDay, (n) => `${n}.`)}`,
    `ab ${p.startDate === null ? '?' : formatIsoDe(p.startDate)}`,
  ].join(' · ');
}

/** Grund, warum „Übernehmen“ gesperrt ist; `null` = frei. Bei reinem Namenstreffer muss „Ist das …?“ beantwortet sein. */
export function confirmBlocker(errors: string[], match: 'ref' | 'email' | 'name' | 'none', same: boolean | null, name: string | null): string | null {
  if (match === 'name' && same === null) return `Bitte zuerst beantworten: Ist das ${name}?`;
  return errors.length > 0 ? 'Bitte die Angaben ergänzen oder korrigieren.' : null;
}

const money = (c: number | undefined) => (c === undefined ? '' : formatEuro(c));
const num = (n: number | undefined) => (n === undefined ? '' : String(n));
const whole = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : 0);

export function ProposalCard({ proposal: p, contacts, onConfirm, onDismiss, dismissLabel = 'Verwerfen' }: {
  proposal: ContractProposal;
  contacts: Contact[];
  onConfirm: (draft: ContractDraft, contactId: string | null) => void;
  onDismiss: () => void;
  dismissLabel?: string;
}) {
  const base = draftFromProposal(p);
  const found = findContactFor(p, contacts);
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState(money(base.totalCents));
  const [count, setCount] = useState(num(base.installments));
  const [rate, setRate] = useState(money(base.installmentCents));
  const [day, setDay] = useState(num(base.dueDay));
  const [start, setStart] = useState(base.startDate ?? '');
  const [mode, setMode] = useState<Mode>('first_rate');
  const [same, setSame] = useState<boolean | null>(null);

  const draft: ContractDraft = {
    totalCents: parseEuroInput(total) ?? 0, installments: whole(count), installmentCents: parseEuroInput(rate) ?? 0,
    dueDay: whole(day), startDate: start, catchUpMode: mode,
  };
  const errors = validateContractDraft(draft);
  // Eine Quelle der Wahrheit: Anzeige und Senden kommen aus demselben Entwurf.
  const shown: ProposalValues = {
    totalCents: draft.totalCents || null, installments: draft.installments || null, installmentCents: draft.installmentCents || null,
    dueDay: draft.dueDay || null, startDate: start || null,
  };
  const blocker = confirmBlocker(errors, found.match, same, found.name);
  const id = p.id;

  return (
    <article className="list-group" data-testid={`proposal-${id}`}>
      <div className="note-card">
        <h3 className="list-row-title">{p.name} <span className="chip">{p.sourceLabel}</span></h3>
        <p className="list-row-title amount">{proposalSummary(shown)}</p>
        <p className="list-row-subtitle">Quelle: {p.references.join(', ')}</p>
        <p className="list-row-subtitle">
          <span className="chip" data-confidence={p.complete ? 'high' : 'low'}>{p.complete ? 'vollständig' : 'bitte ergänzen'}</span>
        </p>
        {p.possibleMatch && <p className="list-row-subtitle">gehört evtl. zu {p.possibleMatch.name}</p>}
        {found.match === 'name' && (
          <div role="group" aria-label={`Ist das ${found.name}?`} data-testid={`proposal-${id}-same`}>
            <p className="list-row-subtitle">Ist das {found.name}?</p>
            <button type="button" className={`btn btn-small ${same === true ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={same === true} onClick={() => setSame(true)}>Ja</button>{' '}
            <button type="button" className={`btn btn-small ${same === false ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={same === false} onClick={() => setSame(false)}>Nein</button>
          </div>
        )}
        {editing && (
          <div className="sim-form" data-testid={`proposal-${id}-form`}>
            <label className="field">Gesamt<input value={total} inputMode="decimal" onChange={(e) => setTotal(e.target.value)} /></label>
            <label className="field">Raten<input value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value)} /></label>
            <label className="field">Rate<input value={rate} inputMode="decimal" onChange={(e) => setRate(e.target.value)} /></label>
            <label className="field">Fälligkeitstag<input value={day} inputMode="numeric" onChange={(e) => setDay(e.target.value)} /></label>
            <label className="field">Start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <Segmented name={`catch-up-${id}`} legend="Wie wird ein Rückstand nachgezahlt?" value={mode} onChange={setMode} options={CATCH_UP_OPTIONS} />
          </div>
        )}
        {errors.length > 0 && (editing || p.complete) && (
          <ul className="form-error" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        )}
        {blocker && <p className="list-row-subtitle" data-testid={`proposal-${id}-blocker`}>{blocker}{!editing && errors.length > 0 && ' Zum Ergänzen auf „Bearbeiten“ tippen.'}</p>}
        <div className="member-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing((v) => !v)}>Bearbeiten</button>
          <button type="button" className="btn btn-secondary" onClick={onDismiss}>{dismissLabel}</button>
          <button type="button" className="btn btn-primary" disabled={blocker !== null}
            onClick={() => onConfirm(draft, found.match === 'name' && same === true ? found.contactId : null)}>Übernehmen</button>
        </div>
      </div>
    </article>
  );
}
