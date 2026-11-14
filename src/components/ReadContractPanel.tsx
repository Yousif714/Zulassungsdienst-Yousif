'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { StoreEvent } from '@/domain/events';
import { correctionProposal, readContractSteps } from '@/domain/import/invoice-reading';
import { contractKindLabel } from '@/domain/ledger/contracts';
import { contractLockedReason } from '@/domain/takeover/status';
import type { AppState, MemberContract } from '@/domain/types';

import { ProposalCard } from './ProposalCard';

/** Plakette „Von Claude gelesen“ mit Zitat, Rechenweg und Passt/Korrigieren/Löschen (nur für Verträge mit `readBy`). */
export function ReadContractPanel({ state, contract: c, dispatch }: { state: AppState; contract: MemberContract; dispatch: (e: StoreEvent) => unknown }) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState(false);
  if (!c.readBy) return null;
  const steps = readContractSteps(state, c);
  // Umstellung läuft: Korrektur oder Löschen brächte Ledger und Stripe auseinander.
  const locked = contractLockedReason(state, c.id);
  const remove = () => {
    if (!confirm('Ratenvertrag löschen? Claude legt ihn nicht wieder an.')) return;
    void Promise.resolve(dispatch({ type: 'deleteReadContract', contractId: c.id })).finally(() => router.push('/nexus/mitglieder'));
  };

  return (
    <section className="list-group" aria-label="Von Claude gelesen">
      {!c.readBy.confirmed && (
        <div className="note-card" data-testid="read-badge">
          <p className="list-row-title">Von Claude gelesen <span className="chip">{contractKindLabel(c.kind)}</span></p>
          {c.readBy.quote && <blockquote className="list-row-subtitle" data-testid="read-quote">„{c.readBy.quote}“</blockquote>}
          <p className="list-row-subtitle">Quelle: Rechnung {c.readBy.invoiceNumber}</p>
          {steps.length > 0 && <ol className="steps">{steps.map((x) => <li key={x}>{x}</li>)}</ol>}
          <div className="member-actions">
            <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'confirmReadContract', contractId: c.id })}>Passt</button>
            {!locked && <button type="button" className="btn btn-secondary" onClick={() => setCorrecting(true)}>Korrigieren</button>}
            {!locked && <button type="button" className="btn btn-secondary" onClick={remove}>Löschen</button>}
          </div>
        </div>
      )}
      {locked && <p className="note-card" data-testid="read-locked">{locked}</p>}
      {c.readBy.confirmed && !correcting && !locked && (
        <div className="member-actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setCorrecting(true)}>Ratenplan korrigieren</button>
        </div>
      )}
      {correcting && !locked && (
        <ProposalCard proposal={correctionProposal(state, c)} contacts={[]} confirmLabel="Speichern" dismissLabel="Abbrechen"
          onDismiss={() => setCorrecting(false)}
          onConfirm={(draft) => { dispatch({ type: 'correctContract', contractId: c.id, draft }); setCorrecting(false); }} />
      )}
    </section>
  );
}
