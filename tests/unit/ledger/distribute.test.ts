import { expect, test } from 'vitest';
import { distributeInOrder, distributeOldestFirst } from '@/domain/ledger/distribute';

// Referenz 4a: 1.200 € = 4 × 300 €, 450 € gezahlt
const DUE = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'];
const four = [1, 2, 3, 4].map((n) => ({ id: `r${n}`, number: `R-${n}`, dueDate: DUE[n - 1], openCents: 30000 }));

test('älteste zuerst: 450 € auf 4 × 300 € → 300 + 150, Rest 0', () =>
  expect(distributeOldestFirst(45000, [...four].reverse())).toEqual({ shares: [{ id: 'r1', amountCents: 30000 }, { id: 'r2', amountCents: 15000 }], restCents: 0 }));
test('Überzahlung: Rest bleibt', () => expect(distributeOldestFirst(130000, four).restCents).toBe(10000));
test('gleiche Fälligkeit → nach Nummer', () =>
  expect(distributeOldestFirst(100, [{ id: 'b', number: 'R-2', dueDate: '2026-11-01', openCents: 100 }, { id: 'a', number: 'R-1', dueDate: '2026-11-01', openCents: 100 }]).shares).toEqual([{ id: 'a', amountCents: 100 }]));
test('0 € → keine Anteile', () => expect(distributeInOrder(0, [{ id: 'x', capCents: 5 }])).toEqual({ shares: [], restCents: 0 }));
test('der Reihe nach, Ziele mit Deckel 0 bekommen keinen Anteil', () =>
  expect(distributeInOrder(500, [{ id: 'a', capCents: 0 }, { id: 'b', capCents: 300 }, { id: 'c', capCents: 100 }])).toEqual({ shares: [{ id: 'b', amountCents: 300 }, { id: 'c', amountCents: 100 }], restCents: 100 }));
