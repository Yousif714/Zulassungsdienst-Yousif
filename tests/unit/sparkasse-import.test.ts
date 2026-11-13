import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { applyEvent } from '@/data/engine';
import { createDemoState } from '@/data/seed';
import { parseCamt053, parseSparkasseCsv, type SparkasseResult } from '@/domain/import/sparkasse';
import { detectStaleSources } from '@/domain/detectors/sources';
import { statementSummary } from '@/domain/import/statement';
import type { AppState } from '@/domain/types';
import { NOW_0930 } from './helpers';

const csv = readFileSync('tests/fixtures/sparkasse/umsaetze-beispiel.csv', 'utf8');
const camt = readFileSync('tests/fixtures/sparkasse/auszug-beispiel.xml', 'utf8');
const header = csv.split('\n')[0] + '\n';
const line = (d: string, text: string, ref: string, name: string, iban: string, amount: string) =>
  `"DE00360501050000009999";"${d}";"${d}";"${text}";"${ref}";"";"";"";"";"";"";"${name}";"${iban}";"XXXXDEXXXXX";"${amount}";"EUR";"Umsatz gebucht"\n`;
const IBAN_A = 'DE00100000000000000011';

const eventCtx = { at: NOW_0930, isDemo: true, newId: () => crypto.randomUUID() };
const demo = () => createDemoState();
const ev = (r: SparkasseResult) => ({ type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: r.payments, statementTo: r.to! }) as const;
const spk = (s: AppState) => s.payments.filter((p) => p.connectionId === 'bank_sparkasse');
const parsed = (text: string) => parseSparkasseCsv(header + text)!;

test('Beispieldatei in den Demo-Stand: 2 automatisch, 1 Vorschlag, 1 ohne Treffer', () => {
  const s0 = demo();
  const s = applyEvent(s0, ev(parseSparkasseCsv(csv)!), eventCtx).state;
  const ids = spk(s).map((p) => p.id);
  expect(statementSummary(s, ids, NOW_0930)).toEqual({ fresh: 4, auto: 2, toConfirm: 1, noMatch: 1 });
  expect(s.connections.find((c) => c.id === 'bank_sparkasse')).toMatchObject({ status: 'connected', sync: { cursor: '2026-11-11', complete: true, failures: 0 } });
  expect(s.audit.some((a) => a.text === 'Sparkasse-Auszug übernommen: 4 neu, 0 schon vorhanden')).toBe(true);
});

test('zweimal derselbe Auszug → keine neue Zahlung, Zuordnungen unverändert', () => {
  const r = parseSparkasseCsv(csv)!;
  const once = applyEvent(demo(), ev(r), eventCtx).state;
  const twice = applyEvent(once, ev(r), eventCtx).state;
  expect(twice.payments).toHaveLength(once.payments.length);
  expect(twice.allocations).toEqual(once.allocations);
  expect(twice.audit.some((a) => a.text === 'Sparkasse-Auszug übernommen: 0 neu, 4 schon vorhanden')).toBe(true);
});

test('CSV, dann CAMT → keine neue Zahlung', () => {
  const once = applyEvent(demo(), ev(parseSparkasseCsv(csv)!), eventCtx).state;
  const twice = applyEvent(once, ev(parseCamt053(camt)!), eventCtx).state;
  expect(spk(once)).toHaveLength(4);
  expect(spk(twice)).toHaveLength(4);
});

test('überlappender Export mit Doppelzeile → 2 Zahlungen am Tag 1, 3 insgesamt', () => {
  const day1 = line('03.11.26', 'GUTSCHR. UEBERWEISUNG', 'Rate', 'Max Mustermann', IBAN_A, '10,00');
  const day2 = line('04.11.26', 'GUTSCHR. UEBERWEISUNG', 'Rate', 'Max Mustermann', IBAN_A, '10,00');
  const a = applyEvent(demo(), ev(parsed(day1 + day1)), eventCtx).state;
  const b = applyEvent(a, ev(parsed(day1 + day1 + day2)), eventCtx).state;
  expect(spk(b)).toHaveLength(3);
  expect(spk(b).filter((p) => p.bookedOn === '2026-11-03')).toHaveLength(2);
});

test('Rückbuchung ohne Original wird verworfen, mit Original verknüpft', () => {
  const ret = line('05.11.26', 'RUECKLASTSCHRIFT', 'Rueckgabe', 'Max Mustermann', IBAN_A, '-10,00');
  const orig = line('03.11.26', 'GUTSCHR. UEBERWEISUNG', 'Rate', 'Max Mustermann', IBAN_A, '10,00');
  const alone = applyEvent(demo(), ev(parsed(ret)), eventCtx).state;
  expect(spk(alone)).toHaveLength(0);
  const both = applyEvent(demo(), ev(parsed(orig + ret)), eventCtx).state;
  const refund = spk(both).find((p) => p.amountCents === -1000)!;
  expect(refund.refundOf).toBe(spk(both).find((p) => p.amountCents === 1000)!.externalId);
});

test('fremde Felder (refundOf, ignoredAt, company) aus dem Event werden nicht übernommen', () => {
  const r = parseSparkasseCsv(csv)!;
  const dirty = r.payments.map((p) => ({ ...p, refundOf: 'x', ignoredAt: '2026-01-01T00:00:00Z', company: 'nexus' as const, kind: 'stripe_payout' as const }));
  const s = applyEvent(demo(), { type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: dirty, statementTo: '2026-11-11' }, eventCtx).state;
  expect(spk(s)).toHaveLength(4);
  for (const p of spk(s)) {
    expect(p.refundOf).toBeUndefined();
    expect(p.ignoredAt).toBeUndefined();
    expect(p.company).toBe('zulassung');
    expect(p.kind).toBe('incoming');
  }
});

const cursorOf = (s: AppState) => s.connections.find((c) => c.id === 'bank_sparkasse')!.sync?.cursor;
test('Auszug ohne neue Zahlungen: 0 Zahlungen erlaubt, lastSuccessAt und Cursor (statementTo) gesetzt', () => {
  const s0 = demo();
  const s = applyEvent(s0, { type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: [], statementTo: '2026-11-12' }, eventCtx).state;
  const c = s.connections.find((x) => x.id === 'bank_sparkasse')!;
  expect(spk(s)).toHaveLength(0);
  expect(c).toMatchObject({ status: 'connected', lastSuccessAt: NOW_0930.toISOString(), sync: { cursor: '2026-11-12', complete: true, failures: 0 } });
});
test('Cursor = Maximum aus bisherigem Cursor, statementTo und jüngster Buchung', () => {
  const r = parseSparkasseCsv(csv)!; // jüngste Buchung 2026-11-11
  const a = applyEvent(demo(), { ...ev(r), statementTo: '2026-11-09' }, eventCtx).state;
  expect(cursorOf(a)).toBe('2026-11-11');
  const b = applyEvent(a, { type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: [], statementTo: '2026-11-12' }, eventCtx).state;
  expect(cursorOf(b)).toBe('2026-11-12');
  const c = applyEvent(b, { type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: [], statementTo: '2026-11-05' }, eventCtx).state;
  expect(cursorOf(c)).toBe('2026-11-12');
});
test('7-Tage-Hinweis verschwindet nach Auszug ohne neue Zahlungen', () => {
  const old = demo();
  const stale = { ...old, connections: old.connections.map((c) => (c.id === 'bank_sparkasse' ? { ...c, status: 'connected' as const, lastSuccessAt: '2026-11-01T09:00:00Z', sync: { cursor: '2026-11-01', complete: true, failures: 0 } } : c)) };
  expect(detectStaleSources(stale, NOW_0930).some((i) => i.dedupeKey === 'stale:bank_sparkasse')).toBe(true);
  const s = applyEvent(stale, { type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: [], statementTo: '2026-11-12' }, eventCtx).state;
  expect(detectStaleSources(s, NOW_0930).some((i) => i.dedupeKey === 'stale:bank_sparkasse')).toBe(false);
});
