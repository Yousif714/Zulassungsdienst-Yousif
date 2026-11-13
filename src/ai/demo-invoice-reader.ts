import type { InvoiceReader } from '@/domain/ai-port';
import type { ContractKind, InvoiceReadResult } from '@/domain/types';

/** Satz (bis Punkt oder Zeilenende), der die Fundstelle enthält. */
function sentenceAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('.', index - 1), text.lastIndexOf('\n', index - 1)) + 1;
  const dot = text.indexOf('.', index);
  const nl = text.indexOf('\n', index);
  const end = [dot === -1 ? text.length : dot + 1, nl === -1 ? text.length : nl].reduce((a, b) => Math.min(a, b));
  return text.slice(start, end).trim();
}

/** Regelbasierter Leser für Demo-Modus, Tests und E2E (keine KI, keine Kosten). */
export const demoInvoiceReader: InvoiceReader = {
  model: 'demo',
  async read(i) {
    const kind: ContractKind = /ticket/i.test(i.text) ? 'ticket' : /mitglied/i.test(i.text) ? 'membership' : 'other';
    const none = { installments: null, installmentCents: null, firstDueDate: null, dueDay: null };
    const m = /in (\d+) (?:Monats)?raten/i.exec(i.text) ?? /(\d+) Monatsraten/i.exec(i.text);
    let result: InvoiceReadResult;
    if (m && Number(m[1]) > 0) {
      const n = Number(m[1]);
      result = { hasPlan: true, kind, ...none, installments: n, installmentCents: Math.floor(i.totalCents / n), quote: sentenceAt(i.text, m.index), certain: true, note: null };
    } else {
      const loose = /\bRaten\b/i.exec(i.text);
      result = loose
        ? { hasPlan: true, kind, ...none, quote: sentenceAt(i.text, loose.index), certain: false, note: 'Anzahl der Raten fehlt' }
        : { hasPlan: false, kind, ...none, quote: '', certain: true, note: null };
    }
    return { result, model: 'demo', inputTokens: 0, outputTokens: 0 };
  },
};
