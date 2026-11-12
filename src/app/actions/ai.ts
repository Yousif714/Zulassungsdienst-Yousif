'use server';

import { stateAI, type Tone } from '@/ai/state-ai';
import { createStateTools } from '@/ai/tools';
import { handleInbound } from '@/domain/assistant';
import type { ChatAnswer } from '@/domain/ai-port';
import { realNow } from '@/domain/clock';
import type { StoreEvent } from '@/domain/events';
import type { AppState, Call } from '@/domain/types';
import { requireSession } from '@/server/auth/session';
import { getActionProvider, getAI, getRepos } from '@/server/registry';
import { dispatchEvents, loadState } from '@/server/state-service';

const MAX_TEXT = 4000;

/** Jede Action prüft zuerst die Sitzung und die Eingaben (Server Actions sind öffentliche Endpunkte). */
async function guard(...texts: unknown[]): Promise<void> {
  if (!(await requireSession())) throw new Error('Nicht angemeldet');
  if (!texts.every((t) => typeof t === 'string' && t.trim().length > 0 && t.length <= MAX_TEXT)) throw new Error('Ungültige Eingabe');
}

async function serverAI() {
  const at = realNow();
  return stateAI(getAI(), await loadState(getRepos(), at), at);
}

export async function askAI(question: string): Promise<ChatAnswer> {
  await guard(question);
  return (await serverAI()).answer(question);
}

export async function draftReplyFor(threadId: string): Promise<string> {
  await guard(threadId);
  return (await serverAI()).draftReply(threadId);
}

export async function draftReminderFor(contractId: string, tone: Tone): Promise<string> {
  await guard(contractId);
  if (tone !== 'freundlich' && tone !== 'bestimmt') throw new Error('Ungültige Eingabe');
  return (await serverAI()).draftReminder(contractId, tone);
}

export async function slidesForCall(callId: string): Promise<Call['slides']> {
  await guard(callId);
  return (await serverAI()).slidesFor(callId);
}

/**
 * Nachricht des Inhabers an den Assistenten. Die Ereignisse aus `handleInbound` sind hier Server-Ereignisse
 * (nicht über `isClientEvent`); ein Erinnerungsentwurf wird als Echt-Entwurf gespeichert.
 */
export async function sendToAssistant(text: string): Promise<{ state: AppState }> {
  await guard(text);
  const repos = getRepos();
  const at = realNow();
  const s = await loadState(repos, at);
  const r = await handleInbound(s, s.settings.ownerPhone, text.trim(), at, getAI(), createStateTools(s, at));
  const events = r.events.map((e): StoreEvent => (e.type === 'createAction' ? { ...e, action: { ...e.action, isDemo: false } } : e));
  const { state } = await dispatchEvents(repos, events, { at: realNow, provider: getActionProvider() });
  return { state };
}
