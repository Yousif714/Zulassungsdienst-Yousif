import { describe, expect, test } from 'vitest';
import { extractPlates, extractVins, matchMessage, normalizePhone, openReplies } from '@/domain/matching/messages';
import { NOW_0930, contacts, jobs, msg, vehicles } from '../helpers';

test('Telefon', () => {
  expect(normalizePhone('0151 234 567')).toBe('+49151234567');
  expect(normalizePhone('0049 151-234/567')).toBe('+49151234567');
  expect(normalizePhone('+49 (151) 234567')).toBe('+49151234567');
});
test('Kennzeichen/FIN', () => {
  expect(extractPlates('Ist der Golf GE-AS 123 fertig?')).toEqual(['GE-AS 123']);
  expect(extractPlates('BOT MK 456 und GE-AS 123E')).toEqual(['BOT-MK 456', 'GE-AS 123E']);
  expect(extractVins('FIN WVWZZZ1KZAW123456 bitte')).toEqual(['WVWZZZ1KZAW123456']);
});
describe('matchMessage', () => {
  test('Telefon', () => expect(matchMessage({ direction: 'in', from: '+49209111222', to: '', body: 'Hallo' }, contacts, vehicles, jobs).contactId).toBe('d-schmidt'));
  test('ausgehend nutzt to', () => expect(matchMessage({ direction: 'out', from: '+49', to: '0209 111222', body: 'Hi' }, contacts, vehicles, jobs).contactId).toBe('d-schmidt'));
  test('Kennzeichen', () => expect(matchMessage({ direction: 'in', from: '+49000', to: '', body: 'Wegen BOT-MK 456' }, contacts, vehicles, jobs)).toEqual({ contactId: 'd-mueller', jobId: 'j-mueller-1' }));
  test('FIN', () => expect(matchMessage({ direction: 'in', from: '+49000', to: '', body: 'FIN WVWZZZ1KZAW123456' }, contacts, vehicles, jobs)).toEqual({ contactId: 'd-mueller', jobId: 'j-mueller-1' }));
  test('Kennzeichen klein', () => expect(matchMessage({ direction: 'in', from: '+49000', to: '', body: 'ist der golf bot-mk 456 fertig?' }, contacts, vehicles, jobs)).toEqual({ contactId: 'd-mueller', jobId: 'j-mueller-1' }));
  test('FIN klein', () => expect(matchMessage({ direction: 'in', from: '+49000', to: '', body: 'fin wvwzzz1kzaw123456' }, contacts, vehicles, jobs)).toEqual({ contactId: 'd-mueller', jobId: 'j-mueller-1' }));
  test('Fließtext ist kein Kennzeichen', () => {
    for (const body of ['Wir haben ab 12 Uhr geöffnet', 'bis ab 12 Uhr'])
      expect(matchMessage({ direction: 'in', from: '+49000', to: '', body }, contacts, vehicles, jobs)).toEqual({ contactId: null, jobId: null });
  });
  test('17 Buchstaben ohne Ziffer keine FIN', () => expect(extractVins('ABCDEFGHJKLMNPRST')).toEqual([]));
  test('nichts', () => expect(matchMessage({ direction: 'in', from: '+49000', to: '', body: 'Hallo' }, contacts, vehicles, jobs)).toEqual({ contactId: null, jobId: null }));
});
describe('Antwortpflicht', () => {
  const inMsg = msg({ id: 'a', threadId: 't1', direction: 'in', needsReply: true, sentAt: '2026-11-12T05:30:00Z' });
  test('offen', () => expect(openReplies([inMsg], NOW_0930, 2)).toEqual([{ message: inMsg, waitingHours: 3 }]));
  test('beantwortet', () => expect(openReplies([inMsg, msg({ id: 'b', threadId: 't1', direction: 'out', sentAt: '2026-11-12T06:00:00Z' })], NOW_0930, 2)).toEqual([]));
  test('anderer Thread schließt nicht', () => expect(openReplies([inMsg, msg({ id: 'b', threadId: 't2', direction: 'out', sentAt: '2026-11-12T06:00:00Z', to: inMsg.from })], NOW_0930, 2)).toHaveLength(1));
  test('anderer Kanal schließt nicht', () => expect(openReplies([inMsg, msg({ id: 'b', channel: 'email', direction: 'out', sentAt: '2026-11-12T06:00:00Z' })], NOW_0930, 2)).toHaveLength(1));
  test('Antwort davor schließt nicht', () => expect(openReplies([inMsg, msg({ id: 'b', direction: 'out', sentAt: '2026-11-12T05:00:00Z' })], NOW_0930, 2)).toHaveLength(1));
  test('unter Schwelle', () => expect(openReplies([inMsg], new Date('2026-11-12T06:30:00Z'), 2)).toEqual([]));
  test('manuell erledigt', () => expect(openReplies([{ ...inMsg, doneManually: true }], NOW_0930, 2)).toEqual([]));
});
