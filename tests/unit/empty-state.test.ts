import { afterEach, describe, expect, test } from 'vitest';
import { demoAI } from '@/ai/demo-ai';
import { createStateTools } from '@/ai/tools';
import { createEmptyState } from '@/data/empty-state';
import { refresh } from '@/data/engine';
import { handleInbound } from '@/domain/assistant';
import { setClockMode, setNowForTests } from '@/domain/clock';
import { notConnected } from '@/domain/connections';
import { validPhone } from '@/domain/matching/messages';
import { NOW_0930 as NOW } from './helpers';

afterEach(() => { setClockMode('demo'); setNowForTests(null); });

describe('leerer Startzustand', () => {
  test('alle Verbindungen fehlen, Listen leer', () => {
    const e = createEmptyState();
    expect(e.connections.length).toBe(10);
    expect(e.connections.every((c) => c.status === 'missing' && c.lastSuccessAt === null)).toBe(true);
    expect(e.contacts).toEqual([]);
    expect(e.exceptions).toEqual({});
    expect(e.settings).toEqual({ replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] });
  });
  test('refresh wirft nicht und erzeugt keine Geld-Hinweise', () => {
    const r = refresh(createEmptyState(), NOW, false);
    expect(r.insights.every((i) => i.type === 'stale_source')).toBe(true);
  });
  test('leere Nummer: validPhone null, handleInbound ignoriert jede Nummer', async () => {
    expect(validPhone('')).toBeNull();
    const e = createEmptyState();
    const r = await handleInbound(e, '+491510000000', 'Hallo', NOW, demoAI, createStateTools(e, NOW));
    expect(r.reply).toBeNull();
  });
  test('notConnected', () => {
    const e = createEmptyState();
    expect(notConnected(['bank', 'stripe_nexus'], e.connections)).toBe(true);
    const cs = e.connections.map((c) => (c.id === 'bank' ? { ...c, status: 'error' as const } : c));
    expect(notConnected(['bank', 'stripe_nexus'], cs)).toBe(false);
  });
});
