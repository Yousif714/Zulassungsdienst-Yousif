import { expect, test } from 'vitest';

import { isMembership, parseMembership } from '@/domain/import/membership';

test.each([
  ['NEXUS-Mitgliedschaft 6 Monate', { months: 6, dueDay: null }],
  ['Nexus Mitgliedschaft – 12 Monate, fällig jeweils zum 15. des Monats', { months: 12, dueDay: 15 }],
  ['MITGLIED-SCHAFT NEXUS', { months: null, dueDay: null }],
  ['12-Monats-Mitgliedschaft', { months: 12, dueDay: null }],
])('%s', (text, want) => expect(parseMembership(text)).toEqual(want));
test('ohne Mitgliedschaft → null', () => expect(parseMembership('Workshop 6 Monate')).toBeNull());
test('Fälligkeitstag außerhalb 1–31 → null', () => expect(parseMembership('Mitgliedschaft zum 40. des Monats')?.dueDay).toBeNull());
test('isMembership', () => {
  expect(isMembership('Coaching Einzelstunde')).toBe(false);
  expect(isMembership('nexus mitgliedschaft')).toBe(true);
});
