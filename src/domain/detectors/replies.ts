import { openReplies } from '../matching/messages';
import type { AppState, Insight } from '../types';
import { threadRef } from './refs';

export function detectReplies(s: AppState, now: Date): Insight[] {
  return openReplies(s.messages, now, s.settings.replyThresholdHours).map(({ message: m, waitingHours }) => {
    const contact = s.contacts.find((c) => c.id === m.contactId);
    const name = contact?.name ?? m.from;
    return {
      dedupeKey: `reply:${m.id}`,
      type: 'reply_waiting',
      company: contact?.company ?? null,
      priority: contact?.kind === 'dealer' && waitingHours >= 3 ? 'now' : 'today',
      title: `${name} wartet seit ${waitingHours} Std. auf Antwort`,
      body: m.body,
      refs: [threadRef(m.threadId, name)],
      nextStep: 'Antwort senden',
      needsSources: [m.connectionId],
    } satisfies Insight;
  });
}
