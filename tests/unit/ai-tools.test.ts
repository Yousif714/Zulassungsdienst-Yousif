import { describe, expect, it } from 'vitest';
import { createStateTools } from '@/ai/tools';
import { refresh } from '@/data/store';
import { createDemoState } from '@/data/seed';
import { overdueMembers } from '@/data/selectors';
import { todayBerlin } from '@/domain/clock';
import { NOW_0930 as NOW } from './helpers';

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
