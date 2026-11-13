import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { maskIban, previewStatement, previewText, shortDateDe, summaryText } from '@/domain/import/statement';
import { parseSparkasseCsv, type SparkasseResult } from '@/domain/import/sparkasse';
import type { Payment } from '@/domain/types';

const csv = readFileSync('tests/fixtures/sparkasse/umsaetze-beispiel.csv', 'utf8');
const stored = (r: SparkasseResult): Payment[] => r.payments.map((p, i) => ({ ...p, id: `p${i}` }));

test('maskIban und shortDateDe', () => {
  expect(maskIban('DE00360501050000009999')).toBe('DE00 … 9999');
  expect(shortDateDe('2026-11-03')).toBe('03.11.');
});
test('Vorschau Beispieldatei, leerer Bestand', () => {
  const p = previewStatement(parseSparkasseCsv(csv)!, []);
  expect(previewText(p)).toEqual(['4 Buchungen · 4 neu · 0 schon vorhanden', 'Zeitraum 03.11.–11.11. · Konto DE00 … 9999', 'übersprungen: 1 Ausgabe']);
});
test('Vorschau nach Übernahme: 0 neu · 4 schon vorhanden', () => {
  const r = parseSparkasseCsv(csv)!;
  const p = previewStatement(r, stored(r));
  expect(p).toMatchObject({ bookings: 4, fresh: 0, existing: 4 });
  expect(previewText(p)[0]).toBe('4 Buchungen · 0 neu · 4 schon vorhanden');
});
test('Vorschau beschriftet alle Überspringgründe, Einzahl und Mehrzahl', () => {
  const r = { ...parseSparkasseCsv(csv)!, skipped: [
    { reason: 'expense', count: 2 }, { reason: 'pending', count: 1 }, { reason: 'currency', count: 1 },
    { reason: 'before_since', count: 3 }, { reason: 'unreadable', count: 2 }, { reason: 'zero', count: 1 },
  ] } satisfies SparkasseResult;
  expect(previewText(previewStatement(r, []))[2]).toBe(
    'übersprungen: 2 Ausgaben, 1 vorgemerkte Buchung, 1 Fremdwährung, 3 Buchungen vor Importbeginn, 2 unlesbare Zeilen, 1 Buchung ohne Betrag');
});
test('Zusammenfassungstext', () => expect(summaryText({ fresh: 31, auto: 24, toConfirm: 5, noMatch: 2 })).toBe('31 neu · 24 automatisch zugeordnet · 5 zum Bestätigen · 2 ohne Treffer'));
