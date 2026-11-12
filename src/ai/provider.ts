import type { AppState, Call, Commitment, Contact, Message } from '@/domain/types';
import type { MemberStatus } from '@/domain/ledger/status';

export interface ChatAnswer { text: string; links: { label: string; href: string }[] }

export interface AIProvider {
  answer(question: string, s: AppState, now: Date): Promise<ChatAnswer>;
  draftReply(thread: Message[], contact: Contact | null): Promise<string>;
  draftReminder(contact: Contact, status: MemberStatus, tone: 'freundlich' | 'bestimmt', paymentLink: string): Promise<string>;
  slidesFor(call: Call): Promise<Call['slides']>;
  detectCommitment(text: string, sentAt: string): { kind: Commitment['kind']; dueAt: string } | null;
}
