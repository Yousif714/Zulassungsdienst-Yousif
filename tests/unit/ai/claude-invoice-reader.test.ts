import Anthropic from '@anthropic-ai/sdk';
import { expect, test } from 'vitest';
import { createClaudeInvoiceReader } from '@/ai/claude-invoice-reader';
import { InvoiceReadError } from '@/domain/ai-port';
import { okResult } from '../import/reading-fixtures';

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = 'sk-test-geheim-123456';
const stub = (impl: (body: any, opts: any) => any) => {
  const calls: any[] = [];
  return { calls, client: { messages: { create: (async (b: any, o: any) => { calls.push([b, o]); return impl(b, o); }) as any } } };
};
const msg = (json: object, p = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1000, output_tokens: 500 }, ...p });
const input = { number: 'RE-9001', totalCents: 60000, issuedOn: '2026-10-01', dueDate: '2026-10-15', text: 'zahlbar in 6 Monatsraten' };
const fails = async (thrown: unknown): Promise<InvoiceReadError> => {
  const r = createClaudeInvoiceReader({ apiKey: KEY, client: stub(() => { throw thrown; }).client });
  try { await r.read(input, { timeoutMs: 1000 }); } catch (e) { return e as InvoiceReadError; }
  throw new Error('kein Fehler');
};

test('sendet nur die erlaubten Felder, Modell und JSON-Schema, low effort, Zeitlimit', async () => {
  const s = stub(() => msg(okResult()));
  const r = createClaudeInvoiceReader({ apiKey: KEY, client: s.client });
  const o = await r.read(input, { timeoutMs: 12000 });
  const [body, opts] = s.calls[0];
  expect(body).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low', format: { type: 'json_schema' } } });
  expect(body.output_config.format.schema).toMatchObject({ type: 'object', additionalProperties: false });
  expect(body.output_config.format.schema.required).toEqual(expect.arrayContaining(['hasPlan', 'kind', 'installments', 'installmentCents', 'firstDueDate', 'dueDay', 'quote', 'certain', 'note']));
  expect(body.thinking).toBeUndefined();
  expect(JSON.stringify(body.messages)).toContain('RE-9001');
  expect(JSON.stringify(body.messages)).toContain('zahlbar in 6 Monatsraten');
  expect(JSON.stringify(body.messages)).not.toMatch(/@|Kontakt/);
  expect(opts).toMatchObject({ timeout: 12000 });
  expect(o).toEqual({ result: okResult(), model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500 });
  expect(r.model).toBe('claude-opus-5-5');
});

test('Ablehnung → kein Plan; max_tokens und kaputtes JSON → Fehler', async () => {
  const refused = createClaudeInvoiceReader({ apiKey: KEY, client: stub(() => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 10, output_tokens: 0 } })).client });
  const o = await refused.read(input, { timeoutMs: 1000 });
  expect(o.result).toMatchObject({ hasPlan: false, certain: false, note: 'Claude hat die Lesung abgelehnt' });
  expect(o.inputTokens).toBe(10);
  const cut = createClaudeInvoiceReader({ apiKey: KEY, client: stub(() => msg(okResult(), { stop_reason: 'max_tokens' })).client });
  await expect(cut.read(input, { timeoutMs: 1000 })).rejects.toMatchObject({ message: 'Antwort unvollständig', fatal: false });
  const bad = createClaudeInvoiceReader({ apiKey: KEY, client: stub(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{kaputt' }], usage: { input_tokens: 1, output_tokens: 1 } })).client });
  await expect(bad.read(input, { timeoutMs: 1000 })).rejects.toBeInstanceOf(InvoiceReadError);
});

test('429, 5xx, Zeitüberschreitung → nicht fatal; 401/403 → fatal; Text ohne Schlüssel', async () => {
  const h = new Headers();
  const cases: [unknown, string, boolean][] = [
    [new Anthropic.RateLimitError(429, undefined, `rate ${KEY}`, h), 'Claude ausgelastet (429)', false],
    [new Anthropic.InternalServerError(503, undefined, KEY, h), 'Claude-Störung (503)', false],
    [new Anthropic.APIConnectionTimeoutError(), 'Zeitüberschreitung', false],
    [new Anthropic.AuthenticationError(401, undefined, KEY, h), 'Claude-Schlüssel ungültig oder ohne Rechte', true],
    [new Anthropic.PermissionDeniedError(403, undefined, KEY, h), 'Claude-Schlüssel ungültig oder ohne Rechte', true],
    [new Error(KEY), 'Unbekannter Fehler', false],
  ];
  for (const [thrown, text, fatal] of cases) {
    const err = await fails(thrown);
    expect(err).toBeInstanceOf(InvoiceReadError);
    expect(err.message).toBe(text);
    expect(err.fatal).toBe(fatal);
    expect(err.message).not.toContain(KEY);
  }
});
