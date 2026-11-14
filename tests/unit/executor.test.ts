import { describe, expect, test } from 'vitest';
import { applyEvent, refresh, type EngineContext } from '@/data/engine';
import { checkAction, executeApproved, sweepStaleExecutions, type EventSink } from '@/data/executor';
import { createDemoState } from '@/data/seed';
import { STALE_EXECUTING_MS, type ActionProvider } from '@/domain/actions/machine';
import { DemoProvider } from '@/domain/actions/demo-provider';
import type { StoreEvent } from '@/domain/events';
import type { Action } from '@/domain/types';
import { NOW_0930 as NOW } from './helpers';

// Ohne automatisch angelegte Erinnerungsentwürfe: die Tests prüfen nur ihre eigenen Aktionen.
const base = { ...refresh(createDemoState(), NOW), actions: [] as Action[] };
const action = (p: Partial<Action> = {}): Action => ({
  id: 'a-1', type: 'send_whatsapp', company: 'zulassung', title: 'Antwort an Autohaus Schmidt',
  payload: { contactId: 'd-schmidt', threadId: 't-schmidt', channel: 'whatsapp', text: 'Ja, der Golf ist ab 14 Uhr fertig.' },
  version: 1, status: 'draft', createdAt: NOW.toISOString(), isDemo: true, ...p,
});

function makeSink(isDemo = true, at: () => Date = () => NOW) {
  let state = base;
  let n = 0;
  const sink: EventSink & { events: StoreEvent[] } = {
    events: [],
    current: () => state,
    async apply(e) {
      sink.events.push(e);
      const ctx: EngineContext = { at: at(), isDemo, newId: () => `id-${++n}` };
      state = applyEvent(state, e, ctx).state;
      return state;
    },
  };
  return sink;
}
async function approved(sink: ReturnType<typeof makeSink>, a: Action = action()) {
  await sink.apply({ type: 'createAction', action: a });
  await sink.apply({ type: 'approveAction', id: a.id, version: a.version, via: 'app' });
}
const status = (s: EventSink) => s.current().actions[0].status;

/** Anbieter mit steuerbarem Ergebnis. */
class StubProvider implements ActionProvider {
  readonly simulated = true;
  executed = 0;
  lookups = 0;
  constructor(private result: 'ok' | 'error' | 'timeout' | 'throw' | 'hang', private found = false) {}
  async execute(): Promise<'ok' | 'error' | 'timeout'> {
    this.executed++;
    if (this.result === 'throw') throw new Error('Verbindung abgebrochen');
    if (this.result === 'hang') return new Promise(() => {});
    return this.result;
  }
  async lookup() { this.lookups++; return this.found; }
}

describe('Ausführer', () => {
  test('freigegebene Aktion wird genau einmal mit aktion:version ausgeführt', async () => {
    const sink = makeSink(); await approved(sink);
    const p = new DemoProvider();
    await executeApproved(sink, p); await executeApproved(sink, p);
    expect(p.executedCount('a-1:1')).toBe(1);
    expect(status(sink)).toBe('executed');
  });

  test('gleichzeitige Läufe führen nur einmal aus', async () => {
    const sink = makeSink(); await approved(sink);
    const p = new DemoProvider();
    await Promise.all([executeApproved(sink, p), executeApproved(sink, p)]);
    expect(p.executedCount('a-1:1')).toBe(1);
  });

  test('Timeout → uncertain, Prüfen mit Treffer → executed, ohne zweiten execute', async () => {
    const sink = makeSink(); await approved(sink);
    const p = new StubProvider('timeout', true);
    await executeApproved(sink, p);
    expect(status(sink)).toBe('uncertain');
    await executeApproved(sink, p);
    expect(p.executed).toBe(1);
    await checkAction(sink, p, 'a-1');
    expect(status(sink)).toBe('executed');
    expect(p.executed).toBe(1);
    expect(p.lookups).toBe(1);
  });

  test('hängender Anbieter → nach Zeitlimit uncertain', async () => {
    const sink = makeSink(); await approved(sink);
    await executeApproved(sink, new StubProvider('hang'), 20);
    expect(status(sink)).toBe('uncertain');
  });

  test('Ausnahme im Anbieter → failed mit Meldung', async () => {
    const sink = makeSink(); await approved(sink);
    await executeApproved(sink, new StubProvider('throw'));
    expect(sink.current().actions[0]).toMatchObject({ status: 'failed', error: 'Verbindung abgebrochen' });
  });

  test('Prüfen ohne Treffer → failed, Erneut versuchen → approved → executed', async () => {
    const sink = makeSink(); await approved(sink);
    const bad = new StubProvider('timeout', false);
    await executeApproved(sink, bad);
    await checkAction(sink, bad, 'a-1');
    expect(status(sink)).toBe('failed');
    await sink.apply({ type: 'retryAction', id: 'a-1' });
    expect(status(sink)).toBe('approved');
    const p = new DemoProvider();
    await executeApproved(sink, p);
    expect(status(sink)).toBe('executed');
    expect(p.executedCount('a-1:1')).toBe(1);
  });

  test('Prüfen auf eine nicht-uncertain Aktion ändert nichts', async () => {
    const sink = makeSink(); await approved(sink);
    const p = new StubProvider('ok', true);
    await checkAction(sink, p, 'a-1');
    expect(status(sink)).toBe('approved');
    await executeApproved(sink, p);
    const before = sink.current();
    await checkAction(sink, p, 'a-1');
    expect(sink.current()).toBe(before);
    expect(p.lookups).toBe(0);
    await sink.apply({ type: 'retryAction', id: 'a-1' });
    expect(status(sink)).toBe('executed');
  });

  test('executing älter als 5 Min. → uncertain (sweep), jünger → unverändert', async () => {
    const sink = makeSink(); await approved(sink);
    await sink.apply({ type: 'actionStarted', id: 'a-1' });
    expect(sink.current().actions[0].executingSince).toBe(NOW.toISOString());
    await sweepStaleExecutions(sink, new Date(NOW.getTime() + STALE_EXECUTING_MS - 1000));
    expect(status(sink)).toBe('executing');
    await sweepStaleExecutions(sink, new Date(NOW.getTime() + STALE_EXECUTING_MS + 1000));
    expect(status(sink)).toBe('uncertain');
    expect(sink.current().actions[0].executingSince).toBeUndefined();
  });

  test('simulierter Versand im Echtmodus legt keine ausgehende Nachricht an, Protokoll „Nicht gesendet (Demo-Ausführer)“', async () => {
    const sink = makeSink(false); await approved(sink);
    const n = sink.current().messages.length;
    await executeApproved(sink, new DemoProvider());
    expect(sink.current().messages).toHaveLength(n);
    expect(status(sink)).toBe('executed');
    expect(sink.current().audit.at(-1)).toMatchObject({ text: 'Nicht gesendet (Demo-Ausführer): Antwort an Autohaus Schmidt', isDemo: false });
  });

  test('simulierter Versand im Demo-Modus verhält sich wie Phase 1', async () => {
    const sink = makeSink(true); await approved(sink);
    await executeApproved(sink, new DemoProvider());
    expect(sink.current().messages.at(-1)).toMatchObject({ direction: 'out', body: 'Ja, der Golf ist ab 14 Uhr fertig.' });
    expect(sink.current().audit.some((a) => a.text.startsWith('Gesendet (Demo):'))).toBe(true);
  });

  test('Prüfen mit Treffer im Echtmodus legt bei simuliertem Anbieter ebenfalls keine Nachricht an', async () => {
    const sink = makeSink(false); await approved(sink);
    const n = sink.current().messages.length;
    const p = new StubProvider('timeout', true);
    await executeApproved(sink, p); await checkAction(sink, p, 'a-1');
    expect(status(sink)).toBe('executed');
    expect(sink.current().messages).toHaveLength(n);
  });

  test('interne Aktion (link_invoice_to_job) wirkt auch simuliert im Echtmodus', async () => {
    const sink = makeSink(false);
    await approved(sink, action({ type: 'link_invoice_to_job', payload: { jobId: 'j-mueller-1', invoiceId: 'i-z-311' } }));
    await executeApproved(sink, new DemoProvider());
    expect(sink.current().jobs.find((j) => j.id === 'j-mueller-1')!.invoiceIds).toContain('i-z-311');
  });
});

describe('Ergebnisdaten (output) des Anbieters', () => {
  test('output des Anbieters landet im Ereignis actionExecuted', async () => {
    const provider: ActionProvider = {
      simulated: false,
      execute: async () => ({ result: 'ok' as const, output: { stripeCustomerId: 'cus_test_1' } }),
      lookup: async () => false,
    };
    const sink = makeSink();
    await approved(sink);
    await executeApproved(sink, provider);
    const ev = sink.events.find((e) => e.type === 'actionExecuted');
    expect(ev).toMatchObject({ type: 'actionExecuted', id: 'a-1', result: 'ok', output: { stripeCustomerId: 'cus_test_1' } });
    expect(status(sink)).toBe('executed');
  });

  test('einfaches Ergebnis ohne output bleibt unverändert (kein output-Feld)', async () => {
    const sink = makeSink();
    await approved(sink);
    await executeApproved(sink, new DemoProvider());
    const ev = sink.events.find((e) => e.type === 'actionExecuted') as Record<string, unknown>;
    expect(ev.result).toBe('ok');
    expect('output' in ev).toBe(false);
  });

  test('checkAction reicht output aus lookup weiter und übergibt die Aktion', async () => {
    let seen: Action | undefined;
    const provider: ActionProvider = {
      simulated: false,
      execute: async () => 'timeout',
      lookup: async (_key, a) => { seen = a; return { output: { stripeScheduleId: 'sub_sched_test_1' } }; },
    };
    const sink = makeSink();
    await approved(sink);
    await executeApproved(sink, provider);
    expect(status(sink)).toBe('uncertain');
    await checkAction(sink, provider, 'a-1');
    expect(seen?.id).toBe('a-1');
    expect(sink.events.find((e) => e.type === 'actionReconciled')).toMatchObject({ found: true, output: { stripeScheduleId: 'sub_sched_test_1' } });
    expect(status(sink)).toBe('executed');
  });

  test('checkAction mit lookup false: found false, kein output', async () => {
    const provider: ActionProvider = { simulated: false, execute: async () => 'timeout', lookup: async () => false };
    const sink = makeSink();
    await approved(sink);
    await executeApproved(sink, provider);
    await checkAction(sink, provider, 'a-1');
    const ev = sink.events.find((e) => e.type === 'actionReconciled') as Record<string, unknown>;
    expect(ev.found).toBe(false);
    expect('output' in ev).toBe(false);
  });
});
