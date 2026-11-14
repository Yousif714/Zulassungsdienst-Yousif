import { describe, expect, test } from 'vitest';
import { CLIENT_EVENTS, dispatchEvents, isClientEvent, loadState } from '@/server/state-service';
import { createMemoryRepos } from '@/server/db/memory';
import { diffState } from '@/server/db/tables';
import type { Repos, StateRepository } from '@/server/db/repository';
import type { ActionProvider } from '@/domain/actions/machine';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { Action } from '@/domain/types';
import { addDaysIso, realNow, todayBerlin } from '@/domain/clock';
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

  const validSpk = { company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming', externalId: 'spk-0123456789abcdef', amountCents: 64000, bookedOn: '2026-11-03', payerName: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000001', reference: 'RE-Z-2026-290' };
  const today = todayBerlin(realNow());
  const spkEvent = (payments: unknown[], statementTo: unknown = today) => ({ type: 'importBankStatement', connectionId: 'bank_sparkasse', payments, statementTo });
  test.each([
    [{}, true], [{ company: 'nexus' }, false], [{ amountCents: 0 }, false], [{ amountCents: 1.5 }, false], [{ amountCents: 100_000_000_01 }, false],
    [{ bookedOn: '12.11.2026' }, false], [{ bookedOn: '2026-13-45' }, false], [{ bookedOn: '9999-99-99' }, false], [{ bookedOn: '2026-02-31' }, false],
    [{ bookedOn: '2026-05-31' }, false], [{ bookedOn: '2026-06-01' }, true], [{ bookedOn: today }, true], [{ bookedOn: addDaysIso(today, 1) }, true], [{ bookedOn: addDaysIso(today, 2) }, false], [{ externalId: 'abc' }, false], [{ reference: 'x'.repeat(501) }, false], [{ connectionId: 'bank_qonto' }, false],
    [{ source: 'stripe' }, false], [{ kind: 'stripe_payout' }, false], [{ payerName: 'x'.repeat(201) }, false], [{ iban: 'D'.repeat(35) }, false],
  ])('importBankStatement Zahlung %j erlaubt: %s', (patch, ok) => expect(isClientEvent(spkEvent([{ ...validSpk, ...patch }]))).toBe(ok));
  test.each([
    [today, true], [addDaysIso(today, 1), true], [addDaysIso(today, 2), false], ['2026-05-31', false], ['2026-06-01', true], ['2026-02-31', false], ['12.11.2026', false], [null, false], [20261112, false],
  ])('importBankStatement statementTo %j erlaubt: %s', (to, ok) => expect(isClientEvent(spkEvent([validSpk], to))).toBe(ok));
  test('importBankStatement: 0 Zahlungen mit statementTo erlaubt, 5001 abgelehnt, 5000 erlaubt', () => {
    expect(isClientEvent(spkEvent([]))).toBe(true);
    expect(isClientEvent(spkEvent([], null))).toBe(false);
    expect(isClientEvent(spkEvent(Array.from({ length: 5001 }, () => validSpk)))).toBe(false);
    expect(isClientEvent(spkEvent(Array.from({ length: 5000 }, () => validSpk)))).toBe(true);
    expect(isClientEvent({ ...spkEvent([validSpk]), connectionId: 'bank_qonto' })).toBe(false);
  });

  test.each([[{ paymentId: 'p', contractId: 'c' }, true], [{ paymentId: 'p', invoiceId: 'i' }, true], [{ paymentId: 'p', contractId: 'c', invoiceId: 'i' }, false], [{ paymentId: 'p' }, false],
    [{ paymentId: 'p', invoiceIds: ['a', 'b'] }, true], [{ paymentId: 'p', invoiceIds: [] }, false], [{ paymentId: 'p', invoiceIds: ['a', 'a'] }, false], [{ paymentId: 'p', invoiceId: 'a', invoiceIds: ['b'] }, false],
    [{ paymentId: 'p', invoiceIds: Array.from({ length: 51 }, (_, i) => `i${i}`) }, false], [{ paymentId: 'p', invoiceIds: ['a', 1] }, false]])(
    'confirmPaymentMatch %j erlaubt: %s', (e, ok) => expect(isClientEvent({ type: 'confirmPaymentMatch', ...e })).toBe(ok));
  test('dismissPayment erlaubt', () => {
    expect(isClientEvent({ type: 'dismissPayment', paymentId: 'p' })).toBe(true);
    expect(isClientEvent({ type: 'dismissPayment' })).toBe(false);
  });

  test('Review 5: importPortalList nur mit gültiger Form', () => {
    expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'a@b.de', name: 'A' }] })).toBe(true);
    expect(isClientEvent({ type: 'importPortalList', entries: [] })).toBe(false);
    expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'kaputt', name: 'A' }] })).toBe(false);
    expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'a@b.de' }] })).toBe(false);
    expect(isClientEvent({ type: 'importPortalList', entries: Array.from({ length: 2001 }, (_, i) => ({ email: `u${i}@x.de`, name: '' })) })).toBe(false);
  });

  test('importPortalList: Zusatzfelder streng geprüft', () => {
    const ok = (extra: object) => isClientEvent({ type: 'importPortalList', entries: [{ email: 'a@b.de', name: 'A', ...extra }] });
    expect(ok({ emails: ['a@b.de', 'c@b.de'], joinedOn: '2026-08-01', joinedText: 'x', lastActiveOn: null, lastActiveText: 'y' })).toBe(true);
    for (const bad of [
      { emails: [1] }, { emails: 'a@b.de' }, { emails: [] }, { emails: ['c@b.de'] }, { emails: ['a@b.de', 'kaputt'] },
      { emails: Array.from({ length: 11 }, (_, i) => (i ? `u${i}@b.de` : 'a@b.de')) },
      { joinedOn: {} }, { joinedOn: '1.8.2026' }, { lastActiveOn: 5 }, { joinedText: 'x'.repeat(101) }, { lastActiveText: 7 },
      { name: 'x'.repeat(201) },
    ]) expect(ok(bad), JSON.stringify(bad).slice(0, 40)).toBe(false);
  });

  test('Portal-Events: Form geprüft', () => {
    const draft = { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-10-01', catchUpMode: 'first_rate' };
    expect(isClientEvent({ type: 'ignorePortalMember', externalId: 'a@b.de' })).toBe(true);
    expect(isClientEvent({ type: 'ignorePortalMember' })).toBe(false);
    expect(isClientEvent({ type: 'unignorePortalMember', externalId: 'a@b.de' })).toBe(true);
    expect(isClientEvent({ type: 'unignorePortalMember' })).toBe(false);
    expect(isClientEvent({ type: 'createPortalContract', externalId: 'a@b.de', draft, contactId: null })).toBe(true);
    expect(isClientEvent({ type: 'createPortalContract', externalId: 'a@b.de', draft: { ...draft, dueDay: 'x' }, contactId: null })).toBe(false);
  });

  test('isClientEvent: nur erlaubte Ereignisse mit Grundform', () => {
    expect(CLIENT_EVENTS.size).toBe(30);
    expect(isClientEvent({ type: 'approveAction', id: 'a-1', version: 1, via: 'app' })).toBe(true);
    expect(isClientEvent({ type: 'dismissInsight', key: 'reply:m-1' })).toBe(true);
    for (const type of ['actionExecuted', 'actionStarted', 'actionReconciled', 'resetDemo', 'simulateTransfer', 'importBatch', 'syncFailed', 'setConnectionStatus', 'assistantInbound', 'assistantOutbound', 'assistantButton', 'unbekannt']) {
      expect(isClientEvent({ type, id: 'a-1', result: 'ok', found: true }), type).toBe(false);
    }
    for (const v of [null, undefined, 'approveAction', 42, [], [{ type: 'approveAction' }]]) expect(isClientEvent(v)).toBe(false);
    expect(isClientEvent({ type: 'approveAction', id: 7, version: 1, via: 'app' })).toBe(false);
    expect(isClientEvent({ type: 'settleInvoice', invoiceId: 'i-1' })).toBe(false);
    expect(isClientEvent({ type: 'createAction', action: null })).toBe(false);
    expect(isClientEvent({ type: 'createAction', action: draft() })).toBe(true);
    expect(isClientEvent({ type: 'createAction', action: draft({ status: 'approved' }) })).toBe(false);
  });

  test('confirmProposal/dismissProposal sind Client-Ereignisse mit Formprüfung', () => {
    const draftA = { totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01', catchUpMode: 'first_rate' };
    expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: draftA, contactId: null })).toBe(true);
    expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: { ...draftA, installments: 1.5 }, contactId: null })).toBe(false);
    expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: { ...draftA, startDate: '1.9.2026' }, contactId: null })).toBe(false);
    expect(isClientEvent({ type: 'dismissProposal', proposalId: 'p' })).toBe(true);
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
    expect(ok({ takeoverReminderDays: 5 })).toBe(true);
    expect(ok({ takeoverReminderDays: 0 })).toBe(false);
    expect(ok({ takeoverReminderDays: 15 })).toBe(false);
    expect(ok({ takeoverReminderDays: 2.5 })).toBe(false);
    expect(ok({ takeoverLinkNudgeDays: 30 })).toBe(true);
    expect(ok({ takeoverLinkNudgeDays: 31 })).toBe(false);
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

  test('createAction mit stripe_takeover wird vom Server abgelehnt', () => {
    expect(isClientEvent({ type: 'createAction', action: draft() })).toBe(true);
    expect(isClientEvent({ type: 'createAction', action: { ...draft(), type: 'stripe_takeover' } })).toBe(false);
  });

  test('Umstellungs-Ereignisse: Client-Form geprüft, Einrichtung nur vom Server', () => {
    expect(isClientEvent({ type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' })).toBe(true);
    expect(isClientEvent({ type: 'prepareTakeover', contractId: 'c1', mode: 'spread' })).toBe(true);
    expect(isClientEvent({ type: 'prepareTakeover', contractId: 'c1', mode: 'alles' })).toBe(false);
    expect(isClientEvent({ type: 'prepareTakeover', contractId: '', mode: 'spread' })).toBe(false);
    expect(isClientEvent({ type: 'prepareAllTakeovers' })).toBe(true);
    expect(isClientEvent({ type: 'withdrawTakeover', contractId: 'c1' })).toBe(true);
    expect(isClientEvent({ type: 'withdrawTakeover' })).toBe(false);
    expect(isClientEvent({ type: 'simulateTakeoverSetUp', contractId: 'c1' })).toBe(true);
    expect(isClientEvent({ type: 'simulateTakeoverSetUp' })).toBe(false);
    const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a-${i}`, version: 1 }));
    expect(isClientEvent({ type: 'approveActions', items: items(1) })).toBe(true);
    expect(isClientEvent({ type: 'approveActions', items: items(100) })).toBe(true);
    expect(isClientEvent({ type: 'approveActions', items: items(101) })).toBe(false);
    expect(isClientEvent({ type: 'approveActions', items: [] })).toBe(false);
    expect(isClientEvent({ type: 'approveActions', items: [{ id: 'a-1', version: 0 }] })).toBe(false);
    expect(isClientEvent({ type: 'approveActions', items: [{ id: '', version: 1 }] })).toBe(false);
    expect(isClientEvent({ type: 'approveActions', items: 'a-1' })).toBe(false);
    expect(isClientEvent({ type: 'takeoverSetUp', takeoverId: 't', scheduleId: 'sub_sched_test_1', paymentMethodId: 'pm_test_1' })).toBe(false);
    expect(isClientEvent({ type: 'takeoverPlanChanged', takeoverId: 't', paymentMethodId: 'pm_test_1' })).toBe(false);
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

test('Lesungs-Ereignisse: invoicesRead nur Server, Vertrags-Knöpfe vom Client', () => {
  expect(isClientEvent({ type: 'invoicesRead', readings: [] })).toBe(false);
  expect(isClientEvent({ type: 'confirmReadContract', contractId: 'k1' })).toBe(true);
  expect(isClientEvent({ type: 'deleteReadContract', contractId: 'k1' })).toBe(true);
  expect(isClientEvent({ type: 'correctContract', contractId: 'k1', draft: { totalCents: 1000, installments: 1, installmentCents: 1000, dueDay: 1, startDate: '2026-10-01', catchUpMode: 'first_rate' } })).toBe(true);
  expect(isClientEvent({ type: 'correctContract', contractId: 'k1', draft: { totalCents: 'x' } })).toBe(false);
});
