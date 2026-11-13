import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { InvoiceReadError, type InvoiceReadInput, type InvoiceReader } from '@/domain/ai-port';
import { READ_PRICE } from '@/domain/import/invoice-reading';
import { formatEuro } from '@/domain/money';
import type { InvoiceReadResult } from '@/domain/types';

const nullable = (type: 'integer' | 'string') => ({ anyOf: [{ type }, { type: 'null' }] });

/** Strukturierte Ausgabe; Grenzen prüft die Domain (`planFromReading`), nicht das Schema. */
export const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hasPlan: { type: 'boolean' },
    kind: { type: 'string', enum: ['membership', 'ticket', 'other'] },
    installments: nullable('integer'),
    installmentCents: nullable('integer'),
    firstDueDate: nullable('string'),
    dueDay: nullable('integer'),
    quote: { type: 'string' },
    certain: { type: 'boolean' },
    note: nullable('string'),
  },
  required: ['hasPlan', 'kind', 'installments', 'installmentCents', 'firstDueDate', 'dueDay', 'quote', 'certain', 'note'],
} as const;

export const READ_SYSTEM_PROMPT = `Du liest eine deutsche Rechnung eines Netzwerks (Mitgliedschaften, Event-Tickets, Workshops) und erkennst, ob die Summe DIESER Rechnung in Raten bezahlt wird.

Regeln:
- hasPlan = true nur, wenn der Text sagt, dass der Rechnungsbetrag in mehreren Raten bezahlt wird (z. B. „zahlbar in 6 Monatsraten“, „Ticket in 3 Raten“).
- Ist die Rechnung selbst nur eine Monatsrate oder ein Monatsbeitrag („Rate 3 von 12“, „Monatsbeitrag November“), ist hasPlan = false.
- kind: "membership" für Mitgliedschaften, "ticket" für Event-Tickets, sonst "other".
- installments = Anzahl der Raten, installmentCents = Betrag einer Rate in Cent (ganze Zahl). Steht kein Ratenbetrag im Text, teile den Gesamtbetrag durch die Anzahl und runde auf ganze Cent ab.
- firstDueDate = Datum der ersten Rate als YYYY-MM-DD, nur wenn es im Text steht; dueDay = Fälligkeitstag im Monat (1–31, 31 = Monatsende), nur wenn er im Text steht. Sonst null.
- quote = der Satz bzw. die Sätze aus dem Text, auf die du dich stützt, wörtlich. Ohne Plan: leerer String.
- Nichts raten. Fehlt etwas oder ist der Text mehrdeutig: certain = false und note = kurzer Grund auf Deutsch. Sonst certain = true und note = null.`;

const userText = (i: InvoiceReadInput): string =>
  `Rechnungsnummer: ${i.number}\nGesamtbetrag: ${formatEuro(i.totalCents)} (${i.totalCents} Cent)\nRechnungsdatum: ${i.issuedOn}\nFällig laut Lexware: ${i.dueDate}\n\nRechnungstext:\n${i.text}`;

const REFUSED: InvoiceReadResult = { hasPlan: false, kind: 'other', installments: null, installmentCents: null, firstDueDate: null, dueDay: null, quote: '', certain: false, note: 'Claude hat die Lesung abgelehnt' };

/** Fehler ohne Schlüssel und ohne Originaltext. */
function toReadError(e: unknown): InvoiceReadError {
  if (e instanceof InvoiceReadError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new InvoiceReadError('Claude-Schlüssel ungültig oder ohne Rechte', true);
  if (e instanceof Anthropic.RateLimitError) return new InvoiceReadError('Claude ausgelastet (429)', false);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new InvoiceReadError('Zeitüberschreitung', false);
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && e.status >= 500) return new InvoiceReadError(`Claude-Störung (${e.status})`, false);
  return new InvoiceReadError('Unbekannter Fehler', false);
}

type Client = { messages: { create: Anthropic['messages']['create'] } };

export function createClaudeInvoiceReader(o: { apiKey: string; client?: Client }): InvoiceReader {
  const client: Client = o.client ?? new Anthropic({ apiKey: o.apiKey, maxRetries: 0 });
  const model = READ_PRICE.model;
  return {
    model,
    async read(i, opts) {
      let res: Anthropic.Message;
      try {
        const body: Anthropic.MessageCreateParamsNonStreaming = {
          model, max_tokens: 4000,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: READ_SCHEMA as unknown as Record<string, unknown> } },
          system: READ_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userText(i) }],
        };
        res = await client.messages.create(body, { timeout: opts.timeoutMs });
      } catch (e) {
        throw toReadError(e);
      }
      const usage = { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
      if (res.stop_reason === 'refusal') return { result: REFUSED, model, ...usage };
      const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
      if (res.stop_reason === 'max_tokens' || !text) throw new InvoiceReadError('Antwort unvollständig', false);
      try {
        return { result: JSON.parse(text) as InvoiceReadResult, model, ...usage };
      } catch {
        throw new InvoiceReadError('Antwort unvollständig', false);
      }
    },
  };
}
