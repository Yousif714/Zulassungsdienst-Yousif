import { addDaysIso, berlinLocalToUtc, todayBerlin } from './clock';
import type { Commitment } from './types';

const norm = (t: string) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Frist einer Zusage: „heute“/„morgen“ → 18:00 Uhr Berlin, sonst 48 Std. nach dem Senden. */
function dueAtFor(text: string, sentAt: string): string {
  const day = todayBerlin(new Date(sentAt));
  const t = norm(text);
  if (/\bheute\b/.test(t)) return berlinLocalToUtc(day, '18:00').toISOString();
  if (/\bmorgen\b/.test(t)) return berlinLocalToUtc(addDaysIso(day, 1), '18:00').toISOString();
  return new Date(Date.parse(sentAt) + 48 * 3_600_000).toISOString();
}

/** Erkennt eine Zusage des Inhabers (Rechnung schicken, zurückrufen) in einer ausgehenden Nachricht. */
export function detectCommitment(text: string, sentAt: string): { kind: Commitment['kind']; dueAt: string } | null {
  let kind: 'invoice' | 'callback' | null = null;
  if (/(schick|send)\w*.*rechnung|rechnung.*(schick|send)/i.test(text)) kind = 'invoice';
  else if (/(ruf\w* .*zurück|melde mich)/i.test(text)) kind = 'callback';
  return kind ? { kind, dueAt: dueAtFor(text, sentAt) } : null;
}
