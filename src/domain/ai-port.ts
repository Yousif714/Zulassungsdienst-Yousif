import type { Call, Commitment, Contact, InvoiceReadResult, IsoDate, Job, Message } from './types';
import type { MemberStatus } from './ledger/status';

export interface ChatAnswer { text: string; links: { label: string; href: string }[] }

export type ToolName = 'overdue_members' | 'open_today' | 'month_money' | 'series_calls' | 'find_job';

export interface ToolArgs {
  overdue_members: Record<string, never>;
  open_today: Record<string, never>;
  month_money: Record<string, never>;
  series_calls: { query: string };
  find_job: { query: string };
}

export interface ToolResult {
  overdue_members: { members: { contractId: string; name: string; arrearsCents: number; traffic: 'yellow' | 'red' }[] };
  open_today: { openCount: number; top: { title: string; nextStep: string; href: string | null }[] };
  month_money: { expectedCents: number; atRiskCents: number; zulassungOpenCents: number; zulassungOpenCount: number };
  series_calls: {
    series: string | null;
    next: { id: string; topic: string; startsAt: string; slides: number; slideCount: number } | null;
  };
  find_job: {
    contact: { id: string; name: string } | null;
    job: { id: string; service: string; status: Job['status'] } | null;
    lastMessage: { direction: Message['direction']; sentAt: string; body: string; threadId: string } | null;
    waitingHours: number | null;
  };
}

export interface AITools {
  call<K extends ToolName>(name: K, args: ToolArgs[K]): Promise<ToolResult[K]>;
}

export interface AIContext { now: Date; tools: AITools }

export interface AIProvider {
  answer(q: string, ctx: AIContext): Promise<ChatAnswer>;
  draftReply(i: { thread: Message[]; contact: Contact | null }): Promise<string>;
  draftReminder(i: { contact: Contact; status: MemberStatus; tone: 'freundlich' | 'bestimmt'; paymentLink: string }): Promise<string>;
  slidesFor(call: Call): Promise<Call['slides']>;
  detectCommitment(text: string, sentAt: string): Promise<{ kind: Commitment['kind']; dueAt: string } | null>;
}

/** Rechnung lesen: nur diese Felder gehen an den Leser (kein Kontaktname, keine E-Mail). */
export interface InvoiceReadInput { number: string; totalCents: number; issuedOn: IsoDate; dueDate: IsoDate; text: string }
export interface InvoiceReadOutput { result: InvoiceReadResult; model: string; inputTokens: number; outputTokens: number }
/** fatal = Schlüssel ungültig oder ohne Rechte (weitere Versuche im selben Lauf sinnlos). */
export class InvoiceReadError extends Error {
  constructor(message: string, readonly fatal: boolean) {
    super(message);
    this.name = 'InvoiceReadError';
  }
}
export interface InvoiceReader { readonly model: string; read(i: InvoiceReadInput, o: { timeoutMs: number }): Promise<InvoiceReadOutput> }
