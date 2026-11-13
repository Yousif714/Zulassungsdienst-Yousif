import { expect, test } from 'vitest';

import { connectionSubtitle, statementStandText } from '@/components/connection-labels';
import { HOW_TO } from '@/domain/connections';
import { ageText } from '@/domain/freshness';
import type { Connection } from '@/domain/types';

const C: Connection = { id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS', status: 'connected', lastSuccessAt: null };
const at = new Date('2026-11-12T10:00:00Z');

test('verbunden', () => expect(connectionSubtitle({ ...C, status: 'connected', lastSuccessAt: '2026-11-12T09:57:00Z' }, at)).toBe('Verbunden · Stand vor 3 Min.'));
test('Störung im Klartext', () => expect(connectionSubtitle({ ...C, status: 'error', lastSuccessAt: '2026-11-12T09:10:00Z', lastError: 'Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen)' }, at)).toBe('Störung: Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen) · Stand vor 50 Min.'));
test('fehlt → Anleitung', () => expect(connectionSubtitle({ ...C, status: 'missing', lastSuccessAt: null }, at)).toBe(HOW_TO.stripe_nexus));
test('Störung ohne Stand', () => expect(connectionSubtitle({ ...C, status: 'error', lastSuccessAt: null }, at)).toBe('Störung · noch nie abgerufen'));
test('verbunden, Stand älter als eine Stunde → Datum', () => expect(connectionSubtitle({ ...C, status: 'connected', lastSuccessAt: '2026-11-01T09:00:00Z' }, at)).toBe('Verbunden · Stand vom 01.11.2026, 10:00 Uhr'));
test('verbunden mit Teil-Störung zeigt den Hinweis', () => expect(connectionSubtitle({ ...C, status: 'connected', lastSuccessAt: '2026-11-12T09:57:00Z', lastError: 'Auftragsbestätigungen: Lexware: HTTP 400 bei /v1/voucherlist' }, at)).toBe('Verbunden · Stand vor 3 Min. · Hinweis: Auftragsbestätigungen: Lexware: HTTP 400 bei /v1/voucherlist'));

const R = { lastReadAt: '2026-11-12T09:00:00Z', monthCostMicroCents: 42_000_000, monthCostCents: 42, limitMicroCents: 10_000_000_000, limitReached: false, lastError: null };
const CL: Connection = { id: 'claude_invoices', company: 'nexus', label: 'Claude (Rechnungen lesen)', status: 'connected', lastSuccessAt: '2026-11-12T09:00:00Z' };
test('Claude-Zeile zeigt Kosten und Limit', () => {
  expect(connectionSubtitle(CL, at, R)).toBe(`Verbunden · ${ageText(CL, at)} · Kosten diesen Monat: 0,42 $ von 100 € (1 $ als 1 € gerechnet)`);
});
test('Limit erreicht wird genannt', () => {
  expect(connectionSubtitle({ ...CL, lastError: 'Monatslimit erreicht' }, at, { ...R, limitReached: true })).toContain('Limit erreicht');
});
test('Claude ohne Schlüssel → Anleitung', () => expect(connectionSubtitle({ ...CL, status: 'missing', lastSuccessAt: null }, at, R)).toBe(HOW_TO.claude_invoices));

const NOW_0930 = new Date('2026-11-12T09:30:00+01:00');
const conn = (p: Partial<Connection>): Connection => ({ ...C, ...p });
const spk = (p: Partial<Connection>) => conn({ id: 'bank_sparkasse', company: 'zulassung', label: 'Sparkasse', status: 'connected', ...p });
test('Sparkasse: noch kein Auszug', () => expect(statementStandText(spk({ status: 'missing', lastSuccessAt: null }), NOW_0930)).toBe('Noch kein Auszug'));
test('Sparkasse: Auszug bis, hochgeladen vor 2 Tagen', () =>
  expect(statementStandText(spk({ lastSuccessAt: '2026-11-10T09:00:00Z', sync: { cursor: '2026-11-09', complete: true, failures: 0 } }), NOW_0930)).toBe('Auszug bis 09.11. · hochgeladen vor 2 Tagen'));
test('Sparkasse: hochgeladen heute und gestern (Berliner Kalendertag)', () => {
  const sync = { cursor: '2026-11-11', complete: true, failures: 0 };
  expect(statementStandText(spk({ lastSuccessAt: '2026-11-11T23:30:00Z', sync }), NOW_0930)).toBe('Auszug bis 11.11. · hochgeladen heute');
  expect(statementStandText(spk({ lastSuccessAt: '2026-11-11T22:30:00Z', sync }), NOW_0930)).toBe('Auszug bis 11.11. · hochgeladen gestern');
});
test('Sparkasse im Echtmodus statt Anleitung', () => expect(connectionSubtitle(spk({ status: 'missing', lastSuccessAt: null }), NOW_0930)).toBe('Noch kein Auszug'));
test('Sparkasse im Echtmodus mit Auszug', () =>
  expect(connectionSubtitle(spk({ lastSuccessAt: '2026-11-12T08:00:00Z', sync: { cursor: '2026-11-11', complete: true, failures: 0 } }), NOW_0930)).toBe('Auszug bis 11.11. · hochgeladen heute'));
