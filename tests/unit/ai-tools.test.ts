import { describe, expect, it } from 'vitest';
import { createStateTools } from '@/ai/tools';
import { refresh } from '@/data/store';
import { createDemoState } from '@/data/seed';
import { overdueMembers } from '@/data/selectors';
import { todayBerlin } from '@/domain/clock';
import { NOW_0930 as NOW, inv, sptx, stateWith } from './helpers';

const s = refresh(createDemoState(), NOW);
const tools = createStateTools(s, NOW);

describe('createStateTools', () => {
  it('overdue_members liefert Namen und Beträge wie overdueMembers', async () => {
    const r = await tools.call('overdue_members', {});
    const expected = overdueMembers(s, todayBerlin(NOW));
    expect(expected.length).toBeGreaterThan(0);
    expect(r.members.map((m) => [m.name, m.arrearsCents, m.contractId])).toEqual(expected.map((m) => [m.name, m.arrearsCents, m.contractId]));
  });
  it('series_calls und find_job liefern null ohne Treffer', async () => {
    expect((await tools.call('series_calls', { query: 'xyz' })).series).toBeNull();
    expect((await tools.call('find_job', { query: 'xyz' })).contact).toBeNull();
  });
});

describe('month_money Zulassung', () => {
  it('offen über invoiceOpenCents, Fälligkeit im Monat', async () => {
    const z600 = inv('i-z6', 60000, { dueDate: '2026-11-20' });
    const later = inv('i-z7', 9000, { dueDate: '2026-12-20' });
    const st = stateWith({
      invoices: [z600, later], payments: [sptx({ amountCents: 42000 })],
      allocations: [{ paymentId: 'sp1', invoiceId: 'i-z6', amountCents: 42000, method: 'confirmed' }],
    });
    const r = await createStateTools(st, NOW).call('month_money', {});
    expect(r.zulassungOpenCents).toBe(18000);
    expect(r.zulassungOpenCount).toBe(1);
  });
  it('voll zugeordnete Rechnung fällt heraus', async () => {
    const z600 = inv('i-z6', 60000, { dueDate: '2026-11-20' });
    const st = stateWith({
      invoices: [z600], payments: [sptx({ amountCents: 60000 })],
      allocations: [{ paymentId: 'sp1', invoiceId: 'i-z6', amountCents: 60000, method: 'confirmed' }],
    });
    const r = await createStateTools(st, NOW).call('month_money', {});
    expect(r).toMatchObject({ zulassungOpenCents: 0, zulassungOpenCount: 0 });
  });
});
