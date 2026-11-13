import { expect, test } from 'vitest';
import { demoInvoiceReader } from '@/ai/demo-invoice-reader';

const input = (text: string, totalCents = 60000) => ({ number: 'RE-9001', totalCents, issuedOn: '2026-10-01', dueDate: '2026-10-15', text });

test('„zahlbar in 6 Monatsraten“ → 6 Raten, sicher, Ticket', async () => {
  const o = await demoInvoiceReader.read(input('Ticket NEXUS Summit. Zahlbar in 6 Monatsraten.'), { timeoutMs: 1000 });
  expect(o.result).toMatchObject({ hasPlan: true, kind: 'ticket', installments: 6, installmentCents: 10000, certain: true, quote: 'Zahlbar in 6 Monatsraten.', firstDueDate: null, dueDay: null });
  expect(o).toMatchObject({ model: 'demo', inputTokens: 0, outputTokens: 0 });
});

test('„12 Monatsraten“ bei Mitgliedschaft → membership, abgerundet', async () => {
  const o = await demoInvoiceReader.read(input('NEXUS-Mitgliedschaft, 12 Monatsraten', 100000), { timeoutMs: 1000 });
  expect(o.result).toMatchObject({ hasPlan: true, kind: 'membership', installments: 12, installmentCents: 8333, certain: true });
});

test('„Raten nach Absprache“ → unsicher ohne Zahlen', async () => {
  const o = await demoInvoiceReader.read(input('Beratung. Zahlung in Raten nach Absprache.'), { timeoutMs: 1000 });
  expect(o.result).toMatchObject({ hasPlan: true, kind: 'other', installments: null, installmentCents: null, certain: false, note: 'Anzahl der Raten fehlt' });
});

test('„Rate 3 von 6“ und „Workshop“ → kein Plan', async () => {
  expect((await demoInvoiceReader.read(input('Mitgliedschaft, Rate 3 von 6'), { timeoutMs: 1000 })).result.hasPlan).toBe(false);
  expect((await demoInvoiceReader.read(input('Workshop'), { timeoutMs: 1000 })).result).toMatchObject({ hasPlan: false, quote: '' });
});
