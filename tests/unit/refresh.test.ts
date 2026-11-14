import { describe, expect, it } from 'vitest';
import { createReloadGate, createWriteTracker, pullBlocked, pullProgress, PULL_THRESHOLD, type PullNode } from '@/data/refresh';
import { UnauthorizedError, createRealClient } from '@/data/real-client';

describe('createReloadGate (höchstens alle 10 s)', () => {
  it('lässt den ersten Aufruf durch, blockiert den zweiten binnen 10 s, danach wieder frei', () => {
    let t = 1_000_000;
    const gate = createReloadGate(10_000, () => t);
    expect(gate()).toBe(true);
    t += 9_999;
    expect(gate()).toBe(false);
    t += 1;
    expect(gate()).toBe(true);
  });
  it('ein blockierter Aufruf verlängert die Sperre nicht', () => {
    let t = 0;
    const gate = createReloadGate(10_000, () => t);
    gate();
    t = 5_000;
    gate();
    t = 10_000;
    expect(gate()).toBe(true);
  });
});

describe('pullProgress', () => {
  it('nur nach unten und überwiegend senkrecht', () => {
    expect(pullProgress(0, 100)).toBeGreaterThan(0);
    expect(pullProgress(0, -50)).toBe(0);
    expect(pullProgress(100, 100)).toBe(0); // eher waagerecht: Wisch-Aktion, kein Ziehen
  });
  it('erreicht 1 ab der Schwelle (gedämpft)', () => {
    expect(pullProgress(0, PULL_THRESHOLD * 2)).toBeGreaterThanOrEqual(1);
    expect(pullProgress(0, PULL_THRESHOLD / 2)).toBeLessThan(1);
  });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('RealClient.syncNow', () => {
  it('liefert den Zustand', async () => {
    const c = createRealClient((async () => json(200, { state: { x: 1 } })) as unknown as typeof fetch);
    expect(await c.syncNow()).toEqual({ ok: true, state: { x: 1 } });
  });
  it('429 → wait mit Meldung', async () => {
    const c = createRealClient((async () => json(429, { error: 'Bitte kurz warten' })) as unknown as typeof fetch);
    expect(await c.syncNow()).toEqual({ ok: false, reason: 'wait' });
  });
  it('401 → UnauthorizedError', async () => {
    const c = createRealClient((async () => json(401, {})) as unknown as typeof fetch);
    await expect(c.syncNow()).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('createWriteTracker', () => {
  it('Laden ohne Zwischenfall wird übernommen', () => {
    const w = createWriteTracker();
    expect(w.canApply(w.snapshot())).toBe(true);
  });
  it('Schreibzugriff während des Ladens (auch abgeschlossen) verwirft das Ergebnis', () => {
    const w = createWriteTracker();
    const snap = w.snapshot();
    w.begin();
    expect(w.canApply(snap)).toBe(false);
    w.end();
    expect(w.canApply(snap)).toBe(false);
    expect(w.canApply(w.snapshot())).toBe(true);
  });
  it('bump (KI-Antwort, Abgleich) verwirft ein laufendes Laden', () => {
    const w = createWriteTracker();
    const snap = w.snapshot();
    w.bump();
    expect(w.canApply(snap)).toBe(false);
  });
  it('laufender Schreibzugriff blockiert, pending ist sichtbar', () => {
    const w = createWriteTracker();
    w.begin();
    expect(w.pending).toBe(1);
    expect(w.canApply(w.snapshot())).toBe(false);
  });
});

const node = (o: Partial<{ tag: string; scrollTop: number; attrs: Record<string, string>; parent: PullNode | null }> = {}): PullNode => ({
  parentElement: o.parent ?? null, scrollTop: o.scrollTop ?? 0, tagName: o.tag ?? 'DIV',
  getAttribute: (n) => o.attrs?.[n] ?? null, hasAttribute: (n) => !!o.attrs && n in o.attrs,
});

describe('pullBlocked', () => {
  it('freier Bereich: nicht blockiert', () => expect(pullBlocked(node({ parent: node() }))).toBe(false));
  it('gescrollter Vorfahr blockiert', () => expect(pullBlocked(node({ parent: node({ scrollTop: 40 }) }))).toBe(true));
  it('Dialog und data-no-pull blockieren', () => {
    expect(pullBlocked(node({ parent: node({ attrs: { role: 'dialog' } }) }))).toBe(true);
    expect(pullBlocked(node({ attrs: { 'data-no-pull': '' } }))).toBe(true);
  });
  it('Eingabefelder blockieren', () => expect(pullBlocked(node({ tag: 'TEXTAREA' }))).toBe(true));
});

describe('refresh (Engine): Erinnerungsentwürfe', () => {
  it('refresh legt Erinnerungsentwürfe an', async () => {
    const { refresh } = await import('@/data/engine');
    const { base, stateWith } = await import('./helpers');
    const lena = { id: 'm-lena', company: 'nexus' as const, kind: 'member' as const, name: 'Lena Kaya', phones: [], emails: ['lena@example.de'] };
    const s = stateWith({ contacts: [lena], contracts: [{ ...base, id: 'c1', contactId: 'm-lena' }] });
    const r = refresh(s, new Date('2026-11-28T08:00:00Z'), false);
    const a = r.actions.find((x) => x.id === 'upcoming-c1-2026-12-01')!;
    expect(a).toMatchObject({ type: 'send_reminder', status: 'draft' });
    expect(a.payload.text).toBe('Hallo Lena, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig.');
    expect(refresh(r, new Date('2026-11-28T09:00:00Z'), false).actions.filter((x) => x.id === a.id)).toHaveLength(1);
  });
});
