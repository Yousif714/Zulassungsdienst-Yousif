import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { decodeListFile } from '@/domain/import/portal-list';
import { fnv1a64, parseDeAmountCents, parseDeDate, parseSparkasseCsv, statementKey } from '@/domain/import/sparkasse';

const csv = readFileSync('tests/fixtures/sparkasse/umsaetze-beispiel.csv', 'utf8');
const header = csv.split('\n')[0] + '\n';
const line = (d: string, text: string, ref: string, name: string, amount: string, o: { cur?: string; info?: string } = {}) =>
  `"DE00360501050000009999";"${d}";"${d}";"${text}";"${ref}";"";"";"";"";"";"";"${name}";"DE00100000000000000001";"XXXXDEXXXXX";"${amount}";"${o.cur ?? 'EUR'}";"${o.info ?? 'Umsatz gebucht'}"\n`;
const row = line('03.11.26', 'GUTSCHR. UEBERWEISUNG', 'RE-Z-2026-290', 'Max Mustermann', '10,00');
const otherDayRow = line('04.11.26', 'GUTSCHR. UEBERWEISUNG', 'RE-Z-2026-291', 'Max Mustermann', '20,00');

test('FNV-1a 64 Testvektoren', () => {
  expect(fnv1a64('')).toBe('cbf29ce484222325');
  expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
});
test.each([['1.234,56', 123456], ['-12,00', -1200], ['0,5', 50], ['99', 9900], ['1,234', null], ['abc', null]])('Betrag %s → %s', (s, c) =>
  expect(parseDeAmountCents(s)).toBe(c));
test.each([['03.11.26', '2026-11-03'], ['03.11.2026', '2026-11-03'], ['31.02.26', null]])('Datum %s → %s', (s, d) =>
  expect(parseDeDate(s)).toBe(d));

test('Beispieldatei: 4 Eingänge, 1 Ausgabe übersprungen, Zeitraum, Konto', () => {
  const r = parseSparkasseCsv(csv)!;
  expect(r.format).toBe('csv');
  expect(r.payments.map((p) => p.amountCents)).toEqual([64000, 9900, 8900, 5000]);
  expect(r.payments[0]).toMatchObject({ company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming', bookedOn: '2026-11-03',
    payerName: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000001', reference: 'RE-Z-2026-290 RE-Z-2026-295' });
  expect(r.payments[0].externalId).toMatch(/^spk-[0-9a-f]{16}$/);
  expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  expect([r.from, r.to, r.account]).toEqual(['2026-11-03', '2026-11-11', 'DE00360501050000009999']);
});

test('Rückbuchung (Buchungstext RETOURE) wird negativ übernommen', () => {
  const r = parseSparkasseCsv(header + line('05.11.26', 'RETOURE', 'RE-Z-2026-290', 'Autohaus Mueller GmbH', '-640,00'))!;
  expect(r.payments).toHaveLength(1);
  expect(r.payments[0]).toMatchObject({ amountCents: -64000, kind: 'incoming' });
  expect(r.skipped).toEqual([]);
});

test('vorgemerkt, Fremdwährung, vor Importbeginn werden gezählt, nicht übernommen', () => {
  const r = parseSparkasseCsv(header
    + line('05.11.26', 'GUTSCHR.', 'a', 'Max Mustermann', '5,00', { info: 'Umsatz vorgemerkt' })
    + line('05.11.26', 'GUTSCHR.', 'b', 'Max Mustermann', '5,00', { cur: 'USD' })
    + line('05.05.26', 'GUTSCHR.', 'c', 'Max Mustermann', '5,00')
    + line('xx', 'GUTSCHR.', 'd', 'Max Mustermann', '5,00'))!;
  expect(r.payments).toEqual([]);
  expect(r.skipped).toEqual([{ reason: 'pending', count: 1 }, { reason: 'currency', count: 1 }, { reason: 'before_since', count: 1 }, { reason: 'unreadable', count: 1 }]);
  expect([r.from, r.to]).toEqual(['2026-05-05', '2026-11-05']);
});

test('Windows-1252: Umlaute im Namen bleiben erhalten', () => {
  const enc = new TextEncoder();
  const body = line('03.11.26', 'GUTSCHR.', 'x', 'Autohaus Müller', '5,00');
  const bytes = new Uint8Array([...enc.encode(header), ...[...body].map((c) => c.charCodeAt(0))]);
  expect(parseSparkasseCsv(decodeListFile(bytes))!.payments[0].payerName).toBe('Autohaus Müller');
});

test('gleiche Zeilen → laufende Nummer 0 und 1, verschiedene Schlüssel, stabil', () => {
  const a = parseSparkasseCsv(header + row + row)!.payments;
  const b = parseSparkasseCsv(header + row + row + otherDayRow)!.payments;
  expect(new Set(a.map((p) => p.externalId)).size).toBe(2);
  expect(b.slice(0, 2).map((p) => p.externalId)).toEqual(a.map((p) => p.externalId));
});

test('Zweck mit anderem Leerraum/Großschreibung → gleicher Schlüssel', () =>
  expect(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'de00 1000', reference: 'RE-Z 1' }, 0))
    .toBe(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'DE001000', reference: 're-z1' }, 0)));

test('unbekannte Kopfzeile → null', () => expect(parseSparkasseCsv('Datum;Betrag\n01.11.26;5,00')).toBeNull());
