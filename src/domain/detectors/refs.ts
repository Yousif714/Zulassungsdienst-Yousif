import type { Ref } from '../types';

export const memberRef = (contractId: string, label: string): Ref => ({ kind: 'member', id: contractId, href: `/nexus/mitglieder/${contractId}`, label });
export const threadRef = (threadId: string, label: string): Ref => ({ kind: 'thread', id: threadId, href: `/nachrichten/${threadId}`, label });
export const jobRef = (jobId: string, label: string): Ref => ({ kind: 'job', id: jobId, href: `/zulassung/auftraege/${jobId}`, label });
export const callRef = (callId: string, label: string): Ref => ({ kind: 'call', id: callId, href: `/nexus/calls/${callId}`, label });
export const paymentRef = (paymentId: string, label: string): Ref => ({ kind: 'payment', id: paymentId, href: '/nexus/zuordnen', label });
export const connectionRef = (id: string, label: string): Ref => ({ kind: 'connection', id, href: '/verbindungen', label });
export const invoiceRef = (inv: { id: string; company: 'nexus' | 'zulassung'; contactId: string | null }, label: string): Ref => ({
  kind: 'invoice',
  id: inv.id,
  href: inv.company === 'nexus' || !inv.contactId ? '/nexus/zuordnen' : `/zulassung/kunden/${inv.contactId}`,
  label,
});
export const receivableRef = (invoiceId: string, label: string): Ref => ({ kind: 'invoice', id: invoiceId, href: '/nexus/offen', label });
