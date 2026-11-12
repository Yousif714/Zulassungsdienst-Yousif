'use client';

import { useMemo } from 'react';

import { demoAI } from '@/ai/demo-ai';
import { stateAI, type Tone } from '@/ai/state-ai';
import { askAI, draftReminderFor, draftReplyFor, sendToAssistant, slidesForCall } from '@/app/actions/ai';
import type { ChatAnswer } from '@/domain/ai-port';
import { handleInbound } from '@/domain/assistant';
import { now } from '@/domain/clock';
import type { Call } from '@/domain/types';
import { createStateTools } from '@/ai/tools';
import { useAdoptState, useAppStore } from './store';

export interface AIClient {
  answer(q: string): Promise<ChatAnswer>;
  draftReply(threadId: string): Promise<string>;
  draftReminder(contractId: string, tone: Tone): Promise<string>;
  slidesFor(callId: string): Promise<Call['slides']>;
  sendToAssistant(text: string): Promise<void>;
}

/** KI für die Seiten: im Demo-Modus lokal mit dem Demo-Assistenten, sonst über die Server Actions. */
export function useAI(): AIClient {
  const { state, dispatch, mode } = useAppStore();
  const adopt = useAdoptState();
  return useMemo<AIClient>(() => {
    if (mode !== 'demo') {
      return {
        answer: askAI,
        draftReply: draftReplyFor,
        draftReminder: draftReminderFor,
        slidesFor: slidesForCall,
        async sendToAssistant(text) {
          adopt((await sendToAssistant(text)).state);
        },
      };
    }
    const local = () => stateAI(demoAI, state, now());
    return {
      answer: (q) => local().answer(q),
      draftReply: (id) => local().draftReply(id),
      draftReminder: (id, tone) => local().draftReminder(id, tone),
      slidesFor: (id) => local().slidesFor(id),
      async sendToAssistant(text) {
        const at = now();
        // Demo spielt den WhatsApp-Weg nach: Absender ist die Demo-Inhaber-Nummer.
        const r = await handleInbound(state, state.settings.ownerPhone, text, at, demoAI, createStateTools(state, at), { channel: 'whatsapp', isDemo: true });
        r.events.forEach(dispatch);
      },
    };
  }, [mode, state, dispatch, adopt]);
}
