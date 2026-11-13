'use client';

import { useRouter } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { ProposalCard } from '@/components/ProposalCard';
import { waitingStripePayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { deriveProposals } from '@/domain/import/proposals';

export default function ProposalsPage() {
  const { state, dispatch } = useAppStore();
  const router = useRouter();
  const proposals = deriveProposals(state);
  const waiting = waitingStripePayments(state).length;

  return (
    <>
      <PageHeader title="Vorschläge" trailing={<BackLink href="/nexus" label="NEXUS" />} />
      {proposals.length === 0 && <div className="empty-state">Keine Vorschläge offen.</div>}
      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} contacts={state.contacts}
          onDismiss={() => { void dispatch({ type: 'dismissProposal', proposalId: p.id }); }}
          onConfirm={async (draft, contactId) => {
            const { created } = await dispatch({ type: 'confirmProposal', proposalId: p.id, draft, contactId });
            if (created[0]) router.push(`/nexus/mitglieder/${created[0]}/uebernahme`);
          }} />
      ))}
      {waiting > 0 && (
        <ListGroup title="Stripe">
          <ListRow key="waiting" title={waiting === 1 ? '1 Stripe-Zahlung wartet auf einen Vorschlag' : `${waiting} Stripe-Zahlungen warten auf einen Vorschlag`} />
        </ListGroup>
      )}
    </>
  );
}
