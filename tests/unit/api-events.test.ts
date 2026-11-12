import { beforeEach, describe, expect, it, vi } from 'vitest';

let session = false;
vi.mock('@/server/auth/session', () => ({ requireSession: async () => session }));

import { createDemoState } from '@/data/seed';
import { refresh } from '@/data/engine';
import { realNow, todayBerlin } from '@/domain/clock';
import { memberView } from '@/domain/detectors';
import { diffState } from '@/server/db/tables';
import { getRepos, resetTestRepos } from '@/server/registry';
import { GET as getState } from '@/app/api/state/route';
import { POST as postEvents } from '@/app/api/events/route';
import { askAI, draftReplyFor, sendToAssistant } from '@/app/actions/ai';

const post = (body: unknown) => new Request('http://x/api/events', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

/** Memory-Repo mit den Demo-Daten füllen, damit es echte Hinweise und Nachrichten gibt. */
async function seed() {
  const repo = getRepos().state;
  const { state, revision } = await repo.load();
  const r = await repo.save(diffState(state, refresh(createDemoState(), realNow(), false)), revision);
  if (!r.ok) throw new Error('seed');
}

beforeEach(async () => {
  session = true;
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  resetTestRepos();
  await seed();
});

describe('GET /api/state', () => {
  it('ohne Sitzung 401', async () => {
    session = false;
    expect((await getState()).status).toBe(401);
  });
  it('liefert den Zustand', async () => {
    const r = await getState();
    expect(r.status).toBe(200);
    const body = (await r.json()) as { state: { contacts: unknown[] } };
    expect(body.state.contacts.length).toBeGreaterThan(0);
    // Laufschlüssel des Cron sind reine Server-Buchhaltung und gehen nicht an den Browser.
    expect('jobRuns' in body.state).toBe(false);
  });
});

describe('POST /api/events', () => {
  it('ohne Sitzung 401', async () => {
    session = false;
    expect((await postEvents(post({ event: { type: 'dismissInsight', key: 'x' } }))).status).toBe(401);
  });
  it('Server-Ereignis (resetDemo) → 400', async () => {
    expect((await postEvents(post({ event: { type: 'resetDemo' } }))).status).toBe(400);
  });
  it('Body ohne event → 400', async () => {
    expect((await postEvents(post({}))).status).toBe(400);
  });
  it('kaputtes JSON → 400', async () => {
    expect((await postEvents(post('{nope'))).status).toBe(400);
  });
  it('gültiges dismissInsight → 200, Revision +1', async () => {
    const before = await getRepos().state.load();
    const key = before.state.insights.find((i) => i.status === 'open')!.dedupeKey;
    const r = await postEvents(post({ event: { type: 'dismissInsight', key } }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { state: { insights: { dedupeKey: string; status: string }[] }; created: string[] };
    expect(body.created).toEqual([]);
    expect(body.state.insights.find((i) => i.dedupeKey === key)!.status).toBe('dismissed');
    expect((await getRepos().state.load()).revision).toBe(before.revision + 1);
  });
  it('Konflikt → 409', async () => {
    const repos = getRepos();
    vi.spyOn(repos.state, 'save').mockResolvedValue({ ok: false, reason: 'conflict' });
    const key = (await repos.state.load()).state.insights.find((i) => i.status === 'open')!.dedupeKey;
    expect((await postEvents(post({ event: { type: 'dismissInsight', key } }))).status).toBe(409);
  });
});

describe('KI-Server-Actions', () => {
  it('ohne Sitzung: „Nicht angemeldet“', async () => {
    session = false;
    await expect(askAI('Was ist heute noch offen?')).rejects.toThrow('Nicht angemeldet');
    await expect(draftReplyFor('t-schmidt')).rejects.toThrow('Nicht angemeldet');
    await expect(sendToAssistant('Hallo')).rejects.toThrow('Nicht angemeldet');
  });
  it('askAI antwortet aus dem gespeicherten Zustand', async () => {
    const a = await askAI('Was ist heute noch offen?');
    expect(a.text.length).toBeGreaterThan(0);
  });
  it('sendToAssistant speichert Eingang und Antwort mit der Inhaber-Nummer', async () => {
    const { state } = await sendToAssistant('Was ist heute noch offen?');
    expect(state.assistantChat.map((m) => m.direction)).toEqual(['from_owner', 'to_owner']);
    expect((await getRepos().state.load()).state.assistantChat).toHaveLength(2);
  });
  it('sendToAssistant im leeren Echtstart (ohne Inhaber-Nummer) antwortet statt zu ignorieren', async () => {
    resetTestRepos(); // leerer Zustand, ownerPhone ''
    expect((await getRepos().state.load()).state.settings.ownerPhone).toBe('');
    const { state } = await sendToAssistant('Was ist heute noch offen?');
    expect(state.assistantChat.map((m) => m.direction)).toEqual(['from_owner', 'to_owner']);
    expect(state.audit.some((a) => a.text.includes('fremder Nummer'))).toBe(false);
  });
  it('sendToAssistant: Erinnerungsentwurf ist kein Demo-Entwurf', async () => {
    const s = (await getRepos().state.load()).state;
    const overdue = s.contracts.find((c) => memberView(s, c.id, todayBerlin(realNow())).status.arrearsCents > 0)!;
    const name = s.contacts.find((c) => c.id === overdue.contactId)!.name.split(' ')[0];
    const { state } = await sendToAssistant(`Schick ${name} eine Erinnerung`);
    const created = state.actions.filter((a) => a.type === 'send_reminder');
    expect(created).toHaveLength(1);
    expect(created[0].isDemo).toBe(false);
  });
});
