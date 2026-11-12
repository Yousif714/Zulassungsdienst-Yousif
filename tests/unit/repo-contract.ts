import { describe, it, expect } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { diffState } from '@/server/db/tables';
import type { Repos, StoredPasskey } from '@/server/db/repository';

const pk = (id: string): StoredPasskey => ({ id, publicKey: 'pk', counter: 0, transports: ['internal'], createdAt: '2026-11-12T10:00:00Z' });
const AT = new Date('2026-11-12T10:00:00Z');

export function repositoryContract(name: string, make: () => Promise<Repos>): void {
  describe(`Repository-Vertrag: ${name}`, () => {
    it('leeres Repo lädt den Leerzustand mit Revision 0', async () => {
      const { state } = await make();
      const r = await state.load();
      expect(r.revision).toBe(0);
      expect(r.state).toEqual(createEmptyState());
    });

    it('save mit richtiger Revision erhöht, mit alter ergibt conflict ohne Schreiben', async () => {
      const { state } = await make();
      const base = (await state.load()).state;
      const next = { ...base, settings: { ...base.settings, ownerPhone: '+49123' } };
      const ok = await state.save(diffState(base, next), 0);
      expect(ok).toEqual({ ok: true, revision: 1 });
      const stale = { ...base, settings: { ...base.settings, ownerPhone: '+49999' } };
      const bad = await state.save(diffState(base, stale), 0);
      expect(bad).toEqual({ ok: false, reason: 'conflict' });
      const r = await state.load();
      expect(r.revision).toBe(1);
      expect(r.state.settings.ownerPhone).toBe('+49123');
    });

    it('load liefert Klone', async () => {
      const { state } = await make();
      const a = await state.load();
      a.state.settings.ownerPhone = 'mutiert';
      expect((await state.load()).state.settings.ownerPhone).toBe('');
    });

    it('claimJobRun: bei 10 parallelen Aufrufen genau ein true', async () => {
      const { state } = await make();
      const res = await Promise.all(Array.from({ length: 10 }, () => state.claimJobRun('k', AT)));
      expect(res.filter(Boolean)).toHaveLength(1);
      expect(await state.recentJobRuns(AT)).toEqual(['k']);
    });

    it('recentJobRuns: nur Läufe ab dem Stichtag; load liest keine Laufschlüssel', async () => {
      const { state } = await make();
      const day = 24 * 3_600_000;
      expect(await state.claimJobRun('alt', new Date(AT.getTime() - 10 * day))).toBe(true);
      expect(await state.claimJobRun('neu', AT)).toBe(true);
      expect(await state.recentJobRuns(new Date(AT.getTime() - 8 * day))).toEqual(['neu']);
      expect((await state.recentJobRuns(new Date(AT.getTime() - 11 * day))).sort()).toEqual(['alt', 'neu']);
      // Auch ein alter Schlüssel bleibt beansprucht.
      expect(await state.claimJobRun('alt', AT)).toBe(false);
      expect('jobRuns' in (await state.load()).state).toBe(false);
    });

    it('addFirstPasskey: bei zwei parallelen Aufrufen genau ein true', async () => {
      const { auth } = await make();
      const res = await Promise.all([auth.addFirstPasskey(pk('a')), auth.addFirstPasskey(pk('b'))]);
      expect(res.filter(Boolean)).toHaveLength(1);
      expect(await auth.passkeyCount()).toBe(1);
    });

    it('Passkeys: hinzufügen, Zähler aktualisieren', async () => {
      const { auth } = await make();
      await auth.addPasskey(pk('a'));
      await auth.updateCounter('a', 7);
      const l = await auth.listPasskeys();
      expect(l).toHaveLength(1);
      expect(l[0].counter).toBe(7);
      l[0].counter = 99;
      expect((await auth.listPasskeys())[0].counter).toBe(7);
    });

    it('consumeRecoveryCode: genau einmal true', async () => {
      const { auth } = await make();
      await auth.replaceRecoveryCodes(['h1', 'h2']);
      expect(await auth.consumeRecoveryCode('h1', AT)).toBe(true);
      expect(await auth.consumeRecoveryCode('h1', AT)).toBe(false);
      expect(await auth.consumeRecoveryCode('unbekannt', AT)).toBe(false);
    });

    it('consumeRecoveryCode parallel: genau ein true', async () => {
      const { auth } = await make();
      await auth.replaceRecoveryCodes(['h1']);
      const res = await Promise.all(Array.from({ length: 5 }, () => auth.consumeRecoveryCode('h1', AT)));
      expect(res.filter(Boolean)).toHaveLength(1);
    });

    it('replaceRecoveryCodes macht alte Codes ungültig', async () => {
      const { auth } = await make();
      await auth.replaceRecoveryCodes(['old']);
      await auth.replaceRecoveryCodes(['new']);
      expect(await auth.consumeRecoveryCode('old', AT)).toBe(false);
      expect(await auth.consumeRecoveryCode('new', AT)).toBe(true);
    });

    it('Reihenfolge von Chat und Allocations bleibt über mehrere Saves stabil', async () => {
      const { state } = await make();
      let cur = (await state.load()).state;
      let rev = 0;
      const step = async (next: typeof cur) => {
        const r = await state.save(diffState(cur, next), rev);
        expect(r.ok).toBe(true);
        if (r.ok) rev = r.revision;
        cur = (await state.load()).state;
      };
      const m = (id: string) => ({ id, text: id }) as never;
      const al = (amountCents: number) => ({ paymentId: 'p1', contractId: 'c1', amountCents, method: 'manual' as const });
      await step({ ...cur, assistantChat: [m('m1'), m('m2')] });
      await step({ ...cur, assistantChat: [...cur.assistantChat, m('m3')], allocations: [al(100), al(200)] });
      const expected = structuredClone(cur);
      expect(cur.assistantChat.map((x) => x.id)).toEqual(['m1', 'm2', 'm3']);
      expect(cur.allocations.map((x) => x.amountCents)).toEqual([100, 200]);
      await step({ ...cur, settings: { ...cur.settings, ownerPhone: '+49' } });
      expect(cur).toEqual({ ...expected, settings: { ...expected.settings, ownerPhone: '+49' } });
      expect(cur.allocations).toHaveLength(2);
    });

    it('save löscht Zeilen', async () => {
      const { state } = await make();
      const base = (await state.load()).state;
      const m = (id: string) => ({ id, text: id }) as never;
      const withMsgs = { ...base, assistantChat: [m('a'), m('b')] };
      expect(await state.save(diffState(base, withMsgs), 0)).toEqual({ ok: true, revision: 1 });
      const without = { ...base, assistantChat: [m('a')] };
      expect(await state.save(diffState(withMsgs, without), 1)).toEqual({ ok: true, revision: 2 });
      expect((await state.load()).state.assistantChat.map((x) => x.id)).toEqual(['a']);
    });
  });
}
