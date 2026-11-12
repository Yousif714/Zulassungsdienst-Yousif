import { describe, expect, it } from 'vitest';
import { demoAI, demoPaymentLink } from '@/ai/demo-ai';
import { refresh } from '@/data/store';
import { createDemoState } from '@/data/seed';
import { nexusForecast, overdueMembers } from '@/data/selectors';
import { todayBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import { NOW_0930 } from './helpers';

const s = refresh(createDemoState(), NOW_0930);
const today = todayBerlin(NOW_0930);
const ask = (q: string) => demoAI.answer(q, s, NOW_0930);

describe('DemoAI', () => {
  it('überfällig', async () => {
    const a = await ask('Wer ist bei NEXUS überfällig?');
    const list = overdueMembers(s, today);
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) {
      expect(a.text).toContain(m.name);
      expect(a.links.map((l) => l.href)).toContain(`/nexus/mitglieder/${m.contractId}`);
    }
  });
  it('heute offen', async () => {
    const a = await ask('Was ist heute noch offen?');
    expect(a.text).toMatch(/\d+ Hinweise/);
    expect(a.links.length).toBeGreaterThan(0);
  });
  it('SEELE', async () => {
    expect((await ask('Was fehlt für SEELE?')).text).toContain('0/10');
  });
  it('Auftrag + Kontakt', async () => {
    const a = await ask('Was ist mit dem Auftrag von Autohaus Schmidt?');
    const hrefs = a.links.map((l) => l.href);
    expect(hrefs).toContain('/zulassung/auftraege/j-schmidt-1');
    expect(hrefs).toContain('/nachrichten/t-schmidt');
    expect(a.text).toContain('wartet');
    expect(a.text).toMatch(/Std\./);
  });
  it('Geld im Monat', async () => {
    const a = await ask('Wie viel Geld kommt diesen Monat noch rein?');
    expect(a.text).toContain(formatEuro(nexusForecast(s, today).expectedCents));
    expect(a.links.map((l) => l.href)).toEqual(['/nexus', '/zulassung']);
  });
  it('Fallback', async () => {
    expect((await ask('Wie wird das Wetter?')).links).toEqual([]);
  });
  it('slidesFor', async () => {
    const call = s.calls.find((c) => c.id === 'call-seele')!;
    const sl = await demoAI.slidesFor(call);
    expect(sl).toHaveLength(10);
    expect(sl[2].title).toMatch(/^Folie 3: /);
    expect(sl[0].body).toContain('\n');
    expect(await demoAI.slidesFor(call)).toEqual(sl);
  });
  it('detectCommitment', () => {
    expect(demoAI.detectCommitment('Die Rechnung schicke ich Ihnen morgen.', '2026-11-10T10:00:00Z')).toEqual({ kind: 'invoice', dueAt: '2026-11-11T17:00:00.000Z' });
    expect(demoAI.detectCommitment('Ich schicke die Rechnung heute.', '2026-11-10T10:00:00Z')?.dueAt).toBe('2026-11-10T17:00:00.000Z');
    expect(demoAI.detectCommitment('Ich melde mich.', '2026-11-10T10:00:00Z')).toEqual({ kind: 'callback', dueAt: '2026-11-12T10:00:00.000Z' });
    expect(demoAI.detectCommitment('Danke, bis dann', '2026-11-10T10:00:00Z')).toBeNull();
  });
  it('Entwürfe', async () => {
    const kaya = s.contacts.find((c) => c.id === 'm-kaya')!;
    const mc = s.contracts.find((c) => c.contactId === kaya.id)!;
    const link = demoPaymentLink(mc.id);
    const st = { traffic: 'red', arrearsCents: 15000 } as never;
    for (const tone of ['freundlich', 'bestimmt'] as const) {
      const t = await demoAI.draftReminder(kaya, st, tone, link);
      expect(t).toContain(link);
      expect(t).toContain(formatEuro(15000));
    }
    const thread = s.messages.filter((m) => m.threadId === 't-schmidt');
    const r = await demoAI.draftReply(thread, s.contacts.find((c) => c.id === 'd-schmidt')!);
    expect(r).toContain('Autohaus Schmidt');
    expect(r).toContain('GE-AS 123');
  });
});
