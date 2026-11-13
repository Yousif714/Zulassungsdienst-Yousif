import { describe, expect, it } from 'vitest';
import { createReloadGate, pullProgress, PULL_THRESHOLD } from '@/data/refresh';
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
