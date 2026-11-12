import { describe, expect, test } from 'vitest';
import { CLIENT_EVENTS, dispatchEvents, isClientEvent, loadState } from '@/server/state-service';
import { createMemoryRepos } from '@/server/db/memory';
import { diffState } from '@/server/db/tables';
import type { Repos, StateRepository } from '@/server/db/repository';
import type { ActionProvider } from '@/domain/actions/machine';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { Action } from '@/domain/types';
import { NOW_0930 as NOW } from './helpers';
import { createDemoState } from '@/data/seed';
import { emptyBatch } from '@/domain/import/batch';

const draft = (p: Partial<Action> = {}): Action => ({
  id: 'a-1', type: 'create_calendar_event', company: 'zulassung', title: 'Termin anlegen',
  payload: {}, version: 1, status: 'draft', createdAt: NOW.toISOString(), isDemo: false, ...p,
});
const deps = (provider: ActionProvider = new DemoProvider()) => ({ at: () => NOW, provider });

async function withDraft(repos: Repos = createMemoryRepos(), a: Action = draft()) {
  await dispatchEvents(repos, [{ type: 'createAction', action: a }], deps());
  return repos;
}

/** Zählt jeden Aufruf (DemoProvider zählt pro Schlüssel nur einmal). Wartet kurz, damit parallele Aufrufe sich überlappen. */
class CountingProvider implements ActionProvider {
  readonly simulated = true;
  calls: string[] = [];
  async execute(_a: Action, key: string): Promise<'ok'> {
    this.calls.push(key);
    await new Promise((r) => setTimeout(r, 5));
    return 'ok';
  }
  async lookup(key: string) { return this.calls.includes(key); }
}

/** Repo, in dem vor dem n-ten `save` ein zweites Gerät dazwischen speichert. */
function interleaved(repos: Repos, before: number[], other: (s: Awaited<ReturnType<StateRepository['load']>>) => Promise<void>): Repos {
  let n = 0;
  return {
    ...repos,
    state: {
      ...repos.state,
      async save(changes, rev) {
        n += 1;
        if (before.includes(n)) await other(await repos.state.load());
        return repos.state.save(changes, rev);
      },
    },
  };
}

describe('Zustands-Dienst', () => {
  test('approveAction auf gespeicherten Entwurf → ausgeführt, gespeichert, Protokoll isDemo:false', async () => {
    const repos = await withDraft();
    const p = new DemoProvider();
    const r = await dispatchEvents(repos, [{ type: 'approveAction', id: 'a-1', version: 1, via: 'app' }], deps(p));
    expect(r.state.actions.find((a) => a.id === 'a-1')?.status).toBe('executed');
    expect(p.executedCount('a-1:1')).toBe(1);
    const stored = await loadState(repos, NOW);
    expect(stored.actions.find((a) => a.id === 'a-1')?.status).toBe('executed');
    expect(stored.audit.length).toBeGreaterThan(0);
    expect(stored.audit.every((x) => x.isDemo === false)).toBe(true);
  });

  test('Hinweis, der erst beim Abgleich entsteht, lässt sich per dispatchEvents erledigen', async () => {
    const repos = createMemoryRepos();
    const { state, revision } = await repos.state.load();
    // Gespeicherter Stand ohne Hinweise: sie entstehen erst durch refresh (wie zwischen zwei Sync-Läufen).
    expect((await repos.state.save(diffState(state, { ...createDemoState(), insights: [] }), revision)).ok).toBe(true);
    const shown = (await loadState(repos, NOW)).insights.find((i) => i.status === 'open' && !i.dedupeKey.startsWith('reply:'));
    expect(shown).toBeDefined();
    const r = await dispatchEvents(repos, [{ type: 'dismissInsight', key: shown!.dedupeKey }], deps());
    expect(r.state.insights.find((i) => i.dedupeKey === shown!.dedupeKey)?.status).toBe('dismissed');
    expect((await loadState(repos, NOW)).insights.find((i) => i.dedupeKey === shown!.dedupeKey)?.status).toBe('dismissed');
  });

  test('Konflikt durch zweites Gerät → neu laden, erneut anwenden, beide Änderungen bleiben', async () => {
    const base = await withDraft();
    const repos = interleaved(base, [1], async ({ state, revision }) => {
      // Gerät 2 ändert die Einstellungen und speichert zuerst.
      const next = { ...state, settings: { ...state.settings, replyThresholdHours: 7 } };
      const res = await base.state.save(diffState(state, next), revision);
      expect(res.ok).toBe(true);
    });
    const r = await dispatchEvents(repos, [{ type: 'editAction', id: 'a-1', payload: { note: 'Gerät 1' } }], deps());
    expect(r.state.actions.find((a) => a.id === 'a-1')?.payload).toEqual({ note: 'Gerät 1' });
    const stored = await loadState(base, NOW);
    expect(stored.actions.find((a) => a.id === 'a-1')?.payload).toEqual({ note: 'Gerät 1' });
    expect(stored.settings.replyThresholdHours).toBe(7);
  });

  test('dauerhafter Konflikt → Error("conflict") nach 3 Versuchen', async () => {
    const base = await withDraft();
    let saves = 0;
    const repos: Repos = { ...base, state: { ...base.state, async save() { saves += 1; return { ok: false, reason: 'conflict' }; } } };
    await expect(dispatchEvents(repos, [{ type: 'editAction', id: 'a-1', payload: { x: 1 } }], deps())).rejects.toThrow('conflict');
    expect(saves).toBe(3);
  });

  test('zwei parallele Dispatches führen dieselbe Aktion genau einmal aus', async () => {
    const repos = await withDraft();
    const p = new CountingProvider();
    const approve = { type: 'approveAction' as const, id: 'a-1', version: 1, via: 'app' as const };
    await Promise.all([dispatchEvents(repos, [approve], deps(p)), dispatchEvents(repos, [approve], deps(p))]);
    expect(p.calls.filter((k) => k === 'a-1:1')).toHaveLength(1);
    expect((await loadState(repos, NOW)).actions.find((a) => a.id === 'a-1')?.status).toBe('executed');
  });

  test('Ausführung nur nach eigenem Start: anderer Start beim Konflikt → kein zweiter Aufruf', async () => {
    const base = await withDraft();
    await dispatchEvents(base, [{ type: 'approveAction', id: 'a-1', version: 1, via: 'app' }], deps(new CountingProvider()));
    // Neuer Entwurf a-2, freigegeben; vor dem Speichern von actionStarted startet ein anderes Gerät a-2.
    await dispatchEvents(base, [{ type: 'createAction', action: draft({ id: 'a-2' }) }], deps());
    const p = new CountingProvider();
    const repos = interleaved(base, [2], async ({ state, revision }) => {
      const next = { ...state, actions: state.actions.map((a) => (a.id === 'a-2' ? { ...a, status: 'executing' as const, executingSince: NOW.toISOString() } : a)) };
      await base.state.save(diffState(state, next), revision);
    });
    await dispatchEvents(repos, [{ type: 'approveAction', id: 'a-2', version: 1, via: 'app' }], deps(p));
    expect(p.calls).toEqual([]);
  });

  test('checkAction fragt den Anbieter bei unklarem Ausgang', async () => {
    const repos = await withDraft(createMemoryRepos(), draft({ status: 'uncertain', approvedAt: NOW.toISOString() }));
    const p = new CountingProvider();
    p.calls.push('a-1:1');
    const r = await dispatchEvents(repos, [{ type: 'checkAction', id: 'a-1' }], deps(p));
    expect(r.state.actions.find((a) => a.id === 'a-1')?.status).toBe('executed');
  });

  test('isClientEvent: nur erlaubte Ereignisse mit Grundform', () => {
    expect(CLIENT_EVENTS.size).toBe(14);
    expect(isClientEvent({ type: 'approveAction', id: 'a-1', version: 1, via: 'app' })).toBe(true);
    expect(isClientEvent({ type: 'dismissInsight', key: 'reply:m-1' })).toBe(true);
    for (const type of ['actionExecuted', 'actionStarted', 'actionReconciled', 'resetDemo', 'simulateTransfer', 'setConnectionStatus', 'assistantInbound', 'assistantOutbound', 'assistantButton', 'unbekannt']) {
      expect(isClientEvent({ type, id: 'a-1', result: 'ok', found: true }), type).toBe(false);
    }
    for (const v of [null, undefined, 'approveAction', 42, [], [{ type: 'approveAction' }]]) expect(isClientEvent(v)).toBe(false);
    expect(isClientEvent({ type: 'approveAction', id: 7, version: 1, via: 'app' })).toBe(false);
    expect(isClientEvent({ type: 'settleInvoice', invoiceId: 'i-1' })).toBe(false);
    expect(isClientEvent({ type: 'createAction', action: null })).toBe(false);
    expect(isClientEvent({ type: 'createAction', action: draft() })).toBe(true);
    expect(isClientEvent({ type: 'createAction', action: draft({ status: 'approved' }) })).toBe(false);
  });

  test('updateSettings: nur bekannte Schlüssel mit passendem Typ', () => {
    const ok = (patch: unknown) => isClientEvent({ type: 'updateSettings', patch });
    expect(ok({ replyThresholdHours: 4, briefingsEnabled: false, ownerPhone: '+491701234567', suppressedCoachKeys: ['a', 'b'] })).toBe(true);
    expect(ok({})).toBe(true);
    expect(ok({ suppressedCoachKeys: 42 })).toBe(false);
    expect(ok({ suppressedCoachKeys: ['a', 3] })).toBe(false);
    expect(ok({ replyThresholdHours: '4' })).toBe(false);
    expect(ok({ replyThresholdHours: Number.NaN })).toBe(false);
    expect(ok({ replyThresholdHours: 0 })).toBe(false);
    expect(ok({ replyThresholdHours: 1000 })).toBe(false);
    expect(ok({ briefingsEnabled: 'ja' })).toBe(false);
    expect(ok({ ownerPhone: 491701234567 })).toBe(false);
    expect(ok({ unbekannt: 1 })).toBe(false);
    expect(ok([])).toBe(false);
  });

  test('createAction: strenge Form, nur echte Entwürfe', () => {
    const ok = (action: unknown) => isClientEvent({ type: 'createAction', action });
    expect(ok(draft({ company: null }))).toBe(true);
    expect(ok({ ...draft(), type: 'delete_everything' })).toBe(false);
    expect(ok({ ...draft(), title: '' })).toBe(false);
    expect(ok({ ...draft(), title: undefined })).toBe(false);
    expect(ok({ ...draft(), company: 'fremd' })).toBe(false);
    expect(ok({ ...draft(), createdAt: 5 })).toBe(false);
    expect(ok({ ...draft(), version: 0 })).toBe(false);
    expect(ok({ ...draft(), version: 1.5 })).toBe(false);
    expect(ok(draft({ isDemo: true }))).toBe(false);
    expect(ok(draft({ approvedVia: 'app' }))).toBe(false);
    expect(ok(draft({ approvedAt: NOW.toISOString() }))).toBe(false);
    expect(ok(draft({ executedAt: NOW.toISOString() }))).toBe(false);
    expect(ok(draft({ executingSince: NOW.toISOString() }))).toBe(false);
    expect(ok(draft({ error: 'x' }))).toBe(false);
    expect(ok(draft({ insightKey: 'reply:m-1' }))).toBe(true);
    expect(ok(draft({ insightKey: 3 as unknown as string }))).toBe(false);
  });

  test('approveAction nur über die App, ohne Knopf-Zeitstempel', () => {
    expect(isClientEvent({ type: 'approveAction', id: 'a-1', version: 1, via: 'whatsapp', buttonIssuedAt: NOW.toISOString() })).toBe(false);
    expect(isClientEvent({ type: 'approveAction', id: 'a-1', version: 1, via: 'app', buttonIssuedAt: NOW.toISOString() })).toBe(false);
    expect(isClientEvent({ type: 'approveAction', id: 'a-1', version: 0, via: 'app' })).toBe(false);
  });

  test('setJobStatus und setSlides: Werte aus den Aufzählungen, Folien mit Form', () => {
    expect(isClientEvent({ type: 'setJobStatus', jobId: 'j-1', status: 'done' })).toBe(true);
    expect(isClientEvent({ type: 'setJobStatus', jobId: 'j-1', status: 'gelöscht' })).toBe(false);
    const slides = [{ position: 1, title: 'Titel', body: 'Text' }];
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', slides, status: 'draft' })).toBe(true);
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', slides: [], status: 'reviewed' })).toBe(true);
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', slides, status: 'fertig' })).toBe(false);
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', status: 'draft' })).toBe(false);
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', slides: [{ position: '1', title: 'T', body: 'B' }], status: 'draft' })).toBe(false);
    expect(isClientEvent({ type: 'setSlides', callId: 'c-1', slides: [{ position: 1, title: 'T' }], status: 'draft' })).toBe(false);
  });
  test.each(['importBatch', 'syncFailed'])('%s ist kein Client-Ereignis', (type) => {
    expect(isClientEvent({ type, connectionId: 'stripe_nexus', batch: emptyBatch(), error: 'x', cursor: null, complete: true })).toBe(false);
  });
});
