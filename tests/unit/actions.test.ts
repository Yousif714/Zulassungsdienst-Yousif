import { describe, expect, test } from 'vitest';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { approve, editDraft, finishExecution, idempotencyKey, reconcileUncertain, retry, startExecution } from '@/domain/actions/machine';
import type { Action } from '@/domain/types';
import { NOW_0930 as NOW } from './helpers';

const draft = (): Action => ({ id: 'a1', type: 'send_whatsapp', company: 'zulassung', title: 'Nachricht', payload: { text: 'hi' }, version: 1, status: 'draft', createdAt: '2026-11-12T07:00:00Z', isDemo: true });
const approved = (): Action => (approve(draft(), { version: 1, via: 'app' }, NOW) as { ok: true; action: Action }).action;

describe('Aktionen-Zustandsmaschine', () => {
  const d = draft();
  test('Bearbeiten erhöht Version', () => expect(editDraft(d, { text: 'neu' }).version).toBe(2));
  test('Freigabe', () => {
    const r = approve(d, { version: 1, via: 'app' }, NOW);
    expect(r.ok).toBe(true);
    const a = (r as { action: Action }).action;
    expect(a.status).toBe('approved');
    expect(a.approvedVia).toBe('app');
    expect(a.approvedAt).toBe(NOW.toISOString());
  });
  test('doppelt tippen', () => {
    expect(approve(approved(), { version: 1, via: 'app' }, NOW)).toEqual({ ok: false, reason: 'already_approved' });
  });
  test('nicht Entwurf', () => {
    expect(approve({ ...d, status: 'cancelled' }, { version: 1, via: 'app' }, NOW)).toEqual({ ok: false, reason: 'not_draft' });
  });
  test('alter Knopf nach Änderung', () =>
    expect(approve(editDraft(d, { text: 'x' }), { version: 1, via: 'whatsapp', buttonIssuedAt: '2026-11-12T08:00:00Z' }, NOW)).toEqual({ ok: false, reason: 'stale_version' }));
  test('Knopf älter als 24 Std.', () =>
    expect(approve(d, { version: 1, via: 'whatsapp', buttonIssuedAt: '2026-11-11T07:00:00Z' }, NOW)).toEqual({ ok: false, reason: 'expired' }));
  test('Timeout → ausgang unklar, kein Retry ohne Abgleich', () => {
    const u = finishExecution(startExecution(approved()), 'timeout', NOW);
    expect(u.status).toBe('uncertain');
    expect(() => retry(u)).toThrow('Ungültiger Übergang: uncertain → approved');
    expect(reconcileUncertain(u, true, NOW).status).toBe('executed');
    expect(reconcileUncertain(u, false, NOW).status).toBe('failed');
  });
  test('Fehler → Retry', () => {
    const f = finishExecution(startExecution(approved()), 'error', NOW, 'x');
    expect(f.status).toBe('failed');
    expect(f.error).toBe('x');
    const r = retry(f);
    expect(r.status).toBe('approved');
    expect(r.error).toBeUndefined();
  });
  test('ok → executed', () => {
    const e = finishExecution(startExecution(approved()), 'ok', NOW);
    expect(e.status).toBe('executed');
    expect(e.executedAt).toBe(NOW.toISOString());
  });
  test('ungültiger Übergang', () => expect(() => startExecution(draft())).toThrow('Ungültiger Übergang: draft → executing'));
  test('Schlüssel', () => expect(idempotencyKey(d)).toBe('a1:1'));
  test('DemoProvider idempotent', async () => {
    const p = new DemoProvider();
    const a = approved();
    expect(await p.execute(a, 'k')).toBe('ok');
    expect(await p.lookup('k')).toBe(true);
    expect(await p.lookup('z')).toBe(false);
    expect(p.executedCount('k')).toBe(1);
    await p.execute(a, 'k');
    expect(p.executedCount('k')).toBe(1);
  });

  describe('Schutzregeln', () => {
    const wa = (issued?: string) => ({ version: 1, via: 'whatsapp' as const, buttonIssuedAt: issued });
    test.each([
      ['fehlend', undefined],
      ['Müll', 'garbage'],
      ['Zukunft', '2026-11-12T09:00:00Z'],
    ])('WhatsApp-Knopf mit Zeitstempel %s → expired', (_n, ts) => {
      expect(approve(draft(), wa(ts), NOW)).toEqual({ ok: false, reason: 'expired' });
    });
    test('gültiger Knopf', () => expect(approve(draft(), wa('2026-11-12T08:00:00Z'), NOW).ok).toBe(true));
    test.each(['approved', 'executing', 'executed'] as const)('approve bei %s → already_approved', (st) => {
      expect(approve({ ...draft(), status: st }, { version: 1, via: 'app' }, NOW)).toEqual({ ok: false, reason: 'already_approved' });
    });
    test('Vorrang already_approved vor expired', () => {
      expect(approve({ ...draft(), status: 'executed' }, wa('2026-11-01T00:00:00Z'), NOW)).toEqual({ ok: false, reason: 'already_approved' });
    });
    test('Vorrang expired vor stale_version', () => {
      expect(approve({ ...draft(), version: 3 }, wa('2026-11-01T00:00:00Z'), NOW)).toEqual({ ok: false, reason: 'expired' });
    });
    const all = ['draft', 'approved', 'executing', 'executed', 'failed', 'uncertain', 'cancelled'] as const;
    const without = (ok: string) => all.filter((x) => x !== ok);
    test.each(without('approved'))('startExecution aus %s wirft', (st) => expect(() => startExecution({ ...draft(), status: st })).toThrow('Ungültiger Übergang'));
    test.each(without('executing'))('finishExecution aus %s wirft', (st) => expect(() => finishExecution({ ...draft(), status: st }, 'ok', NOW)).toThrow('Ungültiger Übergang'));
    test.each(without('failed'))('retry aus %s wirft', (st) => expect(() => retry({ ...draft(), status: st })).toThrow('Ungültiger Übergang'));
    test.each(without('uncertain'))('reconcileUncertain aus %s wirft', (st) => expect(() => reconcileUncertain({ ...draft(), status: st }, true, NOW)).toThrow('Ungültiger Übergang'));
  });
});
