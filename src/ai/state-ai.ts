import { todayBerlin } from '@/domain/clock';
import type { AIProvider, ChatAnswer } from '@/domain/ai-port';
import { memberView } from '@/domain/detectors';
import { paymentLinkFor } from '@/domain/payment-link';
import type { AppState, Call } from '@/domain/types';
import { createStateTools } from './tools';

export type Tone = 'freundlich' | 'bestimmt';

/**
 * KI-Aufrufe über Kennungen statt fertiger Eingaben: dieselbe Auflösung (Unterhaltung, Mitglied, Call) für den
 * lokalen Demo-Client und die Server Actions.
 */
/** `isDemo`: Demo-Modus (nur dann Demo-Zahlungslink in Erinnerungen). */
export function stateAI(ai: AIProvider, s: AppState, at: Date, isDemo: boolean) {
  return {
    answer: (q: string): Promise<ChatAnswer> => ai.answer(q, { now: at, tools: createStateTools(s, at) }),
    draftReply(threadId: string): Promise<string> {
      const thread = s.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
      if (!thread.length) throw new Error('Unterhaltung nicht gefunden');
      const contactId = thread.find((m) => m.contactId)?.contactId ?? null;
      return ai.draftReply({ thread, contact: s.contacts.find((c) => c.id === contactId) ?? null });
    },
    draftReminder(contractId: string, tone: Tone): Promise<string> {
      if (!s.contracts.some((c) => c.id === contractId)) throw new Error('Mitglied nicht gefunden');
      const { contact, status } = memberView(s, contractId, todayBerlin(at));
      if (!contact) throw new Error('Mitglied ohne Kontakt');
      return ai.draftReminder({ contact, status, tone, paymentLink: paymentLinkFor(s, contractId, isDemo) });
    },
    slidesFor(callId: string): Promise<Call['slides']> {
      const call = s.calls.find((c) => c.id === callId);
      if (!call) throw new Error('Call nicht gefunden');
      return ai.slidesFor(call);
    },
  };
}
